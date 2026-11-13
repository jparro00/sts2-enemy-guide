@echo off
rem Follow your Slay the Spire 2 run in a Spire Codex window. Close this window to stop.
title Spire Codex game watcher
node "%~dp0game-watcher.mjs" %*
if errorlevel 1 pause
