from app.schemas import AgentDecideRequest, AnswerRequest


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


# The synthetic quiz's radio layout as the extension's page snapshot describes it.
SNAPSHOT = {
    "url": "http://localhost:8080/quiz.html?test=quiz-15",
    "title": "Synthetic Assessment",
    "texts": ["Question 1 of 15", "What is 7 × 8?", "54", "48", "64", "56"],
    "elements": [
        {"id": "e1", "tag": "a", "role": "link", "text": "Synthetic QA"},
        {"id": "e2", "tag": "input", "role": "radio", "text": "54", "group": "g1"},
        {"id": "e3", "tag": "input", "role": "radio", "text": "48", "group": "g1"},
        {"id": "e4", "tag": "input", "role": "radio", "text": "64", "group": "g1"},
        {"id": "e5", "tag": "input", "role": "radio", "text": "56", "group": "g1"},
        {"id": "e6", "tag": "button", "role": "button", "text": "Next", "state": ["disabled"]},
    ],
}


def make_decide_request(**overrides) -> AgentDecideRequest:
    data = {
        "session_id": "s1",
        "test_id": "quiz-15",
        "page_url": SNAPSHOT["url"],
        "provider": None,
        "task": "understand",
        "snapshot": SNAPSHOT,
    }
    data.update(overrides)
    return AgentDecideRequest(**data)
