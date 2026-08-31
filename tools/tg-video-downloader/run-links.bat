@echo off
REM Prints (and rewrites links_*.txt with) every finished video URL,
REM ready to paste into Admin panel -> the show -> Bulk import.
REM Needs no Telegram login. Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" links
