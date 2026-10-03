// The automation engine: wait for question -> extract -> ask -> map -> select (-> navigate).
// Page specifics live in the DomAdapter; transport to the background lives in the Bridge,
// so this loop runs unchanged in unit tests with a fake bridge.
import type { AskReply } from "../shared/messages";
import type { ExtractedQuestion, LogEntry, Mode, QuestionResult, RunState } from "../shared/types";
import type { DomAdapter, Extraction } from "./adapters/types";
import { mapAnswer } from "./mapper";
import { advance, NavigationError } from "./navigator";
import { AbortedError, signatureOf, waitForNextState } from "./observer";

export interface Bridge {
  ask(question: ExtractedQuestion): Promise<AskReply>;
  questionStarted(question: ExtractedQuestion): void;
  result(result: QuestionResult): void;
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
  /** Navigation timings (see navigator.ts). */
  enableTimeoutMs: number;
  reactTimeoutMs: number;
  actionDelayMs: number;
}

export const DEFAULT_TIMING: RunnerTiming = {
  questionTimeoutMs: 30_000,
  dryRunTimeoutMs: 30 * 60_000,
  quietMs: 300,
  enableTimeoutMs: 5_000,
  reactTimeoutMs: 4_000,
  actionDelayMs: 150,
};

export class Runner {
  private abort: AbortController | null = null;
  private running = false;

  constructor(
    private readonly adapter: DomAdapter,
    private readonly doc: Document,
    private readonly bridge: Bridge,
    private readonly timing: RunnerTiming = DEFAULT_TIMING,
  ) {}

  get isRunning() {
    return this.running;
  }

  start(mode: Mode): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    this.abort = new AbortController();
    return this.loop(mode, this.abort.signal).finally(() => {
      this.running = false;
    });
  }

  stop() {
    this.abort?.abort();
    const root = this.adapter.questionRoot(this.doc);
    if (root) this.adapter.highlight(null, root);
  }

  private async loop(mode: Mode, signal: AbortSignal): Promise<void> {
    let previous: string | null = null;
    let reviewing = false;
    try {
      for (;;) {
        // In dry-run, stay in "reviewing" while the human looks at the suggestion.
        if (!reviewing) this.bridge.state("waiting");
        const next = await waitForNextState(this.adapter, this.doc, {
          previousSignature: previous,
          timeoutMs: mode === "automation" ? this.timing.questionTimeoutMs : this.timing.dryRunTimeoutMs,
          quietMs: this.timing.quietMs,
          signal,
        });
        if (next.kind === "complete") {
          this.bridge.complete();
          return;
        }
        previous = signatureOf(next.extraction);
        const ok = await this.processQuestion(next.extraction, mode, signal);
        if (!ok && mode === "automation") return; // can't advance without a selected answer
        reviewing = mode === "dry-run" && ok;
      }
    } catch (err) {
      if (err instanceof AbortedError) return;
      this.bridge.failed((err as Error).message);
    }
  }

  /** Returns true if the question was handled and the loop may continue. */
  private async processQuestion(extraction: Extraction, mode: Mode, signal: AbortSignal): Promise<boolean> {
    const q = extraction.question;
    const started = performance.now();
    const result: QuestionResult = {
      question_id: q.questionId,
      question_number: q.questionNumber,
      answer: null,
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

    this.bridge.questionStarted(q);
    this.bridge.state("asking");
    const reply = await this.bridge.ask(q);
    if (signal.aborted) throw new AbortedError("aborted");
    if (!reply.ok) {
      finish(`AI request failed: ${reply.error}`);
      if (mode === "automation") this.bridge.failed(`Q${q.questionNumber ?? "?"}: AI request failed`);
      return false;
    }
    result.answer = reply.answer.answer;
    result.confidence = reply.answer.confidence;
    result.provider = reply.answer.provider;
    result.api_latency_ms = reply.answer.latency_ms;

    // Map against the DOM as it is *now*, not as it was when we asked.
    const mapped = mapAnswer(q, reply.answer.answer, this.adapter.extract(this.doc));
    if (!mapped.ok) {
      finish(mapped.reason);
      if (mode === "automation") this.bridge.failed(mapped.reason);
      return false;
    }

    if (mode === "dry-run") {
      this.adapter.highlight(mapped.option, extraction.root);
      finish(null);
      this.bridge.state("reviewing");
      return true;
    }

    this.bridge.state("selecting");
    this.adapter.select(mapped.option);
    if (!this.adapter.isSelected(mapped.option)) {
      finish("Selection did not register on the page");
      this.bridge.failed("Selection did not register on the page");
      return false;
    }
    result.selected = true;
    finish(null);

    this.bridge.state("navigating");
    try {
      await advance(this.adapter, this.doc, signatureOf(this.adapter.extract(this.doc) ?? extraction), {
        enableTimeoutMs: this.timing.enableTimeoutMs,
        reactTimeoutMs: this.timing.reactTimeoutMs,
        actionDelayMs: this.timing.actionDelayMs,
        signal,
      });
    } catch (err) {
      if (err instanceof NavigationError) {
        this.bridge.failed(`Q${q.questionNumber ?? "?"}: ${err.message}`);
        return false;
      }
      throw err;
    }
    return true;
  }
}
