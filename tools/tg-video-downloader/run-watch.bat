@echo off
REM "auto" = download the whole history first, then STAY OPEN and download
REM every new video the moment it is posted in the group.
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" auto
