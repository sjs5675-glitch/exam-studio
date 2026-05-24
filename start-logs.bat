@echo off
title Exam Studio (logs)
cd /d "%~dp0studio"

echo ============================================
echo   Exam Studio - 로그 모드
echo ============================================
echo.

where node.exe >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js 가 없습니다. https://nodejs.org 설치 후 install.bat 실행.
    pause & exit /b 1
)
if not exist "node_modules\.bin\next.CMD" (
    echo [ERROR] 의존성 미설치. 먼저 install.bat 을 실행하세요.
    pause & exit /b 1
)

REM .venv(파이썬 의존성)를 PATH 앞에 추가
if exist "%~dp0.venv\Scripts" set "PATH=%~dp0.venv\Scripts;%PATH%"

REM 기존 포트 정리
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3020" ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3021 " ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul

REM 로그가 보이도록 별도 창(최소화 안 함)으로 실행
echo [1/2] SSE 서버 (port 3021) - 별도 창에 로그 표시
start "Exam Studio - SSE log" cmd /k "cd /d %~dp0studio && set PATH=%~dp0.venv\Scripts;%PATH% && call pnpm.cmd dev:sse"

echo [2/2] Next.js (port 3020) - 별도 창에 로그 표시
start "Exam Studio - Next log" cmd /k "cd /d %~dp0studio && set PATH=%~dp0.venv\Scripts;%PATH% && call pnpm.cmd dev"

echo.
echo 서버 준비 대기 중...
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano 2>nul | findstr ":3020" | findstr "LISTENING" >nul 2>nul
if %errorlevel% neq 0 goto wait

start "" http://localhost:3020

echo.
echo ============================================
echo   Exam Studio 실행 중  ( http://localhost:3020 )
echo   로그는 'SSE log' / 'Next log' 창에서 확인하세요.
echo   여기서 아무 키나 누르면 모든 서버를 종료합니다.
echo ============================================
pause >nul

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3020" ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3021 " ^| findstr "LISTENING"') do taskkill /pid %%a /f >nul 2>nul
echo 서버를 종료했습니다.
