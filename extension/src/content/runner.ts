// The browser agent loop:
//
//   OBSERVE → UNDERSTAND → ANSWER → FIND TARGET → ACT → VERIFY → NEXT → OBSERVE AGAIN
//
// The page is read semantically by the adapter's heuristics; when they cannot make sense of it the
// AI is shown a snapshot of the page (and, if still unclear, a screenshot). Every action is
// verified against the page, and failures are recovered by re-observing, re-locating the element
// and escalating the interaction strategy, within a fixed number of attempts.
// Page specifics live in the DomAdapter; transport to the background lives in the Bridge, so this
// loop runs unchanged in unit tests with a fake bridge.
import type { AskReply, DecideReply } from "../shared/messages";
import type { ActionEvent, AgentDecision, AgentTask, ExtractedQuestion, LogEntry, Mode, PageSnapshot, QuestionResult, RunState } from "../shared/types";
import { isVisible, kindOf, labelOf, normalize, PROGRESS_TEXT } from "./adapters/infer";
import { hash, stripLetterPrefix } from "./adapters/semantic";
import type { DomAdapter, Extraction, NextControl, OptionHandle } from "./adapters/types";
import { ActionError, executeAction, runStrategy, pressStrategies, selectStrategies, sleep, validateAction } from "./agent/act";
import { Overlay } from "./agent/overlay";
import { observePage, pageFingerprint, type Observation } from "./agent/snapshot";
import { mapAnswer } from "./mapper";
import { AbortedError, signatureOf, waitFor, waitForNextState, waitForQuiet, WaitTimeoutError } from "./observer";

export interface DecideInput {
  task: AgentTask;
  goal: string;
  snapshot: PageSnapshot;
  history: string[];
  screenshot: boolean;
}

export interface Bridge {
  ask(question: ExtractedQuestion): Promise<AskReply>;
  decide(input: DecideInput): Promise<DecideReply>;
  questionStarted(question: ExtractedQuestion): void;
  result(result: QuestionResult): void;
  action(event: Omit<ActionEvent, "at">): void;
  state(state: RunState): void;
  log(level: LogEntry["level"], message: string): void;
  complete(): void;
  failed(error: string): void;
}

export interface RunnerTiming {
  /** Max wait for the next question in automation mode. */
  questionTimeoutMs: number;
  /** Max wait in dry-run mode, where a human advances the page. */
  dryRunTimeoutMs: number;
  /** DOM must be quiet this long before a question counts as fully rendered. */
  quietMs: number;
  /** How long the Next control may stay disabled after selecting (pages often validate async). */
  enableTimeoutMs: number;
  /** How long to wait for the page to react to a click. */
  reactTimeoutMs: number;
  /** Pause before clicking so the page's own selection handlers finish. */
  actionDelayMs: number;
  /** How long the heuristics may fail to read a changed page before the AI is asked to look. */
  aiObserveAfterMs: number;
  /** How long a selection may take to show up on the page. */
  verifyTimeoutMs: number;
  /** Attempts to get the page to the next question before giving up. */
  maxNavAttempts: number;
  /** Below this, a DOM-only AI reading is re-done with a screenshot. */
  minAiConfidence: number;
}

export const DEFAULT_TIMING: RunnerTiming = {
  questionTimeoutMs: 30_000,
  dryRunTimeoutMs: 30 * 60_000,
  quietMs: 300,
  enableTimeoutMs: 5_000,
  reactTimeoutMs: 4_000,
  actionDelayMs: 150,
  aiObserveAfterMs: 2_000,
  verifyTimeoutMs: 1_000,
  maxNavAttempts: 4,
  minAiConfidence: 0.5,
};

type Source = "dom" | "ai" | "ai+screenshot";

