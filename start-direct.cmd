@echo off
REM start-direct.cmd — escape hatch.
REM
REM Runs etteum-pool directly via raw bun, BYPASSING the supervisor.
REM Use this if the supervisor itself is broken or for debugging.
REM
REM No auto-restart. No hidden window. If etteum crashes, it stays down.

set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
cd /d "%~dp0"
bun scripts\production.ts --skip-build
