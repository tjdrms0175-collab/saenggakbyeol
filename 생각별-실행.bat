@echo off
setlocal
cd /d "%~dp0"
if not exist "server.mjs" goto wrong_folder
set "OLLAMA_MODEL=gemma3:1b"
echo.
echo ==========================================
echo  Saenggakbyeol AI Tutor - 8GB Light Mode
echo  Model: gemma3:1b
 echo  Website: http://127.0.0.1:3000
echo ==========================================
echo.
call npm.cmd start
echo.
echo Server stopped. Please take a screenshot if an error appeared.
pause
exit /b
:wrong_folder
echo ERROR: Put this BAT file inside ai_home_tutor folder (next to server.mjs).
pause
exit /b 1
