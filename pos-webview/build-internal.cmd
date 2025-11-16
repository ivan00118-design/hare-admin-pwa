@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ===============================================================
REM  iOS Internal Build Helper for EAS (adhoc) - No-quit version
REM  Place this file in: C:\Users\Ivan\Desktop\Hare\hare-admin-pwa\pos-webview
REM ===============================================================

cd /d "%~dp0"

echo.
echo ================================
echo  POS WebView - iOS Internal Build
echo ================================
echo.

REM ---- Inputs ----
set "EXPO_APPLE_ID="
set "EXPO_APPLE_TEAM_ID="

echo Enter your Apple Developer Apple ID (email):
set /p EXPO_APPLE_ID=Apple ID: 
if "%EXPO_APPLE_ID%"=="" (
  echo [ERROR] Apple ID is required. Press any key to exit...
  pause >nul
  exit /b 1
)

echo.
echo (Optional) Enter your Apple Team ID (10 chars). Leave blank if unknown:
set /p EXPO_APPLE_TEAM_ID=Apple Team ID: 

REM ---- Environment for this session ----
REM Skip Git checks if Git is missing/broken
set EAS_NO_VCS=1
REM Force fresh Apple login (ignore local cached session)
set EXPO_NO_KEYCHAIN=1
REM Export Apple vars for EAS
set "EXPO_APPLE_ID=%EXPO_APPLE_ID%"
if not "%EXPO_APPLE_TEAM_ID%"=="" set "EXPO_APPLE_TEAM_ID=%EXPO_APPLE_TEAM_ID%"

echo.
echo [0/6] Quick sanity note:
echo  - app.json "plugins" should NOT include "react-native-webview"
echo  - WebView library must be installed:  npx expo install react-native-webview
echo.

echo [1/6] Validate Expo app config...
npx expo config --json
if errorlevel 1 goto :err

echo.
echo [2/6] Login to Expo (safe to skip if already logged in)...
npx eas login
if errorlevel 1 goto :err

echo.
echo [3/6] Configure EAS project...
npx eas build:configure
if errorlevel 1 goto :err

echo.
echo [4/6] Register iOS device (adhoc)...
echo  - A URL will be printed. Open it on your iPhone (Safari) and install the profile.
npx eas device:create --platform ios
if errorlevel 1 goto :err

echo.
echo [5/6] Build iOS Ad-hoc .ipa (internal distribution)...
npx eas build -p ios --profile internal
if errorlevel 1 goto :err

echo.
echo [6/6] Done.
echo  - Open the EAS build page / install link on iPhone (Safari) to install the app.
echo  - After install: iOS Settings > General > VPN & Device Management > Trust the developer.
echo.
echo Keep your Vite server running so WebView can load http://192.168.3.170:5173 :
echo   npm run dev -- --host
echo.
echo Press any key to exit...
pause >nul
exit /b 0

:err
echo.
echo [ERROR] A command failed. See messages above for the real cause.
echo This window will stay open. Press any key to exit...
pause >nul
exit /b 1
