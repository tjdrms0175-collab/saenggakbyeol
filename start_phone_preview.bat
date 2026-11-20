@echo off
setlocal
cd /d "%~dp0"
set "HOST=0.0.0.0"
set "PORT=3000"
set "OLLAMA_MODEL=gemma3:1b"
echo.
echo ======================================================
echo Saenggakbyeol phone preview (SAME Wi-Fi, HTTP ONLY)
echo This is for UI preview, NOT full PWA install / mic.
echo Find your Wi-Fi IPv4 number below.
echo Open http://YOUR-PC-IP:3000 on the phone.
echo ======================================================
ipconfig | findstr /R /C:"IPv4"
echo.
call npm.cmd start
pause
