@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Install - Telegram video downloader

echo ============================================
echo  Telegram video downloader - install
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [X] Python not found.
  echo.
  echo     1. Download from https://www.python.org/downloads/
  echo     2. IMPORTANT: tick "Add python.exe to PATH" on the first screen
  echo     3. Reboot, then run this file again
  echo.
  pause
  exit /b 1
)

python --version
echo.
echo Installing telethon + boto3 ...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo [X] INSTALL FAILED - see the message above.
  pause
  exit /b 1
)

echo.
echo Installing cryptg (optional, makes downloads much faster) ...
python -m pip install cryptg
if errorlevel 1 (
  echo [!] cryptg could not be installed - the tool still works, just slower.
)

REM The launcher holds your Telegram + storage keys, so only the template is
REM kept in git. Make the real copy here if it does not exist yet.
if not exist run-download.bat (
  copy /y run-download.bat.template run-download.bat >nul
  echo.
  echo Created run-download.bat - open it with Notepad and fill in the settings.
)

echo.
echo ============================================
echo  Done.
echo   1. edit run-download.bat  (Notepad)
echo   2. double-click list-chats.bat  -> copy your group id
echo   3. double-click run-download.bat
echo ============================================
pause
