@echo off
REM Exam Studio - one-time installer (Windows). Double-click this file.
title Exam Studio - install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
echo 설치가 끝나면 "Exam Studio.vbs" 를 더블클릭해서 실행하세요.
pause
