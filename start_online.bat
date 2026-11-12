@echo off
chcp 65001 >nul
cd /d "%~dp0"
title GREYHAVEN online server
if not exist "tools\cloudflared\cloudflared.exe" (
  echo [!] tools\cloudflared\cloudflared.exe not found.
  echo     Download: https://github.com/cloudflare/cloudflared/releases/latest
  pause
  exit /b 1
)
echo Starting game server...
start "GREYHAVEN server" /min cmd /c "node serve.js"
timeout /t 2 /nobreak >nul
echo.
echo Opening Cloudflare tunnel. Share the https://....trycloudflare.com address below with your friends.
echo Keep this window open while playing. Close it to stop the online server.
echo.
"tools\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:8123 2>&1 | findstr /i "trycloudflare.com error"
