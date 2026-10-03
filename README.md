# Evalix

AI browser agent for assessment QA. Evalix works through an assessment page the way a person
would — it reads what is on the screen, decides, acts, checks that the action worked, recovers when
it did not, and moves on:

```
OBSERVE → UNDERSTAND → ANSWER → FIND TARGET → ACT → VERIFY → NEXT → OBSERVE AGAIN … → REPORT
```

It identifies elements by what they represent (labels, roles, grouping), not by fixed selectors,
ids or positions, so it adapts when a question's layout, markup or option order changes. An
administrator uses it to test question rendering, navigation, answer handling and the grading
pipeline, and to measure how AI models perform on their question bank.

## Scope and safeguards

Evalix only runs where you have explicitly enabled it:

| Layer | Guard |
|---|---|
| Extension manifest | Content script and host permissions limited to `http://localhost/*` and `http://127.0.0.1/*` |
| Page opt-in | Does nothing unless the page has `<meta name="evalix-qa" content="enabled">` |
| Full automation | Only on pages declaring `<meta name="evalix-environment" content="synthetic">`; everything else is dry-run only |
| Backend | Rejects requests from any browser origin other than the extension and `ALLOWED_PAGE_ORIGINS`, and refuses to answer for pages outside that list |
| AI output | The AI only returns structured JSON (answer + confidence + `select_answer`, or a page reading / browser action). It is validated twice — by the backend against the observed page and again in the extension — before anything runs: element ids must have been observed, actions come from a fixed list, typing only into text fields, waits ≤ 5 s, navigation only on the same site |
| Screenshots | Only taken when the DOM alone could not be understood, only of the assessment tab, and only sent to the configured provider |
| Secrets | API keys live only in `backend/.env` (gitignored); `/health` reports *whether* a key is set, never the key |

## Architecture

```
Chrome extension (MV3)                              Local backend (FastAPI, 127.0.0.1:8000)
┌─────────────────────────────────┐                 ┌───────────────────────────────────┐
│ content script (the agent)      │                 │ GET  /health                      │
│   SemanticAdapter: infer        │                 │ POST /answer        ┐             │
│     question/choices/Next/state │                 │ POST /agent/decide  ┴ AI router   │
│   snapshot: page → AI view      │  runtime msgs   │   ├─ Mistral (JSON mode, vision)  │
│   Runner: observe → answer →    │ ◀─────────────▶ │   ├─ NVIDIA NIM (vision model)    │
│     locate → act → verify →     │                 │   └─ Mock (answer key + rules)    │
│     recover → next              │                 │   AUTO: switch on 429/503/timeout │
│ background service worker       │ ──── HTTP ────▶ │ POST /grading/report  (simulator) │
│   session, action history,      │                 │ POST /grading/score               │
│   screenshots on request        │                 │ GET  /grading/tests               │
│ React popup dashboard + report  │                 │                                   │
└─────────────────────────────────┘                 └───────────────────────────────────┘
                ▲
                │ drives
Synthetic QA site (127.0.0.1:8080) — reference assessment: 15/50 questions, 6 layouts (incl.
unsemantic div tiles), 4 Next variants (incl. an unlabelled icon), optional data-qa hooks,
shuffled option order, delayed loading, late-inserted options, completion page
```

```
Evalix/
├── backend/
│   ├── app/
│   │   ├── main.py            app factory, origin guard, CORS, logging
│   │   ├── config.py          settings from backend/.env
│   │   ├── schemas.py         Pydantic API contract
│   │   ├── routes/            health.py, answer.py, agent.py, grading.py
│   │   ├── ai/                prompt.py, agent_prompt.py (decision schema + validation),
│   │   │                      openai_compat.py, mistral.py, nvidia.py, mock.py, router.py
│   │   └── grading/           keys/ (answer keys), keys.py, simulator.py
│   ├── tests/                 pytest — providers mocked with httpx.MockTransport
│   └── smoke_test.py          real-provider check once keys are set
├── extension/
│   ├── manifest.json
│   ├── src/background/        service worker: api.ts (timeout+retry), session.ts
│   ├── src/content/           adapters/ (semantic.ts, infer.ts), agent/ (snapshot, act, overlay),
│   │                          runner.ts (agent loop), observer.ts, mapper.ts
│   ├── src/popup/             React dashboard
│   ├── src/shared/            types, messages, storage, metrics, agentReport
│   └── tests/                 vitest + jsdom, run against the site's real layout code
├── synthetic-site/            static reference assessment
├── e2e/                       Playwright: real extension + backend + site
├── tools/                     question_bank.py + generate.py (site data and answer keys)
└── scripts/                   dev.ps1, run-backend.ps1, run-site.ps1, test-all.ps1
```

