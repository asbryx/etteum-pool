@echo off
REM start.cmd — etteum-pool launcher.
REM
REM Invokes the supervisor via a hidden VBS shim. The supervisor:
REM   - launches `bun scripts/production.ts --skip-build`
REM   - watches it; auto-restarts ONLY on crash (not on clean Ctrl+C)
REM   - circuit-breaker: max 5 restarts in 5 min, then gives up
REM   - logs to logs/supervisor.log + logs/etteum.{stdout,stderr}.log
REM
REM No Windows Startup folder entry. No PM2. No console window.
REM
REM Need to bypass the supervisor for debugging? Run start-direct.cmd.

set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
cd /d "%~dp0"
if not exist logs mkdir logs
wscript.exe "%~dp0start-supervisor.vbs"
