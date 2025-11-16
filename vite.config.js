// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 只會影響本機開發；與 Cloudflare 部署無關
  server: {
    host: true,
    port: 5173,
    // 如果你在同一個區網測試手機 HMR，這個 host 設為你電腦的區網 IP
    hmr: { host: '192.168.3.170', port: 5173 },
  },
  // 明確指定只注入以 VITE_ 開頭的環境變數到前端
  envPrefix: 'VITE_',
})
