import { describe, expect, it } from "vitest";
import { clock, liveMetrics, ms, pct } from "../src/shared/metrics";
import type { QuestionResult, Session } from "../src/shared/types";

const r = (id: string, over: Partial<QuestionResult> = {}): QuestionResult => ({
  question_id: id,
  question_number: null,
  answer: "A",
  confidence: 0.8,
  provider: "MISTRAL",
  api_latency_ms: 100,
  processing_ms: 400,
  selected: true,
  error: null,
  ...over,
});

const session = (results: QuestionResult[]): Session => ({
  id: "s",
  tabId: 1,
  mode: "automation",
  provider: "AUTO",
  page: { adapter: "semantic", testId: "quiz-15", environment: "synthetic", automationAllowed: true, url: "" },
  state: "waiting",
  startedAt: 0,
  finishedAt: null,
  current: null,
  results,
  errorCount: 1,
  logs: [],
    actions: [],
  report: null,
});

describe("liveMetrics", () => {
  it("aggregates answered results only for latency/confidence", () => {
    const m = liveMetrics(
      session([r("q1", { confidence: 0.9, api_latency_ms: 100 }), r("q2", { confidence: 0.7, api_latency_ms: 300, provider: "NVIDIA" }), r("q3", { answer: null, confidence: null, api_latency_ms: null, selected: false, error: "x", processing_ms: 100 })]),
      65_000,
    );
    expect(m).toEqual({
      processed: 3,
      answersReturned: 2,
      selected: 2,
      avgLatencyMs: 200,
      avgConfidence: 0.8,
      avgProcessingMs: 300,
      lastProvider: "NVIDIA",
      errors: 1,
      elapsedMs: 65_000,
    });
  });

  it("handles an empty session", () => {
    const m = liveMetrics(session([]), 0);
    expect(m.avgLatencyMs).toBeNull();
    expect(m.lastProvider).toBeNull();
  });
});

describe("formatters", () => {
  it("formats", () => {
    expect(pct(0.9412)).toBe("94.1%");
    expect(pct(null)).toBe("—");
    expect(ms(850.4)).toBe("850 ms");
    expect(ms(2345)).toBe("2.35 s");
    expect(clock(272_000)).toBe("04:32");
  });
});
