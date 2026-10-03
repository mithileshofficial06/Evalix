// End-of-run agent report: how the agent got through the assessment (the graded score comes from
// the backend). Computed from the session so it is identical in the popup and in the saved report.
import type { ActionEvent, Session } from "./types";

export interface AgentSummary {
  status: "running" | "complete" | "stopped" | "error";
  total_questions: number | null;
  questions_processed: number;
  questions_answered: number;
  answers_selected: number;
  accuracy: number | null; // from grading, when available
  providers: string[];
  avg_response_ms: number | null;
  avg_confidence: number | null;
  failed_actions: number;
  recovery_attempts: number;
  ai_page_readings: number;
  screenshots_used: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function agentSummary(s: Session): AgentSummary {
  const actions = s.actions ?? [];
  const answered = s.results.filter((r) => r.answer);
  const status = s.state === "complete" || s.state === "stopped" || s.state === "error" ? s.state : "running";
  return {
    status,
    total_questions: s.report?.total_questions ?? s.current?.total ?? null,
    questions_processed: s.results.length,
    questions_answered: answered.length,
    answers_selected: s.results.filter((r) => r.selected).length,
    accuracy: s.report?.accuracy ?? null,
    providers: [...new Set(answered.map((r) => r.provider).filter((p): p is string => !!p))],
    avg_response_ms: avg(answered.map((r) => r.api_latency_ms).filter((x): x is number => x != null)),
    avg_confidence: avg(answered.map((r) => r.confidence).filter((x): x is number => x != null)),
    failed_actions: actions.filter((a) => !a.ok).length,
    recovery_attempts: actions.filter((a) => a.step === "recovery").length,
    ai_page_readings: actions.filter((a) => a.step === "page sent to AI").length,
    screenshots_used: actions.filter((a) => a.step === "page sent to AI" && a.detail?.includes("screenshot")).length,
  };
}

export interface HistoryGroup {
  label: string;
  failed: boolean;
  events: ActionEvent[];
}

/** Action history grouped per question ("Question 3"), with page-level steps in their own groups. */
export function historyByQuestion(actions: ActionEvent[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const a of actions) {
    const label = a.question != null ? `Question ${a.question}` : a.questionId ? `Question ${a.questionId}` : "Page";
    let g = groups.at(-1);
    if (!g || g.label !== label) groups.push((g = { label, failed: false, events: [] }));
    g.events.push(a);
    if (!a.ok) g.failed = true;
  }
  return groups;
}
