import pytest

from app.grading.keys import load_key
from app.grading.simulator import grade_session
from app.routes import grading as grading_routes
from app.schemas import SessionReport

KEY = {"q01": "A", "q02": "B", "q03": "C", "q04": "D"}


def result(qid, answer, confidence=0.9, selected=True, error=None, latency=100.0, processing=300.0):
    return {
        "question_id": qid,
        "answer": answer,
        "confidence": confidence,
        "provider": "MOCK",
        "api_latency_ms": latency,
        "processing_ms": processing,
        "selected": selected,
        "error": error,
    }


def session(results, mode="automation", finished_at=11_000):
    return SessionReport(
        session_id="s1", test_id="t", mode=mode, provider="MOCK", started_at=1_000, finished_at=finished_at, results=results
    )


def test_metrics():
    r = grade_session(
        session(
            [
                result("q01", "A", 0.9, latency=100),
                result("q02", "B", 0.8, latency=200),
                result("q03", "A", 0.4, latency=300),  # wrong
                result("q04", None, None, selected=False, error="AI failed", latency=None),
            ]
        ),
        KEY,
    )
    assert (r.total_questions, r.processed, r.answered, r.correct, r.incorrect, r.unanswered, r.errors) == (4, 4, 3, 2, 1, 1, 1)
    assert r.accuracy == pytest.approx(2 / 3, abs=1e-4)
    assert r.score == 0.5
    assert r.completion_rate == 0.75
    assert r.avg_confidence == pytest.approx(0.7)
    assert r.avg_confidence_correct == pytest.approx(0.85)
    assert r.avg_confidence_incorrect == pytest.approx(0.4)
    assert r.avg_api_latency_ms == 200
    assert r.avg_processing_ms == 300
    assert r.total_duration_ms == 10_000
    assert [i.model_dump() for i in r.incorrect_questions] == [{"question_id": "q03", "given": "A", "expected": "C"}]


def test_unselected_answers_do_not_count_as_completed_in_automation():
    r = grade_session(session([result("q01", "A", selected=False)]), KEY)
    assert r.correct == 1 and r.completion_rate == 0


def test_dry_run_counts_answers_as_completed():
    r = grade_session(session([result("q01", "A", selected=False)], mode="dry-run"), KEY)
    assert r.completion_rate == 0.25


def test_last_result_per_question_wins():
    r = grade_session(session([result("q01", "B"), result("q01", "A")]), KEY)
    assert r.processed == 1 and r.correct == 1


def test_empty_session():
    r = grade_session(session([], finished_at=None), KEY)
    assert r.accuracy == 0 and r.avg_confidence is None and r.total_duration_ms is None


@pytest.fixture
def reports_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(grading_routes, "REPORTS_DIR", tmp_path)
    return tmp_path


def test_report_endpoint_grades_and_saves(client, reports_dir):
    key = load_key("quiz-15")
    results = [result(qid, letter) for qid, letter in key.items()]
    body = session(results).model_dump() | {"test_id": "quiz-15"}
    r = client.post("/grading/report", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["accuracy"] == 1.0 and r.json()["completion_rate"] == 1.0
    assert len(list(reports_dir.glob("*.json"))) == 1


def test_report_unknown_test_404(client, reports_dir):
    body = session([]).model_dump() | {"test_id": "nope"}
    assert client.post("/grading/report", json=body).status_code == 404


def test_report_rejects_path_traversal_test_id(client, reports_dir):
    body = session([]).model_dump() | {"test_id": "../../app/config"}
    assert client.post("/grading/report", json=body).status_code == 404


def test_score_endpoint(client):
    key = load_key("quiz-15")
    answers = dict(list(key.items())[:10])  # 10 correct, 5 unanswered
    r = client.post("/grading/score", json={"test_id": "quiz-15", "answers": answers}, headers={"Origin": "http://localhost:8080"})
    assert r.status_code == 200
    assert r.json() == {"test_id": "quiz-15", "total_questions": 15, "answered": 10, "correct": 10, "unanswered": 5, "accuracy": round(10 / 15, 4)}


def test_tests_listing(client):
    tests = {t["test_id"]: t["questions"] for t in client.get("/grading/tests").json()}
    assert tests == {"quiz-15": 15, "quiz-50": 50}
