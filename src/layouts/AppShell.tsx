import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';

export default function AppShell() {
  return (
    <div className="fixed inset-0 w-full h-full bg-slate-50 flex flex-col text-slate-900">
      
      {/* 頂部狀態列安全區 (白色背景，避免內容與狀態列重疊) */}
      <div 
        className="w-full bg-white md:hidden shrink-0 z-50 transition-colors duration-300" 
        style={{ height: 'var(--sat)' }} 
      />

      <div className="flex-1 flex overflow-hidden relative w-full">
        
        {/* 電腦版側邊欄 */}
        <aside className="hidden md:flex flex-col w-72 border-r border-slate-200 bg-white h-full z-20 shadow-sm">
          <Sidebar />
        </aside>

        {/* 主內容區 */}
        <main className="flex-1 w-full h-full relative">
          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden no-scrollbar scroll-smooth -webkit-overflow-scrolling-touch">
            {/* 內容容器：手機版增加頂部間距，底部避開導航 */}
            <div className="min-h-full p-4 md:p-10 pb-32 md:pb-10 max-w-7xl mx-auto">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {/* 手機版底部導航 */}
      <div className="md:hidden relative z-50 shrink-0">
        <BottomNav />
      </div>
    </div>
  );
}
