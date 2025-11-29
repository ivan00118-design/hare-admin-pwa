import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import BottomNav from '../components/BottomNav';

export default function AppShell() {
  return (
    <div
      className="min-h-screen grid"
      style={{ gridTemplateColumns: "var(--sidebar-w, 64px) 1fr" }}
    >
      <aside className="border-r bg-white">
        <Sidebar />
      </aside>
      <main className="p-6 bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
return (
  <div className="flex h-screen w-screen overflow-hidden bg-gray-50">
    {/* 桌面版顯示 Sidebar (md:flex 表示中型螢幕以上顯示，手機隱藏) */}
    <div className="hidden md:flex h-full w-64 flex-col fixed inset-y-0 z-50">
      <Sidebar />
    </div>

    {/* 主內容區域調整：手機版不需要左邊距 (md:pl-64) */}
    <main className="flex-1 flex flex-col h-full w-full md:pl-64 pb-16 md:pb-0"> 
      {/* pb-16 是為了留空間給手機的 BottomNav */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <Outlet />
      </div>
    </main>

    {/* 手機版顯示底部導航 */}
    <BottomNav />
  </div>
);
