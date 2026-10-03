// Live session metrics for the dashboard (the authoritative graded report comes from the backend).
import type { Session } from "./types";

export interface LiveMetrics {
  processed: number;
  answersReturned: number;
  selected: number;
  avgLatencyMs: number | null;
  avgConfidence: number | null;
  avgProcessingMs: number | null;
  lastProvider: string | null;
  errors: number;
  elapsedMs: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function liveMetrics(s: Session, now = Date.now()): LiveMetrics {
  const answered = s.results.filter((r) => r.answer);
  return {
    processed: s.results.length,
    answersReturned: answered.length,
    selected: s.results.filter((r) => r.selected).length,
    avgLatencyMs: avg(answered.map((r) => r.api_latency_ms).filter((x): x is number => x != null)),
    avgConfidence: avg(answered.map((r) => r.confidence).filter((x): x is number => x != null)),
    avgProcessingMs: avg(s.results.map((r) => r.processing_ms)),
    lastProvider: answered.at(-1)?.provider ?? null,
    errors: s.errorCount,
    elapsedMs: (s.finishedAt ?? now) - s.startedAt,
  };
}

export const pct = (x: number | null | undefined, digits = 1) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
export const ms = (x: number | null | undefined) => (x == null ? "—" : x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);
export const clock = (x: number) => {
  const s = Math.floor(x / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
