import { beforeEach, describe, expect, it } from "vitest";
import { SemanticAdapter } from "../src/content/adapters/semantic";
import { Runner } from "../src/content/runner";
import { fakeBridge, reply, until } from "./helpers/bridge";
import { renderQuestion, SAMPLE, setupPage } from "./helpers/site";

const adapter = new SemanticAdapter();
const timing = { questionTimeoutMs: 2000, dryRunTimeoutMs: 2000, quietMs: 20 };

beforeEach(() => setupPage());

describe("Runner — dry-run", () => {
  it("highlights the AI's choice without selecting or advancing", async () => {
    const { recorded } = renderQuestion("radio");
    const { bridge, events } = fakeBridge(() => reply("B", 0.94));
    const runner = new Runner(adapter, document, bridge, timing);
    void runner.start("dry-run");

    await until(() => events.results.length === 1);
    expect(events.results[0]).toMatchObject({ question_id: "q07", answer: "B", confidence: 0.94, selected: false, error: null });
    expect(recorded).toEqual([]); // the page never received a selection
    expect(document.querySelector('[data-evalix-highlight="B"]')?.textContent).toContain("Heart");
    expect(events.states.at(-1)).toBe("reviewing");
    runner.stop();
  });

  it("processes the next question when the human advances", async () => {
    renderQuestion("radio");
    const { bridge, events } = fakeBridge(() => reply("A"));
    const runner = new Runner(adapter, document, bridge, timing);
    void runner.start("dry-run");
    await until(() => events.results.length === 1);

    renderQuestion("select", { number: 8, q: { ...SAMPLE, id: "q08", text: "Next one?" } });
    await until(() => events.results.length === 2);
    expect(events.started).toEqual(["q07", "q08"]);
    runner.stop();
  });

  it("records AI failures and keeps waiting in dry-run", async () => {
    renderQuestion("radio");
    const { bridge, events } = fakeBridge(() => ({ ok: false, error: "HTTP 502" }));
    const runner = new Runner(adapter, document, bridge, timing);
    void runner.start("dry-run");
    await until(() => events.results.length === 1);
    expect(events.results[0].error).toMatch(/HTTP 502/);
    expect(events.failed).toBeNull();
    runner.stop();
  });

  it("stop() aborts the wait and clears highlights", async () => {
    renderQuestion("cards");
    const { bridge, events } = fakeBridge(() => reply("C"));
    const runner = new Runner(adapter, document, bridge, timing);
    const done = runner.start("dry-run");
    await until(() => events.results.length === 1);
    runner.stop();
    await done;
    expect(runner.isRunning).toBe(false);
    expect(document.querySelector("[data-evalix-highlight]")).toBeNull();
    expect(events.failed).toBeNull();
  });
});
