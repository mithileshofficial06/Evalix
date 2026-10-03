// Types shared by background, content script and popup.
// The backend API types mirror backend/app/schemas.py.

export type Mode = "dry-run" | "automation";
export type ProviderMode = "AUTO" | "MISTRAL" | "NVIDIA" | "MOCK";

export type RunState =
  | "idle"
  | "waiting" // waiting for a question to appear / change
  | "extracting"
  | "asking"
  | "selecting"
  | "navigating"
  | "reviewing" // dry-run: answer shown, waiting for the user to advance manually
  | "complete"
  | "stopped"
  | "error";

export interface Settings {
  enabled: boolean;
  mode: Mode;
  provider: ProviderMode;
  backendUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: "dry-run",
  provider: "AUTO",
  backendUrl: "http://localhost:8000",
};

// ---- Page / question model -------------------------------------------------

export interface PageInfo {
  adapter: string;
  testId: string | null;
  environment: string; // e.g. "synthetic", "staging"
  automationAllowed: boolean; // full automation only on synthetic environments
  url: string;
}

export interface OptionItem {
  id: string; // "A", "B", ...
  text: string;
}

export interface ExtractedQuestion {
  questionId: string;
  questionNumber: number | null;
  totalQuestions: number | null;
  text: string;
  options: OptionItem[];
}

// ---- Backend API -----------------------------------------------------------

export interface ProviderStatus {
  name: string;
  configured: boolean;
  model: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  default_provider: string;
  providers: ProviderStatus[];
  allowed_page_origins: string[];
}

export interface AnswerRequest {
  session_id: string;
  test_id: string | null;
  page_url: string;
  provider: ProviderMode;
  question_id: string;
  question_number: number | null;
  text: string;
  options: OptionItem[];
}

export interface AnswerResponse {
  answer: string;
  confidence: number;
  provider: string;
  model: string;
  latency_ms: number;
  attempts: number;
  fallback_used: boolean;
}

export interface QuestionResult {
  question_id: string;
  question_number: number | null;
  answer: string | null;
  confidence: number | null;
  provider: string | null;
  api_latency_ms: number | null;
  processing_ms: number;
  selected: boolean;
  error: string | null;
}

export interface GradingReport {
  test_id: string;
  total_questions: number;
  processed: number;
  answered: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
  completion_rate: number;
  avg_confidence: number | null;
  avg_confidence_correct: number | null;
  avg_confidence_incorrect: number | null;
  avg_api_latency_ms: number | null;
  avg_processing_ms: number | null;
  total_duration_ms: number | null;
  incorrect_questions: { question_id: string; given: string | null; expected: string }[];
}

// ---- Session (persisted in chrome.storage.local) ---------------------------

export interface LogEntry {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface CurrentQuestion {
  questionId: string;
  number: number | null;
  total: number | null;
  text: string;
  answer: string | null;
  confidence: number | null;
}

export interface Session {
  id: string;
  tabId: number;
  mode: Mode;
  provider: ProviderMode;
  page: PageInfo;
  state: RunState;
  startedAt: number;
  finishedAt: number | null;
  current: CurrentQuestion | null;
  results: QuestionResult[];
  errorCount: number;
  logs: LogEntry[];
  report: GradingReport | null;
}

export interface BackendStatus {
  online: boolean;
  checkedAt: number;
  health: HealthResponse | null;
  error: string | null;
}