## How the agent works

**Observe and understand.** The content script reads the page semantically. Answer choices are
recognised by evidence, strongest first: native radios, ARIA radios, `<select>`, ARIA listbox
options, toggle buttons (`aria-pressed`), and finally visually grouped clickable siblings (plain
`<div>`s with `cursor: pointer`). The question text is the nearest label/legend/heading — or the
longest text block — around that group; "Question 3 of 15" gives the progress. `data-qa-*`
attributes are used as hints when present but are not required.

If the heuristics cannot read a page that has settled (no question found, or two candidate answer
groups), the agent sends the AI a compact **snapshot** — visible text plus every interactive
element with a per-observation id, role, label, state and group — and asks for a structured
reading (`page_state`, `question_text`, `option_ids`, `next_id`, `action`, `confidence`). If that
is invalid or unsure, it repeats once **with a screenshot** (vision model). An unchanged page is
never sent twice.

**Answer.** The question and lettered options go to `/answer`; the reply must be
`{"answer": "B", "confidence": 0.94, "action": "select_answer"}` for a listed option.

**Find target, act, verify, recover.** The option is located again in the *current* DOM by its
text (elements may have re-rendered or moved). Every action is verified:

| Action | Verified by | Recovery |
|---|---|---|
| Select answer | the page shows it selected (`checked`, `aria-checked/selected/pressed`, `<select>` value, or a state class only that choice has) | re-locate by text and escalate: click → click label → pointer events → keyboard |
| Next / Submit | the question or page actually changed (new question, completion, or a new page load) | wait for the control to enable; re-select if the page lost the answer; escalate click → form submit → keyboard; after two failures ask the AI for a validated recovery action (`click`/`wait`/`scroll`/…); up to 4 attempts |

Failures that survive recovery stop the run with the reason recorded. **STOP** aborts immediately
(every wait is abortable).

## Setup (Windows)

Requires Python 3.12+, Node 20+, Chrome.

```powershell
# Backend
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env          # then add your keys (see below)

# Extension
cd ..\extension
npm install
npm run build                   # output: extension\dist

# End-to-end tests (optional)
cd ..\e2e
npm install
npx playwright install chromium
```

### API keys

Edit `backend/.env`:

| Variable | Where to get it |
|---|---|
| `MISTRAL_API_KEY` | https://console.mistral.ai → API Keys. Default model `ministral-14b-latest` (the free plan allows 0 requests/min on `mistral-small`/`medium`; check `x-ratelimit-limit-req-minute`) |
| `NVIDIA_API_KEY` | https://build.nvidia.com → sign in → any model page → *Get API Key* (starts with `nvapi-`). One key works for every hosted model. Default model `nvidia/nemotron-3.5-lightning-30b-a3b` with thinking off (`NVIDIA_ENABLE_THINKING=false`) |

Set `AI_PROVIDER` to `AUTO` (Mistral, falling back to NVIDIA), `MISTRAL`, `NVIDIA`, or `MOCK`.
The popup's provider selector overrides it per session. Change `MISTRAL_MODEL` / `NVIDIA_MODEL` to
compare models. In `AUTO`, a provider that is rate-limited (429), unavailable (503), timing out or
unreachable is skipped immediately, and after a 429 it stays skipped for `AI_COOLDOWN_SECONDS`
(or the provider's `Retry-After`).

Screenshot readings use `MISTRAL_VISION_MODEL` (default `ministral-14b-latest`) and
`NVIDIA_VISION_MODEL` (default `nvidia/nemotron-nano-12b-v2-vl`). Screenshots need the
`activeTab` grant Chrome gives when you open the popup and press START; if it is unavailable the
agent continues with the DOM only.

Verify the keys without the browser:

```powershell
.\scripts\run-backend.ps1                      # terminal 1
cd backend; .\.venv\Scripts\python smoke_test.py MISTRAL   # terminal 2 (also: NVIDIA, AUTO)
.\.venv\Scripts\python smoke_test.py MISTRAL agent             # page understanding + recovery
```

### Load the extension

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `extension\dist`
3. After `npm run build`, press the reload icon on the Evalix card

## Running

```powershell
.\scripts\dev.ps1     # opens backend (:8000) and synthetic site (:8080) windows
```

1. Open http://localhost:8080 and start an assessment (pick test, layout, Next variant, delay,
   QA hooks on/off, option order). *All* layouts + *All* Next variants + hooks *Off* + *Shuffled*
   is the hardest case: nothing about the page structure is given to the agent.
