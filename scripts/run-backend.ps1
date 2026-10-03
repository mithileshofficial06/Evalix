# Starts the Evalix backend on http://localhost:8000 (bound to loopback only).
$backend = Join-Path $PSScriptRoot "..\backend"
Set-Location $backend
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
