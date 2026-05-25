@echo off
chcp 65001 >nul
REM Exam Studio - one-time installer (Windows). Double-click this file.
title Exam Studio - install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
echo 설치가 끝나면 start-background.vbs (백그라운드) 또는 start-logs.bat (로그 창) 을 더블클릭해서 실행하세요.
pause
