@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ===================================================================
REM  EDIT THE FOUR LINES BELOW, THEN SAVE. Nothing else needs changing.
REM
REM  TG_API_ID / TG_API_HASH  - from https://my.telegram.org
REM  ABA_INGEST_SECRET        - the same value set as a Supabase secret
REM  ABA_SOURCE_CHATS         - the ABA_NOTIFIER group id. Leave as is
REM                             unless list-chats.bat printed a different
REM                             number for it.
REM
REM  No quotes, no spaces around the "=".
REM  Right-click this file -> Edit (or open it in Notepad).
REM ===================================================================

set TG_API_ID=REPLACE_ME
set TG_API_HASH=REPLACE_ME
set ABA_INGEST_SECRET=REPLACE_ME
set ABA_SOURCE_CHATS=-5588646530

REM --- normally leave these alone ---
set ABA_INGEST_URL=https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/aba-notify-ingest
set ABA_TEXT_FILTER=S2_Nint.Ani

where python >nul 2>nul
if errorlevel 1 (
  echo [X] Python not found - run install-windows.bat first.
  pause
  exit /b 1
)

if "%TG_API_ID%"=="REPLACE_ME" (
  echo [X] Open this file in Notepad and fill in TG_API_ID, TG_API_HASH
  echo     and ABA_INGEST_SECRET first.
  pause
  exit /b 1
)

echo Starting relay. Keep this window OPEN - closing it stops
echo auto-confirmation of payments.
echo.
python aba-userbot-forwarder.py %1

echo.
echo Relay stopped.
pause
