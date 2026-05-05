@echo off
setlocal

cd /d "%~dp0"

start "HomeHub Server" cmd /k python app.py
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8000
