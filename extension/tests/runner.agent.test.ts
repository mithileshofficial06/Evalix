// The agent loop on pages that need more than the heuristics: no hooks, shuffled options,
// unsemantic widgets, an unlabelled Next button, ambiguous pages read by the AI, and invalid AI output.
import { beforeEach, describe, expect, it } from "vitest";
import { SemanticAdapter } from "../src/content/adapters/semantic";
import { Runner, type DecideInput } from "../src/content/runner";
import type { DecideReply } from "../src/shared/messages";
import { decision, fakeBridge, reply, until } from "./helpers/bridge";
import { makeQuestions, runQuiz } from "./helpers/quiz";
import { ALL_LAYOUTS, renderQuestion, setupPage } from "./helpers/site";

const adapter = new SemanticAdapter();
const timing = {
  questionTimeoutMs: 3000,
  dryRunTimeoutMs: 3000,
  quietMs: 20,
  enableTimeoutMs: 300,
  reactTimeoutMs: 300,
  actionDelayMs: 0,
  aiObserveAfterMs: 200,
  verifyTimeoutMs: 100,
};

/** Stand-in for the AI's recovery planning: press the only button that is not an answer choice. */
const recoverByPressingTheOddButton = (input: DecideInput): DecideReply => {
  const target = input.snapshot.elements.find((e) => e.role === "button" && e.text.includes("⇨"));
  return decision({ action: { action: target ? "click" : "wait", target: target?.id ?? null, value: target ? null : "100" } });
};

beforeEach(() => setupPage());

describe("Agent — adapts to unknown layouts", () => {
  it("completes a hook-free, shuffled quiz across every layout and Next variant", async () => {
    const questions = makeQuestions(12);
    const quiz = runQuiz(questions, { hooks: false, shuffle: true, layouts: ALL_LAYOUTS, navs: ["button", "link", "form", "icon"] });
    const byText = Object.fromEntries(questions.map((q) => [q.text, q.options.find((o) => o.id === q.correct)!.text]));
    const { bridge, events } = fakeBridge((q) => {
      // Answer by meaning: the letter is whatever position the right text has *on screen*.
      const shown = q.options.find((o) => o.text === byText[q.text])!;
      return reply(shown.id);
    }, recoverByPressingTheOddButton);

    await new Runner(adapter, document, bridge, timing).start("automation");

    expect(events.failed).toBeNull();
    expect(events.completed).toBe(true);
    expect(events.results).toHaveLength(12);
    expect(events.results.every((r) => r.selected && !r.error)).toBe(true);
    // The page recorded the right answers under its own letters despite the shuffled display.
    expect(quiz.answers).toEqual(Object.fromEntries(questions.map((q) => [q.id, q.correct])));
    expect(events.results[0]).toMatchObject({ question_id: "n1", question_text: questions[0].text, answer_text: byText[questions[0].text] });

    const steps = events.actions.map((a) => a.step);
    // Unsemantic tiles ignore click(): selection was recovered with a different interaction.
    expect(events.actions.some((a) => a.step === "option clicked" && a.detail === "pointer events")).toBe(true);
    // The unlabelled "⇨" button was found by the AI recovery planner.
    expect(events.actions.some((a) => a.step === "AI recovery plan" && a.ok && a.detail?.startsWith("click"))).toBe(true);
    expect(steps.filter((s) => s === "transition verified")).toHaveLength(12 + events.actions.filter((a) => a.step === "transition verified" && !a.ok).length);
  });

  it("records the step-by-step history for each question", async () => {
    runQuiz(makeQuestions(1));
    const { bridge, events } = fakeBridge(() => reply("A"));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.actions.filter((a) => a.question === 1).map((a) => a.step)).toEqual([
      "observed",
      "understood",
      "answer selected",
      "option located",
      "option clicked",
      "selection verified",
      "next located",
      "next clicked",
      "transition verified",
    ]);
    expect(events.actions.at(-1)?.step).toBe("completion detected");
  });
});

