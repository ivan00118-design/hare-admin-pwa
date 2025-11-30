import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';

export default function AppShell() {
  return (
    // 外層容器：強制固定在視窗範圍，禁止整體捲動
    // text-gray-900 與 bg-gray-50 是我們新的基礎色調
    <div className="fixed inset-0 w-full h-full bg-gray-50 flex flex-col text-gray-900">
      
      {/* 手機版頂部狀態列安全區 (白色背景) 
          這樣做可以讓 iPhone 的狀態列看起來是白底黑字，與 App 融為一體
      */}
      <div 
        className="w-full bg-white md:hidden shrink-0 z-50 transition-colors duration-300" 
        style={{ height: 'var(--sat)' }} 
      />

      {/* 中間主體區域：包含側邊欄(左) 與 主內容(右) */}
      <div className="flex-1 flex overflow-hidden relative w-full">
        
        {/* 電腦版側邊欄 (MD 以上顯示) */}
        <aside className="hidden md:flex flex-col w-72 border-r border-gray-200 bg-white h-full z-20 shadow-sm">
          <Sidebar />
        </aside>

        {/* 主內容區 */}
        <main className="flex-1 w-full h-full relative">
          {/* 內容捲動容器：
              1. absolute inset-0: 佔滿父容器
              2. overflow-y-auto: 啟用垂直捲動
              3. no-scrollbar: 隱藏醜醜的捲軸 (需搭配 index.css)
              4. scroll-smooth: 平滑捲動效果
          */}
          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden no-scrollbar scroll-smooth -webkit-overflow-scrolling-touch">
            {/* 內容內距：
                pb-32: 手機版底部留白，防止內容被 BottomNav 擋住
                md:pb-10: 電腦版底部正常留白
            */}
            <div className="min-h-full p-4 md:p-10 pb-32 md:pb-10 max-w-7xl mx-auto">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {/* 手機版底部導航 (MD 以下顯示) 
          z-50 確保浮在內容之上
      */}
      <div className="md:hidden relative z-50 shrink-0">
        <BottomNav />
      </div>
    </div>
  );
}
