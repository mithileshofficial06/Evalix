"""Mock provider: answers synthetic tests from the answer key with configurable accuracy.

Lets you exercise the whole automation loop, retries and grading without spending API credits.
Deterministic per (session, question), so a rerun of the same session gives the same answers.
Its `decide` is a small rule-based page reader standing in for a real model's page understanding.
"""

from __future__ import annotations

import asyncio
import hashlib
import random
import re
from collections import defaultdict

from ..grading.keys import load_answer_texts, load_key, resolve_question_id
from ..schemas import AgentDecideRequest, AgentDecision, AnswerRequest, BrowserAction
from .agent_prompt import validate_decision
from .base import ProviderAnswer, ProviderDecision, ProviderError
from .prompt import InvalidModelOutput

CHOICE_ROLES = {"radio", "option", "checkbox", "toggle", "clickable"}
NEXT_TEXT = re.compile(r"\b(next|continue|finish|submit|proceed|advance)\b|→|›|»", re.IGNORECASE)
PROGRESS = re.compile(r"^\s*question\s+\d+\s+(of|/)\s+\d+\s*$", re.IGNORECASE)
COMPLETE = re.compile(r"assessment (complete|submitted)|thank you|your score", re.IGNORECASE)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


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
        correct = self._correct_letter(req)
        if correct is None or correct not in letters:
            raise ProviderError(
                f"MOCK has no answer key entry for {req.test_id}/{req.question_id}", retryable=False
            )

        if rng.random() < self.accuracy:
            return ProviderAnswer(answer=correct, confidence=round(rng.uniform(0.75, 0.99), 2), model=self.model)
        wrong = rng.choice([letter for letter in letters if letter != correct])
        return ProviderAnswer(answer=wrong, confidence=round(rng.uniform(0.3, 0.7), 2), model=self.model)

    @staticmethod
    def _correct_letter(req: AnswerRequest) -> str | None:
        if not req.test_id:
            return None
        qid = resolve_question_id(req.test_id, req.question_id, req.text)
        # Match by option text first: the page may display options in a different order.
        texts = load_answer_texts(req.test_id) or {}
        wanted = texts.get(qid)
        if wanted:
            for o in req.options:
                if _norm(o.text) == _norm(wanted):
                    return o.id
        key = load_key(req.test_id)
        return key.get(qid) if key else None

    async def decide(self, req: AgentDecideRequest) -> ProviderDecision:
        await asyncio.sleep(self.latency_range[0])
        decision = self._read_page(req)
        try:
            validate_decision(decision, req)
        except InvalidModelOutput as e:
            raise ProviderError(f"MOCK invalid decision: {e}", retryable=False) from e
        return ProviderDecision(decision=decision, model=self.model, used_screenshot=bool(req.screenshot))

    def _read_page(self, req: AgentDecideRequest) -> AgentDecision:
        els = req.snapshot.elements
        groups: dict[str, list] = defaultdict(list)
        for e in els:
            if e.role in CHOICE_ROLES and "disabled" not in e.state:
                groups[e.group or "_"].append(e)
        options = max(groups.values(), key=len, default=[])
        options = options if len(options) >= 2 else []
        option_ids = {e.id for e in options}

        nav = [e for e in els if e.id not in option_ids and e.role in ("button", "link", "submit")]
        nexts = [e for e in nav if NEXT_TEXT.search(e.text)]
        # Without a recognisable label, the only button outside the answer group is the best guess
        # (links usually lead away from the assessment).
        buttons = [e for e in nav if e.role in ("button", "submit")]
        next_el = nexts[0] if nexts else buttons[0] if len(buttons) == 1 else nav[0] if len(nav) == 1 else None

        option_texts = {_norm(e.text) for e in options}
        question = next(
            (t for t in sorted(req.snapshot.texts, key=len, reverse=True)
             if not PROGRESS.match(t) and _norm(t) not in option_texts and len(t) > 3),
            None,
        )

        if options:
            state, action = "question", BrowserAction(action="select_answer")
            if req.task == "recover" and next_el and "disabled" not in next_el.state:
                action = BrowserAction(action="click", target=next_el.id)
        elif any(COMPLETE.search(t) for t in req.snapshot.texts + [req.snapshot.title]):
            state, action = "complete", BrowserAction(action="finish")
        else:
            state, action = "loading", BrowserAction(action="wait", value="500")
        return AgentDecision(
            page_state=state,
            question_text=question if options else None,
            option_ids=[e.id for e in options],
            next_id=next_el.id if next_el else None,
            action=action,
            confidence=0.9 if options else 0.6,
        )