interface QuestionView {
  kind: "question";
  extraction: Extraction;
  /** Next control as identified by the AI (heuristics look it up themselves). */
  next: NextControl | null;
  source: Source;
}
type Perception = QuestionView | { kind: "complete"; source: Source };

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export class Runner {
  private abort: AbortController | null = null;
  private running = false;
  private readonly overlay: Overlay;
  private readonly timing: RunnerTiming;
  /** Page fingerprint the AI last looked at, so an unchanged page is never sent twice. */
  private aiLookedAt: string | null = null;

  constructor(
    private readonly adapter: DomAdapter,
    private readonly doc: Document,
    private readonly bridge: Bridge,
    timing: Partial<RunnerTiming> = {},
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.overlay = new Overlay(doc);
  }

  get isRunning() {
    return this.running;
  }

  start(mode: Mode): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    this.aiLookedAt = null;
    this.abort = new AbortController();
    return this.loop(mode, this.abort.signal).finally(() => {
      this.running = false;
    });
  }

  stop() {
    this.abort?.abort();
    this.overlay.clear();
    const root = this.adapter.questionRoot(this.doc) ?? this.doc.body;
    if (root) this.adapter.highlight(null, root);
  }

  private async loop(mode: Mode, signal: AbortSignal): Promise<void> {
    let previous: string | null = null;
    let reviewing = false;
    try {
      for (;;) {
        // In dry-run, stay in "reviewing" while the human looks at the suggestion.
        if (!reviewing) this.bridge.state("waiting");
        const seen = await this.observe(previous, mode, signal);
        if (seen.kind === "complete") {
          this.trace(null, "completion detected", true, `source ${seen.source}`);
          this.overlay.clear();
          this.bridge.complete();
          return;
        }
        previous = signatureOf(seen.extraction);
        const ok = await this.processQuestion(seen, mode, signal);
        if (!ok && mode === "automation") return; // can't advance without a selected answer
        reviewing = mode === "dry-run" && ok;
      }
    } catch (err) {
      if (err instanceof AbortedError) return;
      this.bridge.failed((err as Error).message);
    }
  }

  // ---- OBSERVE + UNDERSTAND ---------------------------------------------------------------------

  /**
   * Waits until the page shows a question different from `previous`, or the completion state.
   * Heuristics first; if they cannot read a page that has settled, the AI looks at it.
   */
  private async observe(previous: string | null, mode: Mode, signal: AbortSignal): Promise<Perception> {
    const limit = mode === "automation" ? this.timing.questionTimeoutMs : this.timing.dryRunTimeoutMs;
    const deadline = Date.now() + limit;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new WaitTimeoutError(`Timed out after ${limit} ms waiting for a question or the completion page`);
      try {
        const next = await waitForNextState(this.adapter, this.doc, {
          previousSignature: previous,
          timeoutMs: Math.min(remaining, this.timing.aiObserveAfterMs),
          quietMs: this.timing.quietMs,
          signal,
        });
        return next.kind === "complete" ? { kind: "complete", source: "dom" } : { ...next, next: null, source: "dom" };
      } catch (err) {
        if (!(err instanceof WaitTimeoutError)) throw err;
      }
      // Still on the question we already handled (dry-run: the human has not advanced yet).
      const current = this.adapter.extract(this.doc);
      if (current && signatureOf(current) === previous) continue;
      // A page that says it is still loading is not a puzzle for the AI — keep waiting.
      if (isLoading(this.doc)) continue;
      // Only a page that has stopped changing is worth showing to the AI (options may still be
      // streaming in); afterwards the heuristics get another look first.
      await waitForQuiet(this.doc.body ?? this.doc, Math.min(1000, this.timing.aiObserveAfterMs), 3000);
      if (signal.aborted) throw new AbortedError("aborted");
      const settled = this.adapter.extract(this.doc);
      if (this.adapter.isComplete(this.doc) || isLoading(this.doc) || (settled && signatureOf(settled) !== previous)) continue;
      // The heuristics cannot read this page. Ask the AI — once per distinct page state.
      const fingerprint = pageFingerprint(this.doc);
      if (fingerprint === this.aiLookedAt) continue;
      this.aiLookedAt = fingerprint;
      const seen = await this.understandWithAI(previous, signal);
      if (seen) return seen;
    }
  }

  private async understandWithAI(previous: string | null, signal: AbortSignal): Promise<Perception | null> {
    for (const screenshot of [false, true]) {
      const obs = observePage(this.doc);
      this.trace(null, "page sent to AI", true, `${obs.snapshot.elements.length} elements${screenshot ? " + screenshot" : ""}`);
      const reply = await this.bridge.decide({ task: "understand", goal: "", snapshot: obs.snapshot, history: [], screenshot });
      if (signal.aborted) throw new AbortedError("aborted");
      if (!reply.ok) {
        this.trace(null, "AI page reading", false, reply.error);
        return null; // the AI is unreachable — a screenshot will not help
      }
      const d = reply.decision;
      const source: Source = d.used_screenshot ? "ai+screenshot" : "ai";
      const view = this.fromDecision(d, obs, source);
      if (typeof view === "string" || (d.confidence < this.timing.minAiConfidence && !screenshot) || d.page_state === "other") {
        this.trace(null, "AI page reading", false, typeof view === "string" ? view : `${d.page_state} @ ${Math.round(d.confidence * 100)}%`);
        if (!screenshot) continue; // the DOM was not enough: look at the rendered page
        return null;
      }
      this.trace(null, "AI page reading", true, `${d.page_state} @ ${Math.round(d.confidence * 100)}% via ${d.provider}${screenshot ? " (screenshot)" : ""}`);
      if (view === null) {
        // Loading / other: carry out the AI's suggested wait or scroll, then observe again.
        if (d.action.action === "wait" || d.action.action === "scroll") await this.runAction(null, d.action, obs, signal);
        return null;
      }
      if (view.kind === "question" && signatureOf(view.extraction) === previous) return null;
      return view;
    }
    return null;
  }

  /** Turns a validated AI decision into the same page model the heuristics produce. */
  private fromDecision(d: AgentDecision, obs: Observation, source: Source): Perception | string | null {
    if (d.page_state === "complete") return { kind: "complete", source };
    if (d.page_state !== "question") return null;
    const els = d.option_ids.map((id) => obs.registry.get(id));
    if (els.length < 2 || els.some((e) => !e || !e.isConnected)) return "AI named answer choices that are not on the page";
    if (!d.question_text) return "AI gave no question text";
    const elements = els as HTMLElement[];
    const options: OptionHandle[] = elements.slice(0, 10).map((element, i) => ({ id: "ABCDEFGHIJ"[i], kind: kindOf(element), element, group: elements }));

    const progress = obs.snapshot.texts.map((t) => t.match(PROGRESS_TEXT)).find(Boolean);
    const number = progress ? Number(progress[1]) : null;
    const text = normalize(d.question_text);
    const nextEl = d.next_id ? obs.registry.get(d.next_id) : undefined;
    const extraction: Extraction = {
      root: commonAncestor(elements),
      options,
      question: {
        questionId: number != null ? `n${number}` : hash(text),
        questionNumber: number,
        totalQuestions: progress ? Number(progress[2]) : null,
        text,
        options: options.map((o) => ({ id: o.id, text: optionText(o) })),
      },
    };
    const next = nextEl ? { element: nextEl, label: labelOf(nextEl), disabled: isDisabled(nextEl) } : null;
    return { kind: "question", extraction, next, source };
  }

  /** The current question as it is on the page *now* (elements may have been re-rendered). */
  private currentExtraction(seen: QuestionView): Extraction | null {
    const fresh = this.adapter.extract(this.doc);
    if (fresh) return fresh;
    const e = seen.extraction;
    return e.options.every((o) => o.element.isConnected) ? e : null;
  }

  // ---- ANSWER → FIND TARGET → ACT → VERIFY → NEXT -------------------------------------------------

  /** Returns true if the question was handled and the loop may continue. */
  private async processQuestion(seen: QuestionView, mode: Mode, signal: AbortSignal): Promise<boolean> {
    const extraction = seen.extraction;
    const q = extraction.question;
    const started = performance.now();
    const result: QuestionResult = {
      question_id: q.questionId,
      question_number: q.questionNumber,
      question_text: q.text,
      answer: null,
      answer_text: null,
      confidence: null,
      provider: null,
      api_latency_ms: null,
      processing_ms: 0,
      selected: false,
      error: null,
    };
    const finish = (error: string | null) => {
      result.error = error;
      result.processing_ms = Math.round(performance.now() - started);
      this.bridge.result(result);
    };

    this.trace(q, "observed", true, `source ${seen.source}`);
    this.trace(q, "understood", true, `"${short(q.text)}" — ${q.options.length} choices (${extraction.options[0].kind})`);
    this.bridge.questionStarted(q);
    this.bridge.state("asking");

    const reply = await this.bridge.ask(q);
    if (signal.aborted) throw new AbortedError("aborted");
    if (!reply.ok) {
      this.trace(q, "answer selected", false, reply.error);
      finish(`AI request failed: ${reply.error}`);
      if (mode === "automation") this.bridge.failed(`Q${q.questionNumber ?? "?"}: AI request failed`);
      return false;
    }
    const answer = reply.answer;
    const chosen = q.options.find((o) => o.id === answer.answer.trim().toUpperCase());
    // The AI's reply is data, not an instruction: it must be a select_answer for a listed option.
    if ((answer.action && answer.action !== "select_answer") || !chosen) {
      const why = chosen ? `unexpected action "${answer.action}"` : `"${answer.answer}" is not one of ${q.options.map((o) => o.id).join(", ")}`;
      this.trace(q, "answer selected", false, why);
      finish(`Invalid AI decision: ${why}`);
      if (mode === "automation") this.bridge.failed(`Q${q.questionNumber ?? "?"}: invalid AI decision`);
      return false;
    }
    Object.assign(result, {
      answer: chosen.id,
      answer_text: chosen.text,
      confidence: answer.confidence,
      provider: answer.provider,
      api_latency_ms: answer.latency_ms,
    });
    const fb = answer.fallback_used ? ", fallback" : "";
    this.trace(q, "answer selected", true, `${chosen.id} "${short(chosen.text, 40)}" @ ${Math.round(answer.confidence * 100)}% via ${answer.provider}${fb} (${Math.round(answer.latency_ms)} ms)`);

    // FIND TARGET — against the DOM as it is now, not as it was when we asked.
    let mapped = mapAnswer(q, chosen.id, this.currentExtraction(seen));
    if (!mapped.ok) {
      this.trace(q, "option located", false, mapped.reason);
      this.trace(q, "recovery", true, "re-observing the page to locate the option again");
      await waitForQuiet(this.doc.body ?? this.doc, this.timing.quietMs, 2000);
      mapped = mapAnswer(q, chosen.id, this.currentExtraction(seen));
    }
    if (!mapped.ok) {
      this.trace(q, "option located", false, mapped.reason);
      finish(mapped.reason);
      if (mode === "automation") this.bridge.failed(mapped.reason);
      return false;
    }
    const option = mapped.option;
    this.trace(q, "option located", true, `${option.kind} "${short(chosen.text, 40)}"`);

    if (mode === "dry-run") {
      const next = this.locateNext(seen);
      this.adapter.highlight(option, extraction.root, next?.element ?? null);
      this.overlay.show(`Evalix would select ${chosen.id} (${Math.round(answer.confidence * 100)}%)`, [
        `“${short(chosen.text, 80)}” via ${answer.provider}`,
        next ? `then click “${short(next.label, 30)}”` : "no Next control found yet",
        "Dry run — nothing is clicked.",
      ]);
      this.trace(q, "dry run: targets highlighted", true, next ? `option + "${next.label}"` : "option only");
      finish(null);
      this.bridge.state("reviewing");
      return true;
    }

    this.bridge.state("selecting");
    const selected = await this.selectAndVerify(q, option, signal);
    if (!selected) {
      const msg = "Selection did not register on the page";
      finish(msg);
      this.bridge.failed(`Q${q.questionNumber ?? "?"}: ${msg}`);
      return false;
    }
    result.selected = true;
    finish(null);

    this.bridge.state("navigating");
    const nav = await this.advanceAndVerify(q, seen, option, signal);
    if (!nav.ok) {
      this.bridge.failed(`Q${q.questionNumber ?? "?"}: ${nav.reason}`);
      return false;
    }
    return true;
  }

  /** Is this choice selected right now? Follows the option if the page re-rendered it. */
  private selectedNow(option: OptionHandle): boolean {
    if (option.element.isConnected) return this.adapter.isSelected(option);
    const again = this.relocate(option);
    return again ? this.adapter.isSelected(again) : false;
  }

  /** Finds the same choice (by its text) in the current DOM. */
  private relocate(option: OptionHandle): OptionHandle | null {
    if (option.element.isConnected) return option;
    const wanted = normalize(optionText(option)).toLowerCase();
    const fresh = this.adapter.extract(this.doc);
    return fresh?.options.find((o) => normalize(optionText(o)).toLowerCase() === wanted) ?? null;
  }

  /** ACT + VERIFY for the answer: escalate through interaction strategies until the page shows it selected. */
  private async selectAndVerify(q: ExtractedQuestion, option: OptionHandle, signal: AbortSignal): Promise<boolean> {
    if (this.selectedNow(option)) {
      this.trace(q, "selection verified", true, "already selected");
      return true;
    }
    const strategies = selectStrategies(option, (o) => this.adapter.select(o));
    let target = option;
    for (let i = 0; i < strategies.length; i++) {
      if (i > 0) {
        this.trace(q, "recovery", true, `re-locating the option and trying ${strategies[i].name}`);
        await waitForQuiet(this.doc.body ?? this.doc, this.timing.quietMs, 1000);
        target = this.relocate(target) ?? target;
        if (!target.element.isConnected) continue;
      }
      if (signal.aborted) throw new AbortedError("aborted");
      const error = runStrategy(strategies[i], target.element);
      this.trace(q, "option clicked", !error, error ? `${strategies[i].name}: ${error}` : strategies[i].name);
      try {
        await waitFor(() => this.selectedNow(target), { timeoutMs: this.timing.verifyTimeoutMs, signal });
        this.trace(q, "selection verified", true);
        return true;
      } catch (err) {
        if (!(err instanceof WaitTimeoutError)) throw err;
        this.trace(q, "selection verified", false, "the option is not selected on the page");
      }
    }
    return false;
  }

  /** The Next control: page heuristics first, then whatever the AI identified. */
  private locateNext(seen: QuestionView): NextControl | null {
    const found = this.adapter.findNext(this.doc);
    if (found) return found;
    const ai = seen.next;
    return ai && ai.element.isConnected ? { ...ai, disabled: isDisabled(ai.element) } : null;
  }

  /** NEXT + VERIFY: press the advancing control until the page leaves this question. */
  private async advanceAndVerify(
    q: ExtractedQuestion,
    seen: QuestionView,
    option: OptionHandle,
    signal: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const before = this.adapter.extract(this.doc);
    const beforeSig = before ? signatureOf(before) : null;
    const left = () => {
      if (this.adapter.isComplete(this.doc)) return true;
      const e = this.adapter.extract(this.doc);
      if (e) return signatureOf(e) !== beforeSig;
      // Page the heuristics can't read: it moved on once the choices or the question text are gone.
      const stillThere = seen.extraction.options.every((o) => o.element.isConnected) && normalize(this.doc.body?.textContent).includes(q.text);
      return !stillThere;
    };

    const strategies = pressStrategies();
    const history: string[] = [];
    let reason = "Page did not advance";
    let strategyIndex = 0;

    for (let attempt = 1; attempt <= this.timing.maxNavAttempts; attempt++) {
      if (signal.aborted) throw new AbortedError("aborted");
      if (attempt > 1) this.trace(q, "recovery", true, `attempt ${attempt} to reach the next question`);

      let next = this.locateNext(seen);
      // Heuristics found nothing, or pressing their choice twice did nothing: let the AI reassess.
      if (!next || attempt >= 3) {
        const plan = await this.planRecovery(q, history, signal);
        if (plan === "complete" || left()) return this.transitionVerified(q);
        if (typeof plan === "object" && plan) {
          next = plan.control;
          strategyIndex = 0;
        } else if (plan === "acted") {
          if (left()) return this.transitionVerified(q);
          continue;
        }
      }
      if (!next) {
        reason = "No Next/Finish control found on the page";
        history.push("could not find a Next/Finish control");
        this.trace(q, "next located", false, reason);
        await sleep(400, signal);
        continue;
      }
      this.trace(q, "next located", true, `"${short(next.label, 30)}"`);

      if (next.disabled) {
        const control = next.element;
        try {
          await waitFor(() => !isDisabled(control) || left(), { timeoutMs: this.timing.enableTimeoutMs, signal });
        } catch (err) {
          if (!(err instanceof WaitTimeoutError)) throw err;
          reason = `Next control "${next.label}" stayed disabled`;
          history.push(`"${next.label}" stayed disabled`);
          this.trace(q, "next enabled", false, reason);
          // A disabled Next usually means the page did not take the answer.
          if (!this.selectedNow(option)) {
            this.trace(q, "recovery", true, "answer no longer selected — selecting again");
            await this.selectAndVerify(q, this.relocate(option) ?? option, signal);
          }
          continue;
        }
        if (left()) return this.transitionVerified(q);
      }

      await sleep(this.timing.actionDelayMs, signal);
      const strategy = strategies[Math.min(strategyIndex++, strategies.length - 1)];
      const error = runStrategy(strategy, next.element);
      this.trace(q, "next clicked", !error, `"${short(next.label, 30)}" (${strategy.name}${error ? `: ${error}` : ""})`);
      try {
        await waitFor(left, { timeoutMs: this.timing.reactTimeoutMs, signal });
        return this.transitionVerified(q);
      } catch (err) {
        if (!(err instanceof WaitTimeoutError)) throw err;
      }
      // A full-page navigation may already be in flight — then this script is about to be torn
      // down and the next page load resumes the session.
      const alert = this.pageMessage();
      reason = "Page did not advance after clicking Next";
      history.push(`pressed "${next.label}" (${strategy.name}): page did not change${alert ? `; page says "${alert}"` : ""}`);
      this.trace(q, "transition verified", false, alert ? `page says "${short(alert)}"` : "page did not change");
      if (!this.selectedNow(option)) {
        this.trace(q, "recovery", true, "answer no longer selected — selecting again");
        await this.selectAndVerify(q, this.relocate(option) ?? option, signal);
      }
    }
    this.trace(q, "failed", false, `${reason} after ${this.timing.maxNavAttempts} attempts`);
    return { ok: false, reason };
  }

  private transitionVerified(q: ExtractedQuestion): { ok: true } {
    this.trace(q, "transition verified", true);
    return { ok: true };
  }

  /** A visible validation/status message, if the page shows one. */
  private pageMessage(): string | null {
    for (const el of this.doc.querySelectorAll("[role='alert'], [aria-live='assertive']")) {
      const t = normalize(el.textContent);
      if (t && isVisible(el)) return t;
    }
    return null;
  }

  /**
   * Asks the AI what to do when the agent is stuck. The reply is validated against the observed
   * page before anything runs. Returns the control to press, "acted" after a wait/scroll/etc.,
   * "complete" if the AI sees the assessment finished, or null.
   */
  private async planRecovery(
    q: ExtractedQuestion,
    history: string[],
    signal: AbortSignal,
  ): Promise<{ control: NextControl } | "acted" | "complete" | null> {
    const obs = observePage(this.doc);
    const goal = "advance to the next question (the answer is already selected)";
    const reply = await this.bridge.decide({ task: "recover", goal, snapshot: obs.snapshot, history, screenshot: false });
    if (signal.aborted) throw new AbortedError("aborted");
    if (!reply.ok) {
      this.trace(q, "AI recovery plan", false, reply.error);
      return null;
    }
    const d = reply.decision;
    if (d.page_state === "complete") return "complete";
    const a = d.action;
    this.trace(q, "AI recovery plan", true, `${a.action}${a.target ? ` ${a.target} "${short(labelOf(obs.registry.get(a.target) ?? this.doc.body), 30)}"` : ""}${a.value ? ` ${a.value}` : ""} via ${d.provider}`);
    if (a.action === "click" && a.target) {
      const error = validateAction(a, obs.registry, this.doc.location.href);
      if (error) {
        this.trace(q, "AI recovery plan", false, `rejected: ${error}`);
        return null;
      }
      const el = obs.registry.get(a.target)!;
      return { control: { element: el, label: labelOf(el), disabled: isDisabled(el) } };
    }
    if (["wait", "scroll", "type", "navigate"].includes(a.action)) {
      await this.runAction(q, a, obs, signal);
      return "acted";
    }
    return null; // retry / finish / select_answer: keep going with the heuristics
  }

  /** Validates and executes one AI-chosen page action. */
  private async runAction(q: ExtractedQuestion | null, a: AgentDecision["action"], obs: Observation, signal: AbortSignal) {
    const error = validateAction(a, obs.registry, this.doc.location.href);
    if (error) {
      this.trace(q, `AI action ${a.action}`, false, `rejected: ${error}`);
      return;
    }
    try {
      await executeAction(a, obs.registry, this.doc, signal);
      this.trace(q, `AI action ${a.action}`, true, a.value ?? a.target ?? undefined);
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      this.trace(q, `AI action ${a.action}`, false, err instanceof ActionError ? err.message : String(err));
    }
  }

  private trace(q: ExtractedQuestion | null, step: string, ok: boolean, detail?: string) {
    this.bridge.action({ question: q?.questionNumber ?? null, questionId: q?.questionId ?? null, step, ok, detail });
  }
}

const LOADING_TEXT = /^\s*(loading|please wait)\b/i;

/** The page shows a loading state: aria-busy, a progressbar, or a status region saying "Loading…". */
export function isLoading(doc: Document): boolean {
  for (const el of doc.querySelectorAll("[aria-busy='true'], [role='progressbar'], [role='status'], [aria-live]")) {
    if (!isVisible(el)) continue;
    if (el.getAttribute("aria-busy") === "true" || el.getAttribute("role") === "progressbar") return true;
    if (LOADING_TEXT.test(el.textContent ?? "")) return true;
  }
  return false;
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

function optionText(o: OptionHandle): string {
  const raw = o.kind === "radio" ? labelOf(o.element) : normalize(o.element.textContent) || labelOf(o.element);
  return stripLetterPrefix(raw);
}

function commonAncestor(els: HTMLElement[]): HTMLElement {
  let node: HTMLElement | null = els[0].parentElement;
  while (node && !els.every((e) => node!.contains(e))) node = node.parentElement;
  return node ?? els[0].ownerDocument.body;
}
