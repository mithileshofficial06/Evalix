"""Prompt and validation for the browser agent's page-understanding / recovery decisions.

The model never gets to issue free-form instructions: it must answer with one JSON object whose
fields are checked against the snapshot it was shown (element ids must exist, targets must be the
right kind of element, navigation must stay on the same origin). Anything else is rejected and the
router retries or falls back to the next provider.
"""

from __future__ import annotations

from urllib.parse import urljoin, urlsplit

from pydantic import ValidationError

from ..schemas import AgentDecideRequest, AgentDecision
from .prompt import InvalidModelOutput, first_json_object

SYSTEM_PROMPT = (
    "You are the perception and control module of Evalix, a QA browser agent that tests an "
    "assessment platform its operator administers. You are shown a snapshot of the current page: "
    "visible text blocks and the interactive elements, each with an id like e12.\n"
    "Respond with ONLY one JSON object and nothing else — no prose, no markdown:\n"
    "{\n"
    '  "page_state": "question" | "loading" | "complete" | "other",\n'
    '  "question_text": "<the current question, verbatim>" or null,\n'
    '  "option_ids": ["<element id of each answer choice, in on-screen order>"],\n'
    '  "next_id": "<element id of the control that advances/submits>" or null,\n'
    '  "action": {"action": "<one of: select_answer, click, type, scroll, wait, navigate, finish, retry>",\n'
    '             "target": "<element id>" or null, "value": "<text, ms, direction or url>" or null},\n'
    '  "confidence": <number from 0 to 1>\n'
    "}\n"
    "Rules:\n"
    "- Only use element ids that appear in the snapshot.\n"
    "- Answer choices are the elements a test-taker clicks to pick an answer, never navigation.\n"
    "- Identify elements by what they represent (their text, role and grouping), not by position.\n"
    "- page_state=question: a question with at least two answer choices is visible.\n"
    "- page_state=complete: the assessment is finished (results/thank-you page, no question).\n"
    "- page_state=loading: content is still loading; use action wait.\n"
    "- click/type need a target; type needs value; wait value is milliseconds (<= 5000); "
    "scroll value is up or down; navigate value is a same-site URL; finish when complete."
)

TASK_INSTRUCTIONS = {
    "understand": (
        "Task: understand this page. Report page_state, the question and its answer choices and the "
        'control that advances. Set action to {"action": "select_answer"} when a question is visible, '
        '"wait" while loading, "finish" when complete, otherwise the single most useful action.'
    ),
    "recover": (
        "Task: the agent is stuck. Goal: {goal}. Earlier attempts are listed under History. Choose "
        "the single next action most likely to reach the goal; do not repeat an attempt that "
        "already failed unless the page has changed. Still report page_state, option_ids and next_id."
    ),
}

TARGETED = {"click", "type", "select_answer"}
TYPABLE_ROLES = {"textbox", "searchbox", "combobox", "spinbutton"}


def _describe(req: AgentDecideRequest) -> str:
    snap = req.snapshot
    lines = [f"URL: {snap.url}", f"Title: {snap.title}", "", "Visible text:"]
    lines += [f"- {t}" for t in snap.texts] or ["- (none)"]
    lines += ["", "Interactive elements (id [role/tag; state] \"text\" group):"]
    for e in snap.elements:
        state = f"; {', '.join(e.state)}" if e.state else ""
        group = f" group={e.group}" if e.group else ""
        lines.append(f'{e.id} [{e.role}/{e.tag}{state}] "{e.text}"{group}')
    if not snap.elements:
        lines.append("(none)")
    if req.history:
        lines += ["", "History:"] + [f"- {h}" for h in req.history]
    task = TASK_INSTRUCTIONS[req.task].replace("{goal}", req.goal or "complete the assessment")
    if req.screenshot:
        task += " A screenshot of the visible page is attached; use it where the text is ambiguous."
    lines += ["", task, "Reply with the JSON object only."]
    return "\n".join(lines)