describe("Agent — AI page understanding", () => {
  /** A question plus a second, unrelated radio group: the heuristics refuse to guess. */
  function ambiguousPage(n: number, onAnswered: () => void) {
    document.getElementById("stage")!.innerHTML = `
      <fieldset><legend>How confident do you feel today?</legend>
        <label><input type="radio" name="mood" value="1">Low</label><label><input type="radio" name="mood" value="2">High</label></fieldset>
      <fieldset><legend>Question ${n}: What is ${n} + ${n}?</legend>
        ${[1, 2, 3].map((k) => `<label><input type="radio" name="q${n}" value="${k * n}">${k * n}</label>`).join("")}</fieldset>`;
    document.getElementById("nav")!.innerHTML = `<button type="button">Next</button>`;
    document.querySelector("#nav button")!.addEventListener("click", onAnswered);
  }

  const readQuestion = (input: DecideInput, used_screenshot = false): DecideReply => {
    const els = input.snapshot.elements;
    const legend = input.snapshot.texts.find((t) => t.startsWith("Question"))!;
    const n = Number(legend.match(/\d+/)![0]);
    const opts = els.filter((e) => e.role === "radio" && e.group?.endsWith(`:q${n}`));
    const next = els.find((e) => e.text === "Next")!;
    return decision({ question_text: legend, option_ids: opts.map((o) => o.id), next_id: next.id }, { used_screenshot });
  };

  it("asks the AI to read an ambiguous page, then acts on the elements it identified", async () => {
    let n = 1;
    const show = () => ambiguousPage(n, () => (n < 2 ? (n++, show()) : (document.getElementById("stage")!.innerHTML = "<h1>Assessment complete</h1>", (document.getElementById("nav")!.innerHTML = ""))));
    show();
    const { bridge, events } = fakeBridge((q) => reply(q.options.find((o) => o.text === String(2 * (q.text.includes("2 +") ? 2 : 1)))!.id), (input) =>
      input.task === "understand" ? readQuestion(input) : decision({ action: { action: "wait", target: null, value: "50" } }),
    );
    await new Runner(adapter, document, bridge, timing).start("automation");

    expect(events.failed).toBeNull();
    expect(events.completed).toBe(true);
    expect(events.results.map((r) => [r.question_text, r.answer_text])).toEqual([
      ["Question 1: What is 1 + 1?", "2"],
      ["Question 2: What is 2 + 2?", "4"],
    ]);
    expect(events.decisions.every((d) => d.task === "understand" && !d.screenshot)).toBe(true);
    expect(events.actions.find((a) => a.step === "observed")?.detail).toBe("source ai");
    // The mood question was never touched.
    expect(document.querySelectorAll('input[name="mood"]:checked')).toHaveLength(0);
  });

  it("escalates to a screenshot when the DOM-only reading is unsure", async () => {
    ambiguousPage(1, () => (document.getElementById("stage")!.innerHTML = "<h1>Assessment complete</h1>"));
    let calls = 0;
    const { bridge, events } = fakeBridge(() => reply("B"), (input) => {
      calls++;
      if (!input.screenshot) return { ...readQuestion(input), decision: { ...(readQuestion(input) as any).decision, confidence: 0.3 } } as DecideReply;
      return readQuestion(input, true);
    });
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.completed).toBe(true);
    expect(events.decisions.map((d) => d.screenshot)).toEqual([false, true]);
    expect(events.actions.find((a) => a.step === "observed")?.detail).toBe("source ai+screenshot");
    expect(calls).toBe(2);
  });

  it("rejects AI output that names elements that are not on the page", async () => {
    ambiguousPage(1, () => undefined);
    const { bridge, events } = fakeBridge(() => reply("A"), () => decision({ question_text: "Q?", option_ids: ["e900", "e901"] }));
    await new Runner(adapter, document, bridge, { ...timing, questionTimeoutMs: 800 }).start("automation");
    expect(events.results).toHaveLength(0); // never answered, never clicked
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
    expect(events.actions.some((a) => a.step === "AI page reading" && !a.ok && a.detail?.includes("not on the page"))).toBe(true);
    expect(events.failed).toMatch(/Timed out/);
  });

  it("does not ask the AI again about a page that has not changed", async () => {
    ambiguousPage(1, () => undefined);
    const { bridge, events } = fakeBridge(() => reply("A"), () => ({ ok: false, error: "provider down" }));
    await new Runner(adapter, document, bridge, { ...timing, questionTimeoutMs: 1200 }).start("automation");
    expect(events.decisions).toHaveLength(1);
  });
});

describe("Agent — validation of AI answers", () => {
  it("refuses an answer whose action is not select_answer", async () => {
    const { recorded } = renderQuestion("radio");
    const bad = reply("B");
    if (bad.ok) (bad.answer as any).action = "click";
    const { bridge, events } = fakeBridge(() => bad);
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(recorded).toEqual([]);
    expect(events.results[0].error).toMatch(/Invalid AI decision/);
    expect(events.failed).toMatch(/invalid AI decision/);
  });

  it("refuses an answer letter that is not one of the options", async () => {
    const { recorded } = renderQuestion("radio");
    const { bridge, events } = fakeBridge(() => reply("Z"));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(recorded).toEqual([]);
    expect(events.results[0].error).toMatch(/not one of A, B, C, D/);
  });
});

describe("Agent — dry run", () => {
  it("highlights the option and the Next control and explains on an overlay, without acting", async () => {
    const { recorded } = renderQuestion("toggle", { hooks: false, nav: "link" });
    const { bridge, events } = fakeBridge(() => reply("B", 0.94));
    const runner = new Runner(adapter, document, bridge, timing);
    void runner.start("dry-run");
    await until(() => events.results.length === 1);

    expect(recorded).toEqual([]);
    expect(document.querySelector('[data-evalix-highlight="B"]')?.textContent).toBe("Heart");
    expect(document.querySelector("[data-evalix-next]")?.textContent).toBe("Continue →");
    expect(document.querySelector("evalix-overlay")).not.toBeNull();
    expect(events.actions.at(-1)).toMatchObject({ step: "dry run: targets highlighted", ok: true });

    runner.stop();
    expect(document.querySelector("evalix-overlay")).toBeNull();
    expect(document.querySelector("[data-evalix-next]")).toBeNull();
  });
});

describe("Agent — loading states", () => {
  it("waits through a loading indicator without asking the AI", async () => {
    document.getElementById("stage")!.innerHTML = `<div role="status">Loading question…</div>`;
    setTimeout(() => renderQuestion("radio", { hooks: false }), 700);
    const { bridge, events } = fakeBridge(() => reply("B"), () => decision({ page_state: "loading", action: { action: "wait", target: null, value: "100" } }));
    const runner = new Runner(adapter, document, bridge, { ...timing, aiObserveAfterMs: 100 });
    void runner.start("dry-run");
    await until(() => events.results.length === 1);
    runner.stop();
    expect(events.decisions).toHaveLength(0);
  });
});
