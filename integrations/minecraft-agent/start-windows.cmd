@echo off
setlocal
cd /d "%~dp0"

if not exist package.json (
  echo [virtual-lover-mc-agent] package.json not found.
  pause
  exit /b 1
)

if not exist config.json (
  echo [virtual-lover-mc-agent] config.json not found, copying config.example.json.
  copy config.example.json config.json >nul
)

if not exist node_modules (
  echo [virtual-lover-mc-agent] Installing dependencies. This only happens the first time.
  npm install
  if errorlevel 1 (
    echo [virtual-lover-mc-agent] npm install failed.
    pause
    exit /b 1
  )
)

echo [virtual-lover-mc-agent] Starting local Minecraft body on ws://localhost:48909
npm start
pause
