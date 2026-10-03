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
  | { type: "PAGE_READY"; page: PageInfo }
  | { type: "ASK"; question: ExtractedQuestion }
  | { type: "QUESTION_STARTED"; question: ExtractedQuestion }
  | { type: "RESULT"; result: QuestionResult }
  | { type: "STATE"; state: RunState }
  | { type: "LOG"; level: LogEntry["level"]; message: string }
  | { type: "COMPLETE" };

// background -> content
export type BackgroundMessage =
  | { type: "PROBE" }
  | { type: "RUN"; mode: Mode }
  | { type: "STOP" };

export type AskReply = { ok: true; answer: AnswerResponse } | { ok: false; error: string };
export type ProbeReply = { page: PageInfo | null };
