import { beforeEach, describe, expect, it } from "vitest";
import { SemanticAdapter, stripLetterPrefix } from "../src/content/adapters/semantic";
import { waitForNextState } from "../src/content/observer";
import { LayoutName, renderQuestion, SAMPLE, setupPage } from "./helpers/site";

const adapter = new SemanticAdapter();
const LAYOUTS: LayoutName[] = ["radio", "cards", "select", "listbox"];

beforeEach(() => setupPage());

describe("detect", () => {
  it("detects opted-in synthetic pages and allows automation", () => {
    expect(adapter.detect(document)).toMatchObject({ testId: "quiz-15", environment: "synthetic", automationAllowed: true });
  });

  it("ignores pages without the opt-in marker", () => {
    setupPage({});
    expect(adapter.detect(document)).toBeNull();
  });

  it("allows only dry-run on non-synthetic environments", () => {
    setupPage({ "evalix-qa": "enabled", "evalix-environment": "staging" });
    expect(adapter.detect(document)?.automationAllowed).toBe(false);
  });

  it("recognises the completion page", () => {
    setupPage({ "evalix-qa": "enabled", "evalix-page": "complete" });
    expect(adapter.isComplete(document)).toBe(true);
  });
});

describe.each(LAYOUTS)("extract — %s layout", (layout) => {
  it("extracts question text, number, and lettered options", () => {
    renderQuestion(layout);
    const e = adapter.extract(document)!;
    expect(e).not.toBeNull();
    expect(e.question).toEqual({
      questionId: "q07",
      questionNumber: 7,
      totalQuestions: 15,
      text: SAMPLE.text,
      options: SAMPLE.options,
    });
  });

  it("selects an option through the page's own handlers", () => {
    const { recorded } = renderQuestion(layout);
    const e = adapter.extract(document)!;
    const b = e.options.find((o) => o.id === "B")!;
    adapter.select(b);
    expect(recorded).toEqual(["B"]);
    expect(adapter.isSelected(b)).toBe(true);
    expect(adapter.isSelected(e.options[0])).toBe(false);
  });

  it("returns null until options are rendered", () => {
    renderQuestion(layout, { withholdOptions: true });
    expect(adapter.extract(document)).toBeNull();
  });
});

describe("findNext", () => {
  it.each([
    ["button", "Next", true],
    ["link", "Continue →", false],
    ["form", "Save & next", false],
  ] as const)("finds the %s variant", (nav, label, disabled) => {
    renderQuestion("radio", { nav });
    const next = adapter.findNext(document)!;
    expect(next.label).toBe(label);
    expect(next.disabled).toBe(disabled);
  });

  it("does not treat an answer option labelled 'Next' as navigation", () => {
    renderQuestion("listbox", {
      nav: "link",
      q: { ...SAMPLE, options: [{ id: "A", text: "Next" }, ...SAMPLE.options.slice(1)] },
    });
    expect(adapter.findNext(document)!.label).toBe("Continue →");
  });
});

describe("waitForNextState", () => {
  it("waits for late-inserted options before resolving", async () => {
    const { appendOptions } = renderQuestion("cards", { withholdOptions: true });
    setTimeout(appendOptions, 50);
    const state = await waitForNextState(adapter, document, { previousSignature: null, timeoutMs: 2000, quietMs: 50 });
    expect(state.kind).toBe("question");
    if (state.kind === "question") expect(state.extraction.question.options).toHaveLength(4);
  });

  it("ignores the current question and resolves on the next one", async () => {
    renderQuestion("radio");
    const first = adapter.extract(document)!;
    const sig = [first.question.questionId, first.question.text, ...first.question.options.map((o) => o.text)].join("|");
    setTimeout(() => renderQuestion("select", { number: 8, q: { ...SAMPLE, id: "q08", text: "Second question?" } }), 50);
    const state = await waitForNextState(adapter, document, { previousSignature: sig, timeoutMs: 2000, quietMs: 20 });
    expect(state.kind === "question" && state.extraction.question.questionId).toBe("q08");
  });

  it("times out when nothing appears", async () => {
    document.getElementById("stage")!.innerHTML = "";
    await expect(waitForNextState(adapter, document, { previousSignature: null, timeoutMs: 100 })).rejects.toThrow(/Timed out/);
  });
});

describe("stripLetterPrefix", () => {
  it.each([
    ["A. Heart", "Heart"],
    ["(b) Heart", "Heart"],
    ["C) Heart", "Heart"],
    ["Apple pie", "Apple pie"],
    ["A.B. testing", "A.B. testing"],
  ])("%s -> %s", (input, out) => expect(stripLetterPrefix(input)).toBe(out));
});
