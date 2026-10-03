// Session lifecycle and the content-script message handlers. All session mutations go through a
// single promise chain so rapid messages from the page can't interleave read-modify-write cycles.
import type { AskReply, BackgroundMessage, ContentMessage, HelloReply, ProbeReply, StartReply } from "../shared/messages";
import { getStore, setSession } from "../shared/storage";
import { isActive } from "../shared/state";
import type { LogEntry, Session } from "../shared/types";

export { isActive };
import { api } from "./api";

const MAX_LOGS = 200;


let queue: Promise<unknown> = Promise.resolve();

/** Serialized read-modify-write of the stored session. */
export function mutateSession(fn: (s: Session) => void | Promise<void>): Promise<Session | null> {
  const next = queue.then(async () => {
    const { session } = await getStore();
    if (!session) return null;
    await fn(session);
    await setSession(session);
    return session;
  });
  queue = next.catch(() => undefined);
  return next;
}

export function pushLog(s: Session, level: LogEntry["level"], message: string) {
  s.logs.push({ at: Date.now(), level, message });
  if (s.logs.length > MAX_LOGS) s.logs.splice(0, s.logs.length - MAX_LOGS);
}

const send = (tabId: number, msg: BackgroundMessage) => chrome.tabs.sendMessage(tabId, msg);

export async function startSession(tabId: number): Promise<StartReply> {
  const { settings, session } = await getStore();
  if (!settings.enabled) return { ok: false, error: "Evalix is switched OFF" };
  if (isActive(session)) return { ok: false, error: "A session is already running — stop it first" };

  let probe: ProbeReply | null = null;
  try {
    probe = (await send(tabId, { type: "PROBE" })) as ProbeReply;
  } catch {
    /* no content script on this tab */
  }
  const page = probe?.page;
  if (!page) return { ok: false, error: "This tab is not an Evalix-enabled assessment page" };
  if (settings.mode === "automation" && !page.automationAllowed) {
    return { ok: false, error: `Full automation is only allowed on synthetic pages (this page: "${page.environment}"). Use Dry Run.` };
  }

  const s: Session = {
    id: crypto.randomUUID(),
    tabId,
    mode: settings.mode,
    provider: settings.provider,
    page,
    state: "waiting",
    startedAt: Date.now(),
    finishedAt: null,
    current: null,
    results: [],
    errorCount: 0,
    logs: [],
    report: null,
  };
  pushLog(s, "info", `Session started: ${s.mode}, provider ${s.provider}, test ${page.testId ?? "unknown"}`);
  await setSession(s);
  await send(tabId, { type: "RUN", mode: s.mode });
  return { ok: true };
}

export async function stopSession(reason = "Stopped by user"): Promise<void> {
  const s = await mutateSession((s) => {
    if (!isActive(s)) return;
    s.state = "stopped";
    s.finishedAt = Date.now();
    pushLog(s, "warn", reason);
  });
  if (s) await send(s.tabId, { type: "STOP" }).catch(() => undefined);
}

export async function handleContentMessage(msg: ContentMessage, tabId: number | undefined): Promise<unknown> {
  const { session, settings } = await getStore();
  const mine = isActive(session) && session.tabId === tabId;

  switch (msg.type) {
    case "HELLO": {
      // A full page load (e.g. navigation to the completion page) restarts the content script;
      // tell it to resume if this tab owns the running session.
      const reply: HelloReply = { run: mine && settings.enabled ? session.mode : null };
      return reply;
    }
    case "ASK": {
      if (!mine) return { ok: false, error: "No active session" } satisfies AskReply;
      try {
        const answer = await api.answer(settings.backendUrl, {
          session_id: session.id,
          test_id: session.page.testId,
          page_url: session.page.url,
          provider: session.provider,
          question_id: msg.question.questionId,
          question_number: msg.question.questionNumber,
          text: msg.question.text,
          options: msg.question.options,
        });
        await mutateSession((s) => {
          if (s.current?.questionId === msg.question.questionId) {
            s.current.answer = answer.answer;
            s.current.confidence = answer.confidence;
          }
          const fb = answer.fallback_used ? " (fallback)" : "";
          pushLog(s, "info", `Q${msg.question.questionNumber ?? "?"}: ${answer.answer} @ ${(answer.confidence * 100).toFixed(0)}% via ${answer.provider}${fb}, ${answer.latency_ms.toFixed(0)} ms`);
        });
        return { ok: true, answer } satisfies AskReply;
      } catch (err) {
        const error = (err as Error).message;
        await mutateSession((s) => {
          s.errorCount++;
          pushLog(s, "error", `Q${msg.question.questionNumber ?? "?"}: AI request failed — ${error}`);
        });
        return { ok: false, error } satisfies AskReply;
      }
    }
    default:
      break;
  }

  if (!mine) return { ok: false };

  await mutateSession((s) => {
    switch (msg.type) {
      case "QUESTION_STARTED":
        s.current = {
          questionId: msg.question.questionId,
          number: msg.question.questionNumber,
          total: msg.question.totalQuestions,
          text: msg.question.text,
          answer: null,
          confidence: null,
        };
        break;
      case "RESULT": {
        const i = s.results.findIndex((r) => r.question_id === msg.result.question_id);
        if (i >= 0) s.results[i] = msg.result;
        else s.results.push(msg.result);
        if (msg.result.error) {
          s.errorCount++;
          pushLog(s, "error", `Q${msg.result.question_number ?? "?"}: ${msg.result.error}`);
        }
        break;
      }
      case "STATE":
        if (isActive(s)) s.state = msg.state;
        break;
      case "LOG":
        pushLog(s, msg.level, msg.message);
        break;
      case "COMPLETE":
        s.state = "complete";
        s.finishedAt = Date.now();
        pushLog(s, "info", `Assessment complete — ${s.results.length} questions processed`);
        break;
      case "FAILED":
        s.state = "error";
        s.finishedAt = Date.now();
        s.errorCount++;
        pushLog(s, "error", `Run stopped: ${msg.error}`);
        break;
    }
  });
  return { ok: true };
}
