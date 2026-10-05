@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
if errorlevel 1 (
    echo [ERROR] プロジェクトフォルダーを開けませんでした。
    pause
    exit /b 1
)

where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python 3 が見つかりません。
        popd
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
)

%PYTHON_CMD% -c "import flask, waitress, PIL" >nul 2>&1
if errorlevel 1 (
    call "%~dp0setup.bat"
    if errorlevel 1 (
        popd
        exit /b 1
    )
)

echo 紅華祭 案内サーバーを起動しています。
echo このPCから: http://127.0.0.1:5000/
echo 別のPCから: http://このPCのIPv4アドレス:5000/
echo.
echo 次のIPv4アドレスを確認し、server_address.txt に設定してください。
ipconfig | findstr /i "IPv4"
echo.
echo 終了するときは、この画面で Ctrl+C を押してください。
echo.
%PYTHON_CMD% main.py
set "APP_EXIT=%ERRORLEVEL%"
popd
if not "%APP_EXIT%"=="0" pause
exit /b %APP_EXIT%
