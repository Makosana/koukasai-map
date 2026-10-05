@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
if errorlevel 1 (
    echo [ERROR] プロジェクトフォルダーを開けませんでした。
    pause
    exit /b 1
)

if not exist "server_address.txt" (
    echo [ERROR] server_address.txt がありません。
    popd
    pause
    exit /b 1
)
set /p APP_URL=<"server_address.txt"
if "%APP_URL%"=="" (
    echo [ERROR] server_address.txt に案内サーバーのURLを1行で入力してください。
    popd
    pause
    exit /b 1
)

call "%~dp0_open_kiosk.bat" "%APP_URL%"
popd
exit /b 0
