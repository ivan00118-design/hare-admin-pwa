import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';

export default function AppShell() {
  return (
    // 外層容器：強制固定在視窗範圍，禁止整體捲動
    <div className="fixed inset-0 w-full h-full bg-gray-50 flex flex-col text-gray-900">
      
      {/* [手機版頂部安全區]
        直接使用 style 確保能讀取到 env 變數。
        背景設為白色，讓狀態列看起來像原生 App。
      */}
      <div 
        className="w-full bg-white md:hidden shrink-0" 
        style={{ height: 'env(safe-area-inset-top)' }} 
      />

      {/* 中間主體區域：包含側邊欄與內容 */}
      <div className="flex-1 flex overflow-hidden relative w-full">
        
        {/* [電腦版] 側邊欄 */}
        <aside className="hidden md:flex flex-col w-64 border-r border-gray-200 bg-white h-full overflow-y-auto">
          <Sidebar />
        </aside>

        {/* [主內容區] */}
        <main className="flex-1 w-full h-full bg-gray-50 relative">
          {/* 內容捲動容器：
             1. absolute inset-0: 佔滿剩餘空間
             2. overflow-y-auto: 只有這個區域可以捲動
             3. webkit-overflow-scrolling-touch: 讓 iOS 捲動更順暢
          */}
          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden scroll-smooth -webkit-overflow-scrolling-touch">
            {/* 內容內距：
               pb-32: 手機版底部留白 (避開 BottomNav)
               md:pb-8: 電腦版底部留白
            */}
            <div className="p-4 md:p-8 pb-32 md:pb-8 max-w-7xl mx-auto">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {/* [手機版] 底部導航 */}
      <div className="md:hidden relative z-50 shrink-0">
        <BottomNav />
      </div>

    </div>
  );
}
