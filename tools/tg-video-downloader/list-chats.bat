@echo off
REM Prints every chat this Telegram account can see, with its id, so the
REM group's real id can be copied into run-download.bat.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" list
