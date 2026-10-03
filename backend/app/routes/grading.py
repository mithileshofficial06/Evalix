from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..grading.keys import KEYS_DIR, load_key
from ..grading.simulator import grade_session, score_answers
from ..schemas import GradingReport, ScoreRequest, ScoreResponse, SessionReport

router = APIRouter(prefix="/grading")
log = logging.getLogger("evalix.grading")

REPORTS_DIR = Path(__file__).resolve().parents[3] / "reports"


def _key_or_404(test_id: str | None) -> dict[str, str]:
    key = load_key(test_id) if test_id else None
    if key is None:
        raise HTTPException(404, f"No answer key for test {test_id!r}")
    return key


@router.get("/tests")
def tests() -> list[dict]:
    return [{"test_id": p.stem, "questions": len(load_key(p.stem) or {})} for p in sorted(KEYS_DIR.glob("*.json"))]


@router.post("/report", response_model=GradingReport)
def report(body: SessionReport) -> GradingReport:
    result = grade_session(body, _key_or_404(body.test_id))
    log.info(
        "session %s %s: accuracy=%.1f%% completion=%.1f%% errors=%d",
        body.session_id, body.test_id, result.accuracy * 100, result.completion_rate * 100, result.errors,
    )
    # Keep a local record of every run for later comparison between providers/models.
    try:
        REPORTS_DIR.mkdir(exist_ok=True)
        safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", body.session_id)
        (REPORTS_DIR / f"{body.started_at}-{safe_id}.json").write_text(
            json.dumps({"session": body.model_dump(), "report": result.model_dump()}, indent=2), encoding="utf-8"
        )
    except OSError as e:
        log.warning("could not save report: %s", e)
    return result


@router.post("/score", response_model=ScoreResponse)
def score(body: ScoreRequest) -> ScoreResponse:
    return score_answers(body.test_id, body.answers, _key_or_404(body.test_id))
