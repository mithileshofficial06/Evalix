# Serves the synthetic QA assessment on http://localhost:8080 (loopback only).
$site = Join-Path $PSScriptRoot "..\synthetic-site"
python -m http.server 8080 --bind 127.0.0.1 --directory $site
