@echo off
REM For a group WITHOUT topics: groups every video by the show name in
REM its file name, and prints the FILTER / S3_PREFIX lines to paste into
REM run-download.bat for the show you want.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" shows

REM The console cannot draw Khmer, so open the readable copy in the
REM default browser - it falls back to a font that can.
if exist "%~dp0shows.html" start "" "%~dp0shows.html"
