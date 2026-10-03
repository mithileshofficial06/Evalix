import { useEffect, useState } from "react";
import { agentSummary, historyByQuestion } from "../shared/agentReport";
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
  const agent = agentSummary(session);
  const total = session.current?.total ?? session.report?.total_questions ?? null;
  const lastStep = session.actions?.at(-1);

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
          <dt>Failed actions / recoveries</dt>
          <dd>
            {agent.failed_actions} / {agent.recovery_attempts}
          </dd>
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
          {active && lastStep && (
            <p className="notice">
              {lastStep.ok ? "→" : "✗"} {lastStep.step}
              {lastStep.detail ? ` — ${lastStep.detail}` : ""}
            </p>
          )}
        </section>
      )}

      {!active && <AgentReport session={session} />}
      {session.report && <Report report={session.report} session={session} />}
      {session.reportError && !session.report && <p className="notice err">Grading unavailable: {session.reportError}</p>}

      <History session={session} />

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

const STATUS_LABEL = { running: "Running", complete: "Completed", stopped: "Stopped", error: "Failed" } as const;

/** How the agent got through the assessment (the graded score is in the Evalix report below). */
function AgentReport({ session }: { session: Session }) {
  const a = agentSummary(session);
  return (
    <section className="card">
      <h2>Agent report</h2>
      <dl className="kv">
        <dt>Completion status</dt>
        <dd>
          <span className={`dot ${a.status === "complete" ? "ok" : a.status === "error" ? "err" : "warn"}`} />
          {STATUS_LABEL[a.status]}
        </dd>
        <dt>Total questions</dt>
        <dd>{a.total_questions ?? "—"}</dd>
        <dt>Questions answered</dt>
        <dd>
          {a.questions_answered}
          {session.mode === "automation" ? ` (${a.answers_selected} selected)` : ""}
        </dd>
        <dt>Accuracy</dt>
        <dd>{pct(a.accuracy)}</dd>
        <dt>AI provider used</dt>
        <dd>{a.providers.length ? a.providers.join(", ") : session.provider}</dd>
        <dt>Avg response time</dt>
        <dd>{ms(a.avg_response_ms)}</dd>
        <dt>Avg confidence</dt>
        <dd>{pct(a.avg_confidence)}</dd>
        <dt>Failed actions</dt>
        <dd style={a.failed_actions ? { color: "var(--warn)" } : undefined}>{a.failed_actions}</dd>
        <dt>Recovery attempts</dt>
        <dd>{a.recovery_attempts}</dd>
        <dt>AI page readings</dt>
        <dd>
          {a.ai_page_readings}
          {a.screenshots_used ? ` (${a.screenshots_used} with screenshot)` : ""}
        </dd>
      </dl>
    </section>
  );
}

/** Step-by-step action history, one collapsible block per question. */
function History({ session }: { session: Session }) {
  const groups = historyByQuestion(session.actions ?? []);
  if (!groups.length) return null;
  return (
    <section className="card">
      <h2>Action history</h2>
      <div className="history">
        {groups.map((g, i) => (
          <details key={i} open={i === groups.length - 1}>
            <summary className={g.failed ? "warn" : undefined}>
              {g.label} · {g.events.length} steps{g.failed ? " · had failures" : ""}
            </summary>
            <ol>
              {g.events.map((e, j) => (
                <li key={j} className={e.ok ? undefined : "error"} title={new Date(e.at).toLocaleTimeString()}>
                  {e.ok ? "→" : "✗"} {e.step}
                  {e.detail ? <span className="detail"> — {e.detail}</span> : null}
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}

function Report({ report, session }: { report: GradingReport; session: Session }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const full = { report, agent: agentSummary(session), actions: session.actions ?? [], results: session.results };
    await navigator.clipboard.writeText(JSON.stringify(full, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="card">
      <h2>Evalix report (graded) — {report.test_id}</h2>
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
        {copied ? "Copied" : "Copy full report JSON"}
      </button>
    </section>
  );
}
