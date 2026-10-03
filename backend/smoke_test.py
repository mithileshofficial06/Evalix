r"""Sends a few real questions to a running backend and prints what each provider returns.

    .\.venv\Scripts\python smoke_test.py NVIDIA [count]     (or MISTRAL / AUTO / MOCK; count defaults to 3)
    .\.venv\Scripts\python smoke_test.py NVIDIA agent       page understanding + recovery (/agent/decide)

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


# A hook-free page where the answer group has to be told apart from a feedback widget, and an
# unlabelled Next button: the cases the agent hands to the AI.
AGENT_SNAPSHOT = {
    "url": "http://localhost:8080/quiz.html?test=quiz-15&hooks=off",
    "title": "Synthetic Assessment",
    "texts": ["Synthetic QA", "Question 4 of 15", "Which planet is known as the Red Planet?", "Rate this question", "Venus", "Mars", "Jupiter", "Saturn"],
    "elements": [
        {"id": "e1", "tag": "a", "role": "link", "text": "Synthetic QA"},
        {"id": "e2", "tag": "button", "role": "button", "text": "👍", "group": "g1"},
        {"id": "e3", "tag": "button", "role": "button", "text": "👎", "group": "g1"},
        {"id": "e4", "tag": "div", "role": "clickable", "text": "Venus", "group": "g2"},
        {"id": "e5", "tag": "div", "role": "clickable", "text": "Mars", "group": "g2", "state": ["highlighted"]},
        {"id": "e6", "tag": "div", "role": "clickable", "text": "Jupiter", "group": "g2"},
        {"id": "e7", "tag": "div", "role": "clickable", "text": "Saturn", "group": "g2"},
        {"id": "e8", "tag": "button", "role": "button", "text": "⇨ Go on"},
    ],
}


def agent(provider: str) -> int:
    failures = 0
    cases = [
        ("understand", "", [], lambda d: d["page_state"] == "question" and d["option_ids"] == ["e4", "e5", "e6", "e7"]),
        (
            "recover",
            "advance to the next question (the answer is already selected)",
            ["could not find a Next/Finish control"],
            lambda d: d["action"]["action"] == "click" and d["action"]["target"] == "e8",
        ),
    ]
    for task, goal, history, ok in cases:
        body = {
            "session_id": "smoke", "test_id": "quiz-15", "page_url": AGENT_SNAPSHOT["url"], "provider": provider,
            "task": task, "goal": goal, "snapshot": AGENT_SNAPSHOT, "history": history,
        }
        r = httpx.post("http://localhost:8000/agent/decide", json=body, timeout=120)
        if r.status_code != 200:
            failures += 1
            print(f"{task:10}  ERROR {r.status_code}: {r.text[:300]}")
            continue
        d = r.json()
        good = ok(d)
        failures += not good
        print(
            f"{task:10}  {'✓' if good else '✗'} state={d['page_state']} options={d['option_ids']} next={d['next_id']} "
            f"action={d['action']} conf={d['confidence']:.2f} {d['provider']}/{d['model']} {d['latency_ms']:.0f}ms"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    provider = sys.argv[1].upper() if len(sys.argv) > 1 else "AUTO"
    if len(sys.argv) > 2 and sys.argv[2] == "agent":
        sys.exit(agent(provider))
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    sys.exit(main(provider, count))
