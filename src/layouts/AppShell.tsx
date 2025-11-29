// 修改 src/layouts/AppShell.tsx
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav'; // 引入剛剛建立的元件

export default function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">
      {/* 桌面版側邊欄: 只在 md (平板/電腦) 以上顯示 */}
      <div className="hidden md:flex h-full w-64 flex-col fixed inset-y-0 z-50 border-r border-gray-200 bg-white">
        <Sidebar />
      </div>

      {/* 主內容區域 */}
      <main className="flex-1 flex flex-col h-full w-full md:pl-64">
        {/* 1. pb-20: 手機版底部留白，避免內容被 BottomNav 擋住 
           2. md:pb-0: 電腦版不需要底部留白
           3. overflow-y-auto: 確保內容可以捲動
        */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8">
          <Outlet />
        </div>
      </main>

      {/* 手機版底部導航: 只在手機版顯示 (在 BottomNav 內部已經寫了 md:hidden) */}
      <BottomNav />
    </div>
  );
}
