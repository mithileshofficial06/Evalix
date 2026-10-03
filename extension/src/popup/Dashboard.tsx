import { useEffect, useState } from "react";
import { clock, liveMetrics, ms, pct } from "../shared/metrics";
import { isActive } from "../shared/state";
import type { GradingReport, Session } from "../shared/types";

const STATE_LABEL: Record<Session["state"], string> = {
  idle: "Idle",
  waiting: "Waiting for question",
  extracting: "Extracting",
  asking: "Asking AI",
  selecting: "Selecting answer",
  navigating: "Navigating",
  reviewing: "Dry run — review suggestion",
  complete: "Complete",
  stopped: "Stopped",
  error: "Error",
};

/** Re-render every second while a session runs so elapsed time ticks. */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function Dashboard({ session }: { session: Session }) {
  const active = isActive(session);
  const now = useNow(active);
  const m = liveMetrics(session, now);
  const total = session.current?.total ?? session.report?.total_questions ?? null;

  return (
    <>
      <section className="card">
        <h2>Session</h2>
        <dl className="kv">
          <dt>State</dt>
          <dd>
            <span className={`dot ${session.state === "error" ? "err" : active ? "ok" : "warn"}`} />
            {STATE_LABEL[session.state]}
          </dd>
          <dt>Mode</dt>
          <dd>{session.mode === "dry-run" ? "Dry Run" : "Automation"}</dd>
          <dt>AI provider</dt>
          <dd>{m.lastProvider ? `${m.lastProvider} (${session.provider})` : session.provider}</dd>
          <dt>Questions</dt>
          <dd>
            {m.processed}
            {total ? ` / ${total}` : ""}
          </dd>
          <dt>Answers returned</dt>
          <dd>{m.answersReturned}</dd>
          <dt>Confidence (avg)</dt>
          <dd>{pct(m.avgConfidence)}</dd>
          <dt>API latency (avg)</dt>
          <dd>{ms(m.avgLatencyMs)}</dd>
          <dt>Per question (avg)</dt>
          <dd>{ms(m.avgProcessingMs)}</dd>
          <dt>Errors</dt>
          <dd style={m.errors ? { color: "var(--err)" } : undefined}>{m.errors}</dd>
          <dt>Time</dt>
          <dd>{clock(m.elapsedMs)}</dd>
        </dl>
      </section>

      {session.current && (
        <section className="card">
          <h2>
            Current question {session.current.number ?? ""}
            {session.current.total ? ` of ${session.current.total}` : ""}
          </h2>
          <p className="question">{session.current.text}</p>
          {session.current.answer && (
            <p>
              <strong>Answer: {session.current.answer}</strong> · Confidence {pct(session.current.confidence, 0)}
            </p>
          )}
        </section>
      )}

      {session.report && <Report report={session.report} />}
      {session.reportError && !session.report && <p className="notice err">Grading unavailable: {session.reportError}</p>}

      <section className="card">
        <h2>Session logs</h2>
        <ul className="logs">
          {session.logs
            .slice(-40)
            .reverse()
            .map((l, i) => (
              <li key={i} className={l.level}>
                {new Date(l.at).toLocaleTimeString()} {l.level === "error" ? "✗" : l.level === "warn" ? "!" : "✓"} {l.message}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}

function Report({ report }: { report: GradingReport }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="card">
      <h2>Evalix report — {report.test_id}</h2>
      <dl className="kv">
        <dt>Score</dt>
        <dd>
          {report.correct} / {report.total_questions} ({pct(report.score)})
        </dd>
        <dt>Accuracy (answered)</dt>
        <dd>{pct(report.accuracy)}</dd>
        <dt>Incorrect</dt>
        <dd>{report.incorrect}</dd>
        <dt>Unanswered</dt>
        <dd>{report.unanswered}</dd>
        <dt>Completion rate</dt>
        <dd>{pct(report.completion_rate)}</dd>
        <dt>Confidence ✓ / ✗</dt>
        <dd>
          {pct(report.avg_confidence_correct, 0)} / {pct(report.avg_confidence_incorrect, 0)}
        </dd>
        <dt>API latency (avg)</dt>
        <dd>{ms(report.avg_api_latency_ms)}</dd>
        <dt>Processing (avg)</dt>
        <dd>{ms(report.avg_processing_ms)}</dd>
        <dt>Duration</dt>
        <dd>{report.total_duration_ms != null ? clock(report.total_duration_ms) : "—"}</dd>
      </dl>
      {report.incorrect_questions.length > 0 && (
        <p className="notice">
          Wrong: {report.incorrect_questions.map((q) => `${q.question_id} (${q.given ?? "—"}→${q.expected})`).join(", ")}
        </p>
      )}
      <button onClick={copy} style={{ marginTop: 8 }}>
        {copied ? "Copied" : "Copy report JSON"}
      </button>
    </section>
  );
}
