r"""Sends a few real questions to a running backend and prints what each provider returns.

    .\.venv\Scripts\python smoke_test.py NVIDIA [count]     (or MISTRAL / AUTO / MOCK; count defaults to 3)

Costs a handful of API calls. The backend must be running on localhost:8000.
"""

from __future__ import annotations

import json
import sys

import httpx

QUIZ = "../synthetic-site/data/quiz-15.json"
KEY = "app/grading/keys/quiz-15.json"


def main(provider: str, count: int = 3) -> int:
    questions = json.load(open(QUIZ, encoding="utf-8"))["questions"][:count]
    key = json.load(open(KEY, encoding="utf-8"))["answers"]
    failures = 0
    for q in questions:
        body = {
            "session_id": "smoke",
            "test_id": "quiz-15",
            "page_url": "http://localhost:8080/quiz.html",
            "provider": provider,
            "question_id": q["id"],
            "question_number": int(q["id"][1:]),
            "text": q["text"],
            "options": q["options"],
        }
        r = httpx.post("http://localhost:8000/answer", json=body, timeout=90)
        if r.status_code != 200:
            failures += 1
            print(f"{q['id']}  ERROR {r.status_code}: {r.text[:300]}")
            continue
        a = r.json()
        mark = "✓" if a["answer"] == key[q["id"]] else "✗"
        print(
            f"{q['id']}  {mark} answer={a['answer']} expected={key[q['id']]} conf={a['confidence']:.2f} "
            f"{a['provider']}/{a['model']} {a['latency_ms']:.0f}ms attempts={a['attempts']}"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    provider = sys.argv[1].upper() if len(sys.argv) > 1 else "AUTO"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    sys.exit(main(provider, count))
