@echo off
chcp 65001 >nul
setlocal
start "紅華祭 案内サーバー" "%ComSpec%" /k call "%~dp0start_main.bat"
timeout /t 3 /nobreak >nul
call "%~dp0open_local_viewer.bat"
exit /b 0
