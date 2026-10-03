"""API contract shared with the extension (mirrored in extension/src/shared/types.ts)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ProviderMode = Literal["AUTO", "MISTRAL", "NVIDIA", "MOCK"]


class OptionItem(BaseModel):
    id: str = Field(pattern=r"^[A-J]$")
    text: str = Field(min_length=1, max_length=1000)


class AnswerRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    test_id: str | None = Field(default=None, max_length=64)
    page_url: str = Field(max_length=2048)
    provider: ProviderMode | None = None
    question_id: str = Field(min_length=1, max_length=128)
    question_number: int | None = None
    text: str = Field(min_length=1, max_length=4000)
    options: list[OptionItem] = Field(min_length=2, max_length=10)


class AnswerResponse(BaseModel):
    answer: str
    confidence: float = Field(ge=0, le=1)
    action: Literal["select_answer"] = "select_answer"
    provider: str
    model: str
    latency_ms: float
    attempts: int
    fallback_used: bool


class QuestionResultIn(BaseModel):
    question_id: str = Field(max_length=128)
    question_number: int | None = None
    answer: str | None = None
    # Text of the chosen option: lets grading work when the page shuffles option order.
    answer_text: str | None = Field(default=None, max_length=1000)
    confidence: float | None = None
    provider: str | None = None
    api_latency_ms: float | None = None
    processing_ms: float = 0
    selected: bool = False
    error: str | None = None


class SessionReport(BaseModel):
    session_id: str = Field(max_length=64)
    test_id: str | None = None
    mode: Literal["dry-run", "automation"]
    provider: str
    started_at: int
    finished_at: int | None = None
    results: list[QuestionResultIn] = Field(max_length=1000)
    # Agent telemetry, stored with the run for later analysis (not used for grading).
    agent: dict | None = None
    actions: list[dict] = Field(default_factory=list, max_length=5000)


class IncorrectAnswer(BaseModel):
    question_id: str
    given: str | None
    expected: str


class GradingReport(BaseModel):
    session_id: str
    test_id: str | None
    mode: str
    provider: str
    total_questions: int
    processed: int
    answered: int
    correct: int
    incorrect: int
    unanswered: int
    errors: int
    accuracy: float  # correct / answered
    score: float  # correct / total_questions
    completion_rate: float
    avg_confidence: float | None
    avg_confidence_correct: float | None
    avg_confidence_incorrect: float | None
    avg_api_latency_ms: float | None
    avg_processing_ms: float | None
    total_duration_ms: int | None
    incorrect_questions: list[IncorrectAnswer]


class ScoreRequest(BaseModel):
    test_id: str = Field(max_length=64)
    answers: dict[str, str]


class ScoreResponse(BaseModel):
    test_id: str
    total_questions: int
    answered: int
    correct: int
    unanswered: int
    accuracy: float


class ProviderStatus(BaseModel):
    name: str
    configured: bool
    model: str


class HealthResponse(BaseModel):
    status: str
    version: str
    default_provider: str
    providers: list[ProviderStatus]
    allowed_page_origins: list[str]


# ---- Browser agent (/agent/decide) ---------------------------------------------------------
#
# The extension sends a compact snapshot of what is on the page: visible text blocks plus the
# interactive elements, each with an id that is only meaningful for this one observation. The AI
# replies with a structured decision that may only reference those ids. Everything is validated
# (here and again in the extension) before anything touches the page.

AgentTask = Literal["understand", "recover"]
PageState = Literal["question", "loading", "complete", "other"]
BrowserActionName = Literal["select_answer", "click", "type", "scroll", "wait", "navigate", "finish", "retry"]
ELEMENT_ID = r"^e\d{1,4}$"


class SnapshotElement(BaseModel):
    id: str = Field(pattern=ELEMENT_ID)
    tag: str = Field(max_length=24)
    role: str = Field(max_length=32)
    text: str = Field(default="", max_length=300)
    state: list[str] = Field(default_factory=list, max_length=8)
    group: str | None = Field(default=None, max_length=64)


class PageSnapshot(BaseModel):
    url: str = Field(max_length=2048)
    title: str = Field(default="", max_length=300)
    texts: list[str] = Field(default_factory=list, max_length=80)
    elements: list[SnapshotElement] = Field(default_factory=list, max_length=250)


class AgentDecideRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    test_id: str | None = Field(default=None, max_length=64)
    page_url: str = Field(max_length=2048)
    provider: ProviderMode | None = None
    task: AgentTask
    goal: str = Field(default="", max_length=300)
    snapshot: PageSnapshot
    history: list[str] = Field(default_factory=list, max_length=20)
    # data:image/jpeg;base64,... — only sent when the DOM alone was not enough.
    screenshot: str | None = Field(default=None, max_length=6_000_000, pattern=r"^data:image/(png|jpeg);base64,")


class BrowserAction(BaseModel):
    action: BrowserActionName
    target: str | None = Field(default=None, pattern=ELEMENT_ID)
    value: str | None = Field(default=None, max_length=500)


class AgentDecision(BaseModel):
    page_state: PageState
    question_text: str | None = Field(default=None, max_length=4000)
    option_ids: list[str] = Field(default_factory=list, max_length=10)
    next_id: str | None = Field(default=None, pattern=ELEMENT_ID)
    action: BrowserAction
    confidence: float = Field(ge=0, le=1)


class AgentDecideResponse(AgentDecision):
    provider: str
    model: str
    latency_ms: float
    attempts: int
    fallback_used: bool
    used_screenshot: bool
