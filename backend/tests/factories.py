from app.schemas import AnswerRequest


def make_request(**overrides) -> AnswerRequest:
    data = {
        "session_id": "s1",
        "test_id": "quiz-15",
        "page_url": "http://localhost:8080/quiz.html?test=quiz-15",
        "provider": None,
        "question_id": "q01",
        "question_number": 1,
        "text": "What is 7 × 8?",
        "options": [
            {"id": "A", "text": "54"},
            {"id": "B", "text": "48"},
            {"id": "C", "text": "64"},
            {"id": "D", "text": "56"},
        ],
    }
    data.update(overrides)
    return AnswerRequest(**data)
