# Evalix

AI-powered assessment execution and QA engine. Evalix drives an assessment page end-to-end —
read question → ask an AI provider → select answer → advance → repeat → grade — so an
administrator can test question rendering, navigation, answer handling and the grading pipeline,
and measure how AI models perform on their question bank.

## Scope and safeguards

Evalix only runs where you have explicitly enabled it:

| Layer | Guard |
|---|---|
| Extension manifest | Content script and host permissions limited to `http://localhost/*` and `http://127.0.0.1/*` |
| Page opt-in | Does nothing unless the page has `<meta name="evalix-qa" content="enabled">` |
| Full automation | Only on pages declaring `<meta name="evalix-environment" content="synthetic">`; everything else is dry-run only |
| Backend | Rejects requests from any browser origin other than the extension and `ALLOWED_PAGE_ORIGINS`, and refuses to answer for pages outside that list |
| Secrets | API keys live only in `backend/.env` (gitignored); `/health` reports *whether* a key is set, never the key |

## Architecture

```
Chrome extension (MV3)                              Local backend (FastAPI, 127.0.0.1:8000)
┌─────────────────────────────────┐                 ┌───────────────────────────────────┐
│ content script                  │                 │ GET  /health                      │
│   DomAdapter  (detect/extract/  │                 │ POST /answer ── AI router         │
│     select/findNext/complete)   │                 │        ├─ Mistral (JSON mode)     │
│   Runner: wait → extract → ask  │  runtime msgs   │        ├─ NVIDIA NIM              │
│     → map → select → navigate   │ ◀─────────────▶ │        └─ Mock (answer key)       │
│ background service worker       │ ──── HTTP ────▶ │ POST /grading/report  (simulator) │
│   session state, retries        │                 │ POST /grading/score               │
│ React popup dashboard           │                 │ GET  /grading/tests               │
└─────────────────────────────────┘                 └───────────────────────────────────┘
                ▲
                │ drives
Synthetic QA site (127.0.0.1:8080) — reference assessment: 15/50 questions, 4 layouts,
3 Next-button variants, delayed loading, late-inserted options, completion page
```

```
Evalix/
├── backend/
│   ├── app/
│   │   ├── main.py            app factory, origin guard, CORS, logging
│   │   ├── config.py          settings from backend/.env
│   │   ├── schemas.py         Pydantic API contract
│   │   ├── routes/            health.py, answer.py, grading.py
│   │   ├── ai/                prompt.py, openai_compat.py, mistral.py, nvidia.py, mock.py, router.py
│   │   └── grading/           keys/ (answer keys), keys.py, simulator.py
│   ├── tests/                 pytest — providers mocked with httpx.MockTransport
│   └── smoke_test.py          real-provider check once keys are set
├── extension/
│   ├── manifest.json
│   ├── src/background/        service worker: api.ts (timeout+retry), session.ts
│   ├── src/content/           adapters/, runner.ts, observer.ts, mapper.ts, navigator.ts
│   ├── src/popup/             React dashboard
│   ├── src/shared/            types, messages, storage, metrics
│   └── tests/                 vitest + jsdom, run against the site's real layout code
├── synthetic-site/            static reference assessment
├── e2e/                       Playwright: real extension + backend + site
├── tools/                     question_bank.py + generate.py (site data and answer keys)
└── scripts/                   dev.ps1, run-backend.ps1, run-site.ps1, test-all.ps1
```

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
| `MISTRAL_API_KEY` | https://console.mistral.ai → API Keys. Default model `mistral-small-latest` |
| `NVIDIA_API_KEY` | https://build.nvidia.com → sign in → any model page → *Get API Key* (starts with `nvapi-`). One key works for every hosted model. Default model `meta/llama-3.3-70b-instruct` |

Set `AI_PROVIDER` to `AUTO` (Mistral, falling back to NVIDIA), `MISTRAL`, `NVIDIA`, or `MOCK`.
The popup's provider selector overrides it per session. Change `MISTRAL_MODEL` / `NVIDIA_MODEL` to
compare models.

Verify the keys without the browser:

```powershell
.\scripts\run-backend.ps1                      # terminal 1
cd backend; .\.venv\Scripts\python smoke_test.py MISTRAL   # terminal 2 (also: NVIDIA, AUTO)
```

### Load the extension

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select `extension\dist`
3. After `npm run build`, press the reload icon on the Evalix card

## Running

```powershell
.\scripts\dev.ps1     # opens backend (:8000) and synthetic site (:8080) windows
```

1. Open http://localhost:8080 and start an assessment (pick test, layout, Next variant, delay).
2. Open the Evalix popup: Backend ● Online, Page ● detected.
3. Choose **Dry Run** or **Automation**, pick a provider, press **START**.
   - **Dry Run** — asks the AI and outlines its choice on the page (dashed amber). Never selects or
     advances. Advance manually and it suggests for the next question.
   - **Automation** — selects, clicks Next, repeats, stops on the completion page.
4. When the run ends the session is graded; the popup shows the Evalix report and every run is
   saved to `reports/<timestamp>-<session>.json`.

`MOCK` answers from the answer key at `MOCK_ACCURACY`, so the whole loop can be exercised without
spending API credits.

### Dashboard metrics

Live: state, mode, provider, questions processed, answers returned, average confidence, average API
latency, average per-question processing time, errors, elapsed time, current question, logs.

Graded report: score, accuracy on answered questions, incorrect/unanswered, completion rate,
average confidence for correct vs incorrect answers, latencies, duration, list of wrong answers.

## Tests

```powershell
.\scripts\test-all.ps1     # stop any backend on :8000 first
```

| Suite | Command | Covers |
|---|---|---|
| Backend | `cd backend; .\.venv\Scripts\python -m pytest` | config, origin guard, prompt parsing, provider request/error handling, retries + AUTO fallback, /answer, grading math |
| Extension | `cd extension; npm run typecheck; npm test` | API retry/timeout, extraction for every layout, Next detection, answer mapping, dry-run + automation loop |
| End-to-end | `cd e2e; npm test` | real extension in Chromium: full 15/50-question runs graded 100% with MOCK, dry-run safety, opt-in refusal, STOP |

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
highlight(option, root)
```

Two routes:

1. **Add the contract to your platform's QA/staging build** (preferred): the opt-in meta tags plus
   `data-qa-question` (with `data-qa-question-id`/`-number`/`-total`), `data-qa-nav` around
   navigation, and `data-qa-complete` on the completion state. If your answer controls use
   standard radio inputs, ARIA radios/options or `<select>`, `SemanticAdapter` works unchanged.
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
