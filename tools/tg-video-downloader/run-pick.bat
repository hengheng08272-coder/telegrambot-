@echo off
REM Lists the videos that are NOT downloaded yet and lets you choose
REM which ones to take:  1-5,8,12   or  all
REM Uses the same settings as run-download.bat.
call "%~dp0run-download.bat" pick
