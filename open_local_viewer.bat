@echo off
chcp 65001 >nul
call "%~dp0_open_kiosk.bat" "http://127.0.0.1:5000/"