2. Open the Evalix popup: Backend ● Online, Page ● detected.
3. Choose **Dry Run** or **Automation**, pick a provider, press **START**.
   - **Dry Run** — understands the question, gets the answer, locates the targets and shows what it
     *would* do: the option outlined (dashed amber), the Next control outlined (dotted blue) and a
     badge "Evalix would select B (94%) … then click Next". Never selects or advances. Advance
     manually and it suggests for the next question.
   - **Automation** — understands, answers, selects, verifies, advances, verifies, recovers when
     needed, and stops on the completion page.
4. When the run ends the session is graded; the popup shows the agent report, the graded report and
   the action history, and every run (including its action history) is saved to
   `reports/<timestamp>-<session>.json`.

`MOCK` answers from the answer key at `MOCK_ACCURACY`, so the whole loop can be exercised without
spending API credits.

### Dashboard metrics

Live: state, mode, provider, questions processed, answers returned, average confidence, average API
latency, average per-question processing time, errors, failed actions / recoveries, elapsed time,
current question and the step being worked on, logs.

Agent report: completion status, total questions, questions answered, accuracy, AI provider(s)
used, average response time, average confidence, failed actions, recovery attempts, AI page
readings (and how many used a screenshot).

Action history, per question — e.g.

```
Question 6 · 14 steps · had failures
→ observed — source dom
→ understood — "Which gas do plants absorb…" — 4 choices (generic)
→ answer selected — A "Carbon dioxide" @ 95% via MISTRAL (912 ms)
→ option located — generic "Carbon dioxide"
→ option clicked — click
✗ selection verified — the option is not selected on the page
→ recovery — re-locating the option and trying pointer events
→ option clicked — pointer events
→ selection verified
→ next located — "Next"
→ next clicked — "Next" (click)
→ transition verified
```

Graded report: score, accuracy on answered questions, incorrect/unanswered, completion rate,
average confidence for correct vs incorrect answers, latencies, duration, list of wrong answers.

## Tests

```powershell
.\scripts\test-all.ps1     # stop any backend on :8000 first
```

| Suite | Command | Covers |
|---|---|---|
| Backend | `cd backend; .\.venv\Scripts\python -m pytest` | config, origin guard, prompt parsing, agent decision validation, provider request/error handling, retries + AUTO switching/cooldown, /answer, /agent/decide, grading by letter and by text |
| Extension | `cd extension; npm run typecheck; npm test` | API retry/timeout, extraction for every layout with and without hooks, selection state of unsemantic choices, page snapshot, action validation, answer mapping, agent loop (recovery, AI page reading, screenshot escalation, invalid AI output), dry run, agent report |
| End-to-end | `cd e2e; npm test` | real extension in Chromium: full 15/50-question runs graded 100% with MOCK, hook-free shuffled all-layout run with recovery, dry-run safety, opt-in refusal, STOP |
| Live (costs credits) | `cd e2e; $env:EVALIX_LIVE_PROVIDER="NVIDIA"; npx playwright test tests/live.spec.ts` | full automation run against a real provider, prints the graded report and failed actions; set `EVALIX_LIVE_PARAMS="layout=all&nav=all&hooks=off&shuffle=on&delay=normal"` for the hardest variant |

## Adapting to an assessment system you administer

The engine only talks to the `DomAdapter` interface (`extension/src/content/adapters/types.ts`):

```ts
detect(doc)        // PageInfo if the page opted in, else null
isComplete(doc)
questionRoot(doc)
extract(doc)       // question text, number, lettered options + element handles
select(option)     // must fire the page's own handlers
isSelected(option)
findNext(doc)
highlight(option, root, next)  // dry run: outline the choice and the Next control
```

Two routes:

1. **Add the opt-in meta tags to your platform's QA/staging build** (required). That is usually
   enough: the agent infers questions, choices and navigation itself, and asks the AI when it
   cannot. Adding `data-qa-question` (with `data-qa-question-id`/`-number`/`-total`),
   `data-qa-nav` and `data-qa-complete` makes reading faster and question ids stable for grading.
2. **Write a new adapter** for markup you can't change: implement the interface, register it in
   `adapters/index.ts`, and add vitest fixtures with your real markup.

Then:
- add the origin to `ALLOWED_PAGE_ORIGINS` in `backend/.env`;
- add it to `host_permissions` and `content_scripts.matches` in `extension/manifest.json`;
- keep `evalix-environment` non-`synthetic` there if you only want dry-run.

## Regenerating test data

Edit `tools/question_bank.py`, then:

```powershell
python tools\generate.py
```

This rewrites `synthetic-site/data/*.json` (public, no answers) and
`backend/app/grading/keys/*.json` (answer keys, never served to the page).
