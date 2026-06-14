@echo off
set "PATH=%USERPROFILE%\.bunin;%PATH%"
bun scripts/production.ts --skip-build
