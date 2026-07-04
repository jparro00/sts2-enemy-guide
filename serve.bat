@echo off
echo Starting STS2 dev server at http://localhost:8080
cd /d "%~dp0"
python -m http.server 8080
