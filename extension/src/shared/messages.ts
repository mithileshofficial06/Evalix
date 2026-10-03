// Message contracts between popup, background service worker and content script.
import type {
  AnswerResponse,
  ExtractedQuestion,
  LogEntry,
  Mode,
  PageInfo,
  QuestionResult,
  RunState,
} from "./types";

// popup -> background
export type PopupMessage =
  | { type: "CHECK_BACKEND" }
  | { type: "START_SESSION"; tabId: number }
  | { type: "STOP_SESSION" }
  | { type: "PROBE_TAB"; tabId: number };

// content -> background
export type ContentMessage =
  | { type: "HELLO"; page: PageInfo } // sent on every page load; reply tells the page whether to (re)start
  | { type: "ASK"; question: ExtractedQuestion }
  | { type: "QUESTION_STARTED"; question: ExtractedQuestion }
  | { type: "RESULT"; result: QuestionResult }
  | { type: "STATE"; state: RunState }
  | { type: "LOG"; level: LogEntry["level"]; message: string }
  | { type: "COMPLETE" }
  | { type: "FAILED"; error: string };

// background -> content
export type BackgroundMessage = { type: "PROBE" } | { type: "RUN"; mode: Mode } | { type: "STOP" };

export type HelloReply = { run: Mode | null };
export type AskReply = { ok: true; answer: AnswerResponse } | { ok: false; error: string };
export type ProbeReply = { page: PageInfo | null; complete: boolean; question: ExtractedQuestion | null };
export type StartReply = { ok: true } | { ok: false; error: string };
