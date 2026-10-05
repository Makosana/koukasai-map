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
        echo Pythonをインストールしてから、もう一度実行してください。
        popd
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
)

echo 必要なPythonパッケージを確認・インストールします。
%PYTHON_CMD% -m pip install --user -r requirements.txt
set "SETUP_EXIT=%ERRORLEVEL%"

if not "%SETUP_EXIT%"=="0" (
    echo.
    echo [ERROR] インストールに失敗しました。学校内ネットワークへの接続を確認してください。
    popd
    pause
    exit /b %SETUP_EXIT%
)

echo.
echo セットアップが完了しました。
popd
exit /b 0
