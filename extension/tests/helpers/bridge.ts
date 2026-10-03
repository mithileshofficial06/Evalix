import type { AskReply, DecideReply } from "../../src/shared/messages";
import type { ActionEvent, AgentDecision, ExtractedQuestion, QuestionResult, RunState } from "../../src/shared/types";
import type { Bridge, DecideInput } from "../../src/content/runner";

type Decide = (input: DecideInput) => DecideReply | Promise<DecideReply>;

/**
 * Records everything the runner reports; `answer` decides the AI's reply per question and
 * `decide` the AI's page reading (default: AI unavailable, so only the heuristics run).
 */
export function fakeBridge(answer: (q: ExtractedQuestion) => AskReply | Promise<AskReply>, decide?: Decide) {
  const events = {
    states: [] as RunState[],
    results: [] as QuestionResult[],
    started: [] as string[],
    actions: [] as Omit<ActionEvent, "at">[],
    decisions: [] as DecideInput[],
    completed: false,
    failed: null as string | null,
  };
  const bridge: Bridge = {
    ask: async (q) => answer(q),
    decide: async (input) => {
      events.decisions.push(input);
      return decide ? decide(input) : { ok: false, error: "AI unavailable in this test" };
    },
    action: (e) => events.actions.push(e),
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
  answer: { answer: letter, confidence, action: "select_answer", provider: "MOCK", model: "answer-key", latency_ms: 5, attempts: 1, fallback_used: false },
});

export const decision = (d: Partial<AgentDecision>, extra: { used_screenshot?: boolean } = {}): DecideReply => ({
  ok: true,
  decision: {
    page_state: "question",
    question_text: null,
    option_ids: [],
    next_id: null,
    action: { action: "select_answer", target: null, value: null },
    confidence: 0.9,
    ...d,
    provider: "MOCK",
    model: "mock",
    latency_ms: 3,
    attempts: 1,
    fallback_used: false,
    used_screenshot: extra.used_screenshot ?? false,
  },
});

export const until = async (cond: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};
