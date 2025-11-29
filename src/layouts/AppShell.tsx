import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';

export default function AppShell() {
  return (
    // 外層容器：使用 100dvh 確保高度準確，並加上頂部安全距離 (避開瀏海)
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-gray-50 pt-[env(safe-area-inset-top)]">
      
      {/* --- 桌面版側邊欄 (MD 以上顯示) --- */}
      <div className="hidden md:flex h-full w-64 flex-col fixed inset-y-0 z-50 border-r border-gray-200 bg-white top-[env(safe-area-inset-top)]">
        <Sidebar />
      </div>

      {/* --- 主內容區域 --- */}
      <main className="flex-1 flex flex-col h-full w-full md:pl-64">
        {/* flex-1 overflow-y-auto: 讓內容區塊獨立捲動，不會帶著導航列一起捲
           pb-32: 手機版底部加寬留白，防止內容被 BottomNav 擋住
           md:pb-8: 桌面版維持正常留白
        */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-32 md:pb-8 scroll-smooth">
          <Outlet />
        </div>
      </main>

      {/* --- 手機版底部導航 (MD 以下顯示) --- */}
      <BottomNav />
    </div>
  );
}
