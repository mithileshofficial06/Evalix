import { beforeEach, describe, expect, it } from "vitest";
import { SemanticAdapter } from "../src/content/adapters/semantic";
import { Runner } from "../src/content/runner";
import { fakeBridge, reply } from "./helpers/bridge";
import { makeQuestions, runQuiz } from "./helpers/quiz";
import { renderQuestion, setupPage } from "./helpers/site";

const adapter = new SemanticAdapter();
const timing = {
  questionTimeoutMs: 2000,
  dryRunTimeoutMs: 2000,
  quietMs: 20,
  enableTimeoutMs: 500,
  reactTimeoutMs: 300,
  actionDelayMs: 0,
};

beforeEach(() => setupPage());

describe("Runner — full automation", () => {
  it("answers every question across all layouts and Next variants, then completes", async () => {
    const questions = makeQuestions(12);
    const quiz = runQuiz(questions);
    const byId = Object.fromEntries(questions.map((q) => [q.id, q.correct]));
    const { bridge, events } = fakeBridge((q) => reply(byId[q.questionId]));

    await new Runner(adapter, document, bridge, timing).start("automation");

    expect(events.failed).toBeNull();
    expect(events.completed).toBe(true);
    expect(events.results).toHaveLength(12);
    expect(events.results.every((r) => r.selected && !r.error)).toBe(true);
    expect(quiz.answers).toEqual(byId); // the page recorded exactly what the AI chose
  });

  it("clicks again when the page swallows the first click", async () => {
    const questions = makeQuestions(2);
    runQuiz(questions, { ignoreFirstClick: true });
    const { bridge, events } = fakeBridge(() => reply("A"));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.completed).toBe(true);
  });

  it("stops with an error when the AI fails", async () => {
    runQuiz(makeQuestions(3));
    const { bridge, events } = fakeBridge(() => ({ ok: false, error: "All providers failed" }));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.completed).toBe(false);
    expect(events.failed).toMatch(/AI request failed/);
    expect(events.results).toHaveLength(1);
  });

  it("stops with an error when there is no Next control", async () => {
    renderQuestion("radio");
    document.getElementById("nav")!.innerHTML = "";
    const { bridge, events } = fakeBridge(() => reply("B"));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.failed).toMatch(/No Next\/Finish control/);
  });

  it("stops with an error when Next never enables", async () => {
    renderQuestion("radio", { nav: "button" }); // disabled button with no page logic to enable it
    const { bridge, events } = fakeBridge(() => reply("B"));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.failed).toMatch(/stayed disabled/);
  });

  it("reports completion immediately when started on the completion page", async () => {
    setupPage({ "evalix-qa": "enabled", "evalix-environment": "synthetic", "evalix-page": "complete" });
    const { bridge, events } = fakeBridge(() => reply("A"));
    await new Runner(adapter, document, bridge, timing).start("automation");
    expect(events.completed).toBe(true);
    expect(events.results).toHaveLength(0);
  });
});
