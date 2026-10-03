# Starts the backend (:8000) and the synthetic site (:8080) in two new PowerShell windows.
$scripts = $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scripts "run-backend.ps1")
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $scripts "run-site.ps1")
Write-Host "Backend:        http://localhost:8000/health"
Write-Host "Synthetic site: http://localhost:8080/index.html"