def build_agent_messages(req: AgentDecideRequest) -> list[dict]:
    text = _describe(req)
    user: str | list[dict] = text
    if req.screenshot:
        user = [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": req.screenshot}}]
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]


def _same_origin(url: str, page_url: str) -> bool:
    a, b = urlsplit(urljoin(page_url, url)), urlsplit(page_url)
    return (a.scheme, a.netloc) == (b.scheme, b.netloc)


def _clean(obj: dict) -> dict:
    """Light normalisation of common model quirks before strict validation."""
    action = obj.get("action")
    if isinstance(action, str):  # {"action": "wait"} flattened
        obj["action"] = {"action": action, "target": obj.get("target"), "value": obj.get("value")}
    if isinstance(obj.get("action"), dict):
        a = obj["action"]
        a["action"] = str(a.get("action", "")).strip().lower()
        if a.get("value") is not None:
            a["value"] = str(a["value"])
        if a.get("target") in ("", "null"):
            a["target"] = None
    for key in ("next_id", "question_text"):
        if obj.get(key) in ("", "null"):
            obj[key] = None
    if isinstance(obj.get("page_state"), str):
        obj["page_state"] = obj["page_state"].strip().lower()
    conf = obj.get("confidence", 0.5)
    try:
        conf = float(conf)
    except (TypeError, ValueError):
        conf = 0.5
    if 1 < conf <= 100:
        conf /= 100
    obj["confidence"] = min(max(conf, 0.0), 1.0)
    obj["option_ids"] = [str(i) for i in obj.get("option_ids") or []]
    return obj


def parse_decision(text: str, req: AgentDecideRequest) -> AgentDecision:
    """Parses and validates a model decision against the snapshot, or raises InvalidModelOutput."""
    try:
        decision = AgentDecision.model_validate(_clean(first_json_object(text)))
    except ValidationError as e:
        raise InvalidModelOutput(f"Decision does not match the schema: {e.errors()[:3]}") from e
    validate_decision(decision, req)
    return decision


def validate_decision(d: AgentDecision, req: AgentDecideRequest) -> None:
    elements = {e.id: e for e in req.snapshot.elements}

    unknown = [i for i in [*d.option_ids, d.next_id, d.action.target] if i and i not in elements]
    if unknown:
        raise InvalidModelOutput(f"Decision references ids not on the page: {unknown}")
    if len(set(d.option_ids)) != len(d.option_ids):
        raise InvalidModelOutput("option_ids contains duplicates")
    if d.next_id and d.next_id in d.option_ids:
        raise InvalidModelOutput("next_id cannot also be an answer choice")
    if req.task == "understand" and d.page_state == "question" and len(d.option_ids) < 2:
        raise InvalidModelOutput("A question needs at least two answer choices")

    a = d.action
    if a.action in TARGETED and not a.target and not (a.action == "select_answer" and req.task == "understand"):
        raise InvalidModelOutput(f"Action {a.action!r} needs a target")
    if a.action == "type":
        el = elements[a.target]  # type: ignore[index]
        if el.role not in TYPABLE_ROLES and el.tag != "textarea":
            raise InvalidModelOutput(f"Cannot type into {el.tag}/{el.role}")
        if a.value is None:
            raise InvalidModelOutput("type needs a value")
    if a.action == "wait":
        try:
            ms = float(a.value or 1000)
        except ValueError as e:
            raise InvalidModelOutput(f"wait value {a.value!r} is not a number of ms") from e
        if not 0 <= ms <= 5000:
            raise InvalidModelOutput("wait must be between 0 and 5000 ms")
    if a.action == "scroll" and (a.value or "down").lower() not in ("up", "down") and not a.target:
        raise InvalidModelOutput("scroll value must be up or down")
    if a.action == "navigate" and (not a.value or not _same_origin(a.value, req.page_url)):
        raise InvalidModelOutput("navigate must stay on the assessment's own site")
