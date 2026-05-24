@echo off
title Exam Studio
cd /d "%~dp0studio"

echo ============================================
echo   Exam Studio
echo ============================================
echo.

where node.exe >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org, then run install.bat
    pause
    exit /b 1
)

if not exist "node_modules\.bin\next.CMD" (
    echo [ERROR] 의존성이 설치되지 않았습니다. 먼저 install.bat 을 실행하세요.
    pause
    exit /b 1
)

REM .venv(파이썬 의존성)를 PATH 앞에 추가
if exist "%~dp0.venv\Scripts" set "PATH=%~dp0.venv\Scripts;%PATH%"

REM 기존 포트 정리
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3020" ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3021 " ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul

echo [1/2] Starting SSE server (port 3021)...
start "Exam-SSE" /min cmd /c "cd /d %~dp0studio && set PATH=%~dp0.venv\Scripts;%PATH% && call pnpm.cmd dev:sse"

echo [2/2] Starting Next.js (port 3020)...
start "Exam-Next" /min cmd /c "cd /d %~dp0studio && set PATH=%~dp0.venv\Scripts;%PATH% && call pnpm.cmd dev"

echo.
echo Waiting for servers...
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano 2>nul | findstr ":3020" | findstr "LISTENING" >nul 2>nul
if %errorlevel% neq 0 goto wait

start "" http://localhost:3020

echo.
echo ============================================
echo   Exam Studio Running
echo   - Web:  http://localhost:3020
echo   - SSE:  http://localhost:3021
echo.
echo   Press any key to stop servers...
echo ============================================
echo.
pause >nul

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3020" ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3021 " ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul
echo Servers stopped.
