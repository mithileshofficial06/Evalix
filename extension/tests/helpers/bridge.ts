import type { AskReply } from "../../src/shared/messages";
import type { ExtractedQuestion, QuestionResult, RunState } from "../../src/shared/types";
import type { Bridge } from "../../src/content/runner";

/** Records everything the runner reports; `answer` decides the AI's reply per question. */
export function fakeBridge(answer: (q: ExtractedQuestion) => AskReply | Promise<AskReply>) {
  const events = {
    states: [] as RunState[],
    results: [] as QuestionResult[],
    started: [] as string[],
    completed: false,
    failed: null as string | null,
  };
  const bridge: Bridge = {
    ask: async (q) => answer(q),
    questionStarted: (q) => events.started.push(q.questionId),
    result: (r) => events.results.push(r),
    state: (s) => events.states.push(s),
    log: () => undefined,
    complete: () => (events.completed = true),
    failed: (e) => (events.failed = e),
  };
  return { bridge, events };
}

export const reply = (letter: string, confidence = 0.9): AskReply => ({
  ok: true,
  answer: { answer: letter, confidence, provider: "MOCK", model: "answer-key", latency_ms: 5, attempts: 1, fallback_used: false },
});

export const until = async (cond: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};
