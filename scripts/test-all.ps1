# Runs every test suite: backend (pytest), extension (typecheck + vitest), end-to-end (Playwright).
# Stop any backend running on :8000 first — e2e starts its own with the MOCK provider.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$failed = @()

Write-Host "`n=== Backend (pytest) ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "backend")
& ".\.venv\Scripts\python.exe" -m pytest -q -p no:warnings
if ($LASTEXITCODE -ne 0) { $failed += "backend" }
Pop-Location

Write-Host "`n=== Extension (tsc + vitest) ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "extension")
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { $failed += "extension-typecheck" }
npx vitest run
if ($LASTEXITCODE -ne 0) { $failed += "extension" }
Pop-Location

Write-Host "`n=== End-to-end (Playwright) ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "e2e")
npm test
if ($LASTEXITCODE -ne 0) { $failed += "e2e" }
Pop-Location

if ($failed.Count) {
  Write-Host "`nFAILED: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
Write-Host "`nAll suites passed." -ForegroundColor Green
