@echo off
REM Lists the group's Topics (most groups keep one show per topic) with
REM the number of videos in each, and prints the TG_TOPIC / S3_PREFIX
REM lines to paste into run-download.bat for the show you want.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" topics

REM The console cannot draw Khmer, so open the readable copy in the
REM default browser - it falls back to a font that can.
if exist "%~dp0topics.html" start "" "%~dp0topics.html"
