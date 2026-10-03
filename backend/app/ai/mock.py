"""Mock provider: answers synthetic tests from the answer key with configurable accuracy.

Lets you exercise the whole automation loop, retries and grading without spending API credits.
Deterministic per (session, question), so a rerun of the same session gives the same answers.
"""

from __future__ import annotations

import asyncio
import hashlib
import random

from ..grading.keys import load_key
from ..schemas import AnswerRequest
from .base import ProviderAnswer, ProviderError


class MockProvider:
    name = "MOCK"
    model = "answer-key"

    def __init__(self, accuracy: float = 0.9, latency_range: tuple[float, float] = (0.02, 0.12)):
        self.accuracy = accuracy
        self.latency_range = latency_range

    async def answer(self, req: AnswerRequest) -> ProviderAnswer:
        seed = hashlib.sha256(f"{req.session_id}:{req.question_id}".encode()).digest()
        rng = random.Random(seed)
        await asyncio.sleep(rng.uniform(*self.latency_range))

        letters = [o.id for o in req.options]
        key = load_key(req.test_id) if req.test_id else None
        correct = key.get(req.question_id) if key else None
        if correct is None or correct not in letters:
            raise ProviderError(
                f"MOCK has no answer key entry for {req.test_id}/{req.question_id}", retryable=False
            )

        if rng.random() < self.accuracy:
            return ProviderAnswer(answer=correct, confidence=round(rng.uniform(0.75, 0.99), 2), model=self.model)
        wrong = rng.choice([letter for letter in letters if letter != correct])
        return ProviderAnswer(answer=wrong, confidence=round(rng.uniform(0.3, 0.7), 2), model=self.model)
