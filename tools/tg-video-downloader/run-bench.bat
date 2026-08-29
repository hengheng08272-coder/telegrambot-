@echo off
REM Measures 1 connection against TG_CONNECTIONS on a real video from the
REM group, so you can tune TG_CONNECTIONS for your own internet line.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" bench
