# Evalix

AI-powered assessment execution and QA engine. Evalix drives an assessment page end-to-end
(read question → ask an AI provider → select answer → advance → repeat → grade) so an
administrator can test question rendering, navigation, answer handling and the grading pipeline.

**Scope:** Evalix only operates on pages that explicitly opt in (see *Opt-in contract*), and only on
origins in the backend allowlist. Full automation is further restricted to pages that declare
themselves a `synthetic` QA environment.

## Architecture

```
Chrome extension (MV3)                         Local backend (FastAPI :8000)
┌──────────────────────────┐   HTTP (JSON)    ┌─────────────────────────────┐
│ content script           │                  │ /health                     │
│   DomAdapter → extract   │                  │ /answer  → AI router        │
│   map → select → next    │◀── messages ──▶ │   ├─ Mistral                │
│ background service worker│ ───────────────▶ │   ├─ NVIDIA NIM             │
│   session state, retries │                  │   └─ Mock (answer key)      │
│ React popup dashboard    │                  │ /grading/report             │
└──────────────────────────┘                  └─────────────────────────────┘
          │
          ▼
Synthetic QA site (:8080) — the reference assessment implementation
```

API keys live only in `backend/.env`. The extension talks only to `http://localhost:8000`.

## Project structure

```
Evalix/
├── backend/                  FastAPI service
│   ├── app/
│   │   ├── main.py           app factory, CORS, origin guard
│   │   ├── config.py         .env loading
│   │   ├── schemas.py        Pydantic models (API contract)
│   │   ├── routes/           health, answer, grading
│   │   ├── ai/               base, prompt, mistral, nvidia, mock, router
│   │   └── grading/          answer keys + grading simulator
│   └── tests/                pytest (providers mocked, no network)
├── synthetic-site/           static QA assessment (served on :8080)
├── extension/                Chrome MV3 extension (TypeScript + React)
│   └── src/{background,content,popup,shared}
├── e2e/                      Playwright: extension + backend + site, full loop
├── tools/                    question bank + generator for site data and answer keys
└── scripts/                  PowerShell helpers to run everything
```

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env      # then fill in API keys
```
