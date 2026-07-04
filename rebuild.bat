@echo off
rem Mirrors the deploy workflow (.github/workflows/deploy.yml) build steps.
rem Note: build_snapshots.mjs rewrites index.html/404.html cosmetically - expected.
cd /d "%~dp0"
python build_thumbs.py || goto :err
node build_snapshots.mjs || goto :err
echo Done.
pause
exit /b 0
:err
echo BUILD FAILED
pause
exit /b 1
