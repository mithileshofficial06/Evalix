import pytest

from app.ai.prompt import InvalidModelOutput, build_messages, parse_answer
from tests.factories import make_request

REQ = make_request()


def test_prompt_lists_options_and_demands_json():
    system, user = build_messages(REQ)
    assert "ONLY a JSON object" in system["content"]
    assert "D. 56" in user["content"]
    assert "Valid answers: A, B, C, D" in user["content"]


@pytest.mark.parametrize(
    "output, expected",
    [
        ('{"answer": "D", "confidence": 0.94}', ("D", 0.94)),
        ('```json\n{"answer": "d", "confidence": 0.9}\n```', ("D", 0.9)),
        ('Sure! {"answer": "(D)", "confidence": 0.8} hope that helps', ("D", 0.8)),
        ('{"answer": "D.", "confidence": 94}', ("D", 0.94)),  # percentage
        ('{"answer": "56", "confidence": 0.7}', ("D", 0.7)),  # option text instead of letter
        ('{"answer": "D"}', ("D", 0.5)),  # missing confidence
        ('{"answer": "D", "confidence": 7.5e3}', ("D", 1.0)),  # clamped
        ('<think>{"answer": "A"} no wait</think>{"answer": "D", "confidence": 0.9}', ("D", 0.9)),  # think block
    ],
)
def test_parse_valid(output, expected):
    assert parse_answer(output, REQ) == expected


@pytest.mark.parametrize(
    "output",
    ["The answer is D", '{"answer": "E", "confidence": 0.9}', '{"confidence": 0.9}', "", '{"answer": "D or C"}'],
)
def test_parse_invalid(output):
    with pytest.raises(InvalidModelOutput):
        parse_answer(output, REQ)
