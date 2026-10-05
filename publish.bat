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

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git が見つかりません。Git for Windows をインストールしてください。
    popd
    pause
    exit /b 1
)

echo 案内画面を docs フォルダーに書き出しています。
%PYTHON_CMD% export_static.py
if errorlevel 1 (
    echo [ERROR] 書き出しに失敗しました。
    popd
    pause
    exit /b 1
)

git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "案内データ更新 %date% %time%"
    if errorlevel 1 (
        echo [ERROR] コミットに失敗しました。
        popd
        pause
        exit /b 1
    )
) else (
    echo 変更はありません。
)

echo GitHub に送信しています。
git push
if errorlevel 1 (
    echo [ERROR] GitHub への送信に失敗しました。ネットワークとログイン状態を確認してください。
    popd
    pause
    exit /b 1
)

echo.
echo 公開しました。インターネット上の案内画面には数分で反映されます。
popd
pause
exit /b 0
