@echo off
REM Prints every chat this Telegram account can see, with its id, so the
REM ABA_NOTIFIER group's real id can be copied into run-relay.bat.
REM Uses the same settings as run-relay.bat.
call "%~dp0run-relay.bat" list
