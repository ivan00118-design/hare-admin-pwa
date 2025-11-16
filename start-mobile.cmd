@echo off
start "Vite" cmd /k "cd /d C:\Users\Ivan\Desktop\Hare\hare-admin-pwa && npm run dev -- --host"
start "Expo" cmd /k "cd /d C:\Users\Ivan\Desktop\Hare\hare-admin-pwa\pos-webview && npx expo start --tunnel"
