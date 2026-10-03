"""Strict-JSON prompt and tolerant-but-validated parsing of model output."""

from __future__ import annotations

import json
import re

from ..schemas import AnswerRequest

SYSTEM_PROMPT = (
    "You are the answering agent in an automated QA test of an assessment platform. "
    "You receive one multiple-choice question and must choose the single best option.\n"
    "Respond with ONLY a JSON object and nothing else — no prose, no markdown, no code fences:\n"
    '{"answer": "<option letter>", "confidence": <number from 0 to 1>}\n'
    "`answer` must be exactly one of the provided option letters. "
    "`confidence` is your probability that the answer is correct."
)


def build_messages(req: AnswerRequest) -> list[dict[str, str]]:
    letters = ", ".join(o.id for o in req.options)
    lines = [f"Question: {req.text}", "", "Options:"]
    lines += [f"{o.id}. {o.text}" for o in req.options]
    lines += ["", f"Valid answers: {letters}. Reply with the JSON object only."]
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(lines)},
    ]


class InvalidModelOutput(ValueError):
    pass


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)
_LETTER = re.compile(r"^\(?([A-Ja-j])[.):]?\)?$")


def _first_json_object(text: str) -> dict:
    cleaned = _FENCE.sub("", text.strip())
    decoder = json.JSONDecoder()
    for i, ch in enumerate(cleaned):
        if ch == "{":
            try:
                obj, _ = decoder.raw_decode(cleaned[i:])
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                return obj
    raise InvalidModelOutput(f"No JSON object in model output: {text[:200]!r}")


def parse_answer(text: str, req: AnswerRequest) -> tuple[str, float]:
    """Returns (option letter, confidence in [0, 1]) or raises InvalidModelOutput."""
    obj = _first_json_object(text)
    raw_answer = str(obj.get("answer", "")).strip()
    valid = {o.id.upper(): o for o in req.options}

    letter = None
    m = _LETTER.match(raw_answer)
    if m and m.group(1).upper() in valid:
        letter = m.group(1).upper()
    else:
        # Some models answer with the option text instead of its letter.
        by_text = {o.text.strip().lower(): o.id for o in req.options}
        letter = by_text.get(raw_answer.lower())
    if letter is None:
        raise InvalidModelOutput(f"Answer {raw_answer!r} is not one of {sorted(valid)}")

    try:
        confidence = float(obj.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    if 1 < confidence <= 100:  # model replied with a percentage
        confidence /= 100
    return letter, min(max(confidence, 0.0), 1.0)
