// src/layouts/AppShell.tsx
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar"; // 你自己的 Sidebar

export default function AppShell() {
  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr]">
      <aside className="border-r bg-white">
        <Sidebar />
        {/* <FallbackSidebar />  // 要用時再打開 */}
      </aside>
      <main className="p-6 bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}

