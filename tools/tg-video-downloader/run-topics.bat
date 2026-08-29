@echo off
REM Lists the group's Topics (most groups keep one show per topic) with
REM the number of videos in each, and prints the TG_TOPIC / S3_PREFIX
REM lines to paste into run-download.bat for the show you want.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" topics
