@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  ABA relay - install (Windows)
echo ============================================
echo.

REM Windows ships no Python by default. If the installer was run without
REM ticking "Add python.exe to PATH", this is where it shows up.
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
echo Installing telethon + requests...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo.
echo ============================================
echo  Done. Next: edit run-relay.bat, then
echo  double-click list-chats.bat
echo ============================================
pause
