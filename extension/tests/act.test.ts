import { beforeEach, describe, expect, it } from "vitest";
import { executeAction, validateAction } from "../src/content/agent/act";
import { agentSummary, historyByQuestion } from "../src/shared/agentReport";
import type { ActionEvent, BrowserAction, Session } from "../src/shared/types";

const PAGE = "http://localhost:8080/quiz.html";
const act = (a: Partial<BrowserAction>): BrowserAction => ({ action: "click", target: null, value: null, ...a });

let registry: Map<string, HTMLElement>;
beforeEach(() => {
  document.body.innerHTML = `<button id="b">Next</button><input id="t" type="text"><input id="r" type="radio">`;
  registry = new Map([
    ["e1", document.getElementById("b")!],
    ["e2", document.getElementById("t")!],
    ["e3", document.getElementById("r")!],
  ]);
});

describe("validateAction", () => {
  it.each([
    [act({ action: "click", target: "e1" }), null],
    [act({ action: "click", target: "e9" }), /not observed/],
    [act({ action: "click" }), /needs a target/],
    [act({ action: "type", target: "e2", value: "hi" }), null],
    [act({ action: "type", target: "e3", value: "hi" }), /text field/],
    [act({ action: "wait", value: "500" }), null],
    [act({ action: "wait", value: "60000" }), /0–5000/],
    [act({ action: "scroll", value: "sideways" }), /up or down/],
    [act({ action: "navigate", value: "/complete.html" }), null],
    [act({ action: "navigate", value: "https://elsewhere.example/" }), /stay on the assessment/],
    [act({ action: "rm -rf" as any, target: "e1" }), /Unknown action/],
    [act({ action: "finish" }), null],
  ])("%j", (a, expected) => {
    const result = validateAction(a, registry, PAGE);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toMatch(expected);
  });

  it("rejects a target that has left the page", () => {
    document.getElementById("b")!.remove();
    expect(validateAction(act({ target: "e1" }), registry, PAGE)).toMatch(/no longer on the page/);
  });
});

describe("executeAction", () => {
  it("types through the native value setter and fires input/change", async () => {
    const seen: string[] = [];
    const t = document.getElementById("t") as HTMLInputElement;
    t.addEventListener("input", () => seen.push("input"));
    t.addEventListener("change", () => seen.push("change"));
    await executeAction(act({ action: "type", target: "e2", value: "42" }), registry, document);
    expect([t.value, seen]).toEqual(["42", ["input", "change"]]);
  });

  it("clicks the target", async () => {
    let clicked = 0;
    document.getElementById("b")!.addEventListener("click", () => clicked++);
    await executeAction(act({ action: "click", target: "e1" }), registry, document);
    expect(clicked).toBe(1);
  });
});

describe("agent report", () => {
  const ev = (question: number | null, step: string, ok = true, detail?: string): ActionEvent => ({ at: 0, question, questionId: null, step, ok, detail });
  const session = {
    state: "complete",
    current: { total: 2 },
    report: { total_questions: 2, accuracy: 0.5 },
    results: [
      { answer: "A", selected: true, provider: "MISTRAL", api_latency_ms: 100, confidence: 0.9 },
      { answer: "B", selected: true, provider: "NVIDIA", api_latency_ms: 300, confidence: 0.7 },
    ],
    actions: [
      ev(null, "page sent to AI", true, "12 elements + screenshot"),
      ev(1, "observed"),
      ev(1, "transition verified", false, "page did not change"),
      ev(1, "recovery"),
      ev(1, "transition verified"),
      ev(2, "observed"),
    ],
  } as unknown as Session;

  it("summarises the run", () => {
    expect(agentSummary(session)).toMatchObject({
      status: "complete",
      total_questions: 2,
      questions_answered: 2,
      answers_selected: 2,
      accuracy: 0.5,
      providers: ["MISTRAL", "NVIDIA"],
      avg_response_ms: 200,
      failed_actions: 1,
      recovery_attempts: 1,
      ai_page_readings: 1,
      screenshots_used: 1,
    });
    expect(agentSummary(session).avg_confidence).toBeCloseTo(0.8);
  });

  it("groups the action history by question", () => {
    expect(historyByQuestion(session.actions).map((g) => [g.label, g.events.length, g.failed])).toEqual([
      ["Page", 1, false],
      ["Question 1", 4, true],
      ["Question 2", 1, false],
    ]);
  });
});
