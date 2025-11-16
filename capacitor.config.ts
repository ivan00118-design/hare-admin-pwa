// capacitor.config.ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourco.pos',
  appName: 'POS',
  webDir: 'dist', // CRA 請改 'build'

// ——（選擇）開發用 Live Reload，iPhone 連你的 Dev Server：
// 先把 <你的MacIP> 換成實際區網 IP；iPhone 與 Mac 需同一個 Wi‑Fi
// 只在開發時啟用，打包正式版請註解掉
//  server: {
//    url: 'http://<你的MacIP>:5173'
//  }
};

export default config;
