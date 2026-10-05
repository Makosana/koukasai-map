@echo off
setlocal
set "APP_URL=%~1"
if "%APP_URL%"=="" set "APP_URL=http://127.0.0.1:5000/"

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%TEMP%\koukasai_map_kiosk" --kiosk "%APP_URL%" --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble
    exit /b 0
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%TEMP%\koukasai_map_kiosk" --kiosk "%APP_URL%" --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble
    exit /b 0
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --user-data-dir="%TEMP%\koukasai_map_kiosk" --kiosk "%APP_URL%" --no-first-run --disable-session-crashed-bubble
    exit /b 0
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --user-data-dir="%TEMP%\koukasai_map_kiosk" --kiosk "%APP_URL%" --no-first-run --disable-session-crashed-bubble
    exit /b 0
)

start "" "%APP_URL%"
exit /b 0
