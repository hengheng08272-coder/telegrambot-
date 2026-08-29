@echo off
REM For a group WITHOUT topics: groups every video by the show name in
REM its file name, and prints the FILTER / S3_PREFIX lines to paste into
REM run-download.bat for the show you want.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" shows
