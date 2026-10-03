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
  action?: "select_answer";
  provider: string;
  model: string;
  latency_ms: number;
  attempts: number;
  fallback_used: boolean;
}

export interface QuestionResult {
  question_id: string;
  question_number: number | null;
  question_text?: string | null;
  answer: string | null;
  answer_text?: string | null;
  confidence: number | null;
  provider: string | null;
  api_latency_ms: number | null;
  processing_ms: number;
  selected: boolean;
  error: string | null;
}

export interface GradingReport {
  session_id: string;
  test_id: string | null;
  mode: string;
  provider: string;
  total_questions: number;
  processed: number;
  answered: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  errors: number;
  accuracy: number; // correct / answered
  score: number; // correct / total_questions
  completion_rate: number;
  avg_confidence: number | null;
  avg_confidence_correct: number | null;
  avg_confidence_incorrect: number | null;
  avg_api_latency_ms: number | null;
  avg_processing_ms: number | null;
  total_duration_ms: number | null;
  incorrect_questions: { question_id: string; given: string | null; expected: string }[];
}

// ---- Browser agent (/agent/decide) -----------------------------------------

export type AgentTask = "understand" | "recover";
export type PageState = "question" | "loading" | "complete" | "other";
export const BROWSER_ACTIONS = ["select_answer", "click", "type", "scroll", "wait", "navigate", "finish", "retry"] as const;
export type BrowserActionName = (typeof BROWSER_ACTIONS)[number];

export interface SnapshotElement {
  id: string; // "e12" — only meaningful within one observation
  tag: string;
  role: string;
  text: string;
  state: string[];
  group: string | null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  texts: string[];
  elements: SnapshotElement[];
}

export interface BrowserAction {
  action: BrowserActionName;
  target: string | null;
  value: string | null;
}

export interface AgentDecision {
  page_state: PageState;
  question_text: string | null;
  option_ids: string[];
  next_id: string | null;
  action: BrowserAction;
  confidence: number;
}

export interface AgentDecideRequest {
  session_id: string;
  test_id: string | null;
  page_url: string;
  provider: ProviderMode;
  task: AgentTask;
  goal: string;
  snapshot: PageSnapshot;
  history: string[];
  screenshot: string | null;
}

export interface AgentDecideResponse extends AgentDecision {
  provider: string;
  model: string;
  latency_ms: number;
  attempts: number;
  fallback_used: boolean;
  used_screenshot: boolean;
}

/** One step of the agent's action history (shown in the report, saved with the run). */
export interface ActionEvent {
  at: number;
  question: number | null; // question number when known
  questionId: string | null;
  step: string; // "observed", "understood", "answer selected", "option clicked", "recovery", ...
  ok: boolean;
  detail?: string;
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
  actions: ActionEvent[];
  report: GradingReport | null;
  reportError?: string | null;
}

export interface BackendStatus {
  online: boolean;
  checkedAt: number;
  health: HealthResponse | null;
  error: string | null;
}
