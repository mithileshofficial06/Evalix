"""Generate synthetic assessment data and answer keys.

    python tools/generate.py

Writes:
  synthetic-site/data/<test>.json        public: questions + lettered options (no answers)
  backend/app/grading/keys/<test>.json   private: question_id -> correct letter (and option text)
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from question_bank import QUESTIONS, TESTS

ROOT = Path(__file__).resolve().parent.parent
SITE_DATA = ROOT / "synthetic-site" / "data"
KEYS = ROOT / "backend" / "app" / "grading" / "keys"
LETTERS = "ABCDEFGH"
SEED = 20261003


def build() -> None:
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    KEYS.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)

    items, key, texts = [], {}, {}
    for i, (text, correct, distractors) in enumerate(QUESTIONS, start=1):
        options = [correct, *distractors]
        rng.shuffle(options)
        qid = f"q{i:02d}"
        items.append(
            {
                "id": qid,
                "text": text,
                "options": [{"id": LETTERS[j], "text": t} for j, t in enumerate(options)],
            }
        )
        key[qid] = LETTERS[options.index(correct)]
        texts[qid] = correct

    for test_id, meta in TESTS.items():
        subset = items[: meta["count"]]
        (SITE_DATA / f"{test_id}.json").write_text(
            json.dumps({"id": test_id, "title": meta["title"], "questions": subset}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (KEYS / f"{test_id}.json").write_text(
            json.dumps(
                {
                    "test_id": test_id,
                    "answers": {q["id"]: key[q["id"]] for q in subset},
                    # Correct option text: grading still works when a page shuffles option order.
                    "texts": {q["id"]: texts[q["id"]] for q in subset},
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"{test_id}: {len(subset)} questions")


if __name__ == "__main__":
    build()
