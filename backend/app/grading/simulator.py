"""Grading simulator: scores a run against the predefined answer key."""

from __future__ import annotations

import re
from statistics import mean

from ..schemas import GradingReport, IncorrectAnswer, QuestionResultIn, ScoreResponse, SessionReport


def _avg(values: list[float]) -> float | None:
    return round(mean(values), 4) if values else None


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _is_correct(r: QuestionResultIn, letter: str, text: str | None) -> bool:
    # The agent letters options in on-screen order; if the page shuffled them, only the option
    # text identifies the answer, so prefer it when both sides have it.
    if r.answer_text and text:
        return _norm(r.answer_text) == _norm(text)
    return r.answer == letter


def grade_session(report: SessionReport, key: dict[str, str], texts: dict[str, str] | None = None) -> GradingReport:
    texts = texts or {}
    # Last result per question wins (a question can be retried).
    by_q: dict[str, QuestionResultIn] = {r.question_id: r for r in report.results}
    in_key = {qid: r for qid, r in by_q.items() if qid in key}

    answered = {qid: r for qid, r in in_key.items() if r.answer}
    correct = {qid for qid, r in answered.items() if _is_correct(r, key[qid], texts.get(qid))}
    incorrect = [
        IncorrectAnswer(question_id=qid, given=r.answer, expected=key[qid])
        for qid, r in sorted(answered.items())
        if qid not in correct
    ]
    # In automation a question only counts as completed if the answer was actually selected on the
    # page; in dry-run nothing is selected, so an answer is enough.
    completed = [r for r in answered.values() if r.selected or report.mode == "dry-run"]

    confidences = {qid: r.confidence for qid, r in answered.items() if r.confidence is not None}
    total = len(key)
    return GradingReport(
        session_id=report.session_id,
        test_id=report.test_id,
        mode=report.mode,
        provider=report.provider,
        total_questions=total,
        processed=len(by_q),
        answered=len(answered),
        correct=len(correct),
        incorrect=len(incorrect),
        unanswered=total - len(answered),
        errors=sum(1 for r in by_q.values() if r.error),
        accuracy=round(len(correct) / len(answered), 4) if answered else 0.0,
        score=round(len(correct) / total, 4) if total else 0.0,
        completion_rate=round(len(completed) / total, 4) if total else 0.0,
        avg_confidence=_avg(list(confidences.values())),
        avg_confidence_correct=_avg([c for q, c in confidences.items() if q in correct]),
        avg_confidence_incorrect=_avg([c for q, c in confidences.items() if q not in correct]),
        avg_api_latency_ms=_avg([r.api_latency_ms for r in by_q.values() if r.api_latency_ms is not None]),
        avg_processing_ms=_avg([r.processing_ms for r in by_q.values()]),
        total_duration_ms=(report.finished_at - report.started_at) if report.finished_at else None,
        incorrect_questions=incorrect,
    )


def score_answers(test_id: str, answers: dict[str, str], key: dict[str, str]) -> ScoreResponse:
    correct = sum(1 for qid, letter in answers.items() if key.get(qid) == letter)
    answered = sum(1 for qid in answers if qid in key)
    total = len(key)
    return ScoreResponse(
        test_id=test_id,
        total_questions=total,
        answered=answered,
        correct=correct,
        unanswered=total - answered,
        accuracy=round(correct / total, 4) if total else 0.0,
    )
