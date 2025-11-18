import { Outlet, NavLink } from "react-router-dom";

function FallbackSidebar() {
  return (
    <nav className="p-4 flex flex-col gap-2 text-sm">
      <NavLink to="/" className="hover:underline">Home</NavLink>
      <NavLink to="/delivery" className="hover:underline">Delivery</NavLink>
    </nav>
  );
}

// 若你專案已有 Sidebar 元件，換成你的匯入即可
import Sidebar from "../components/Sidebar";

export default function AppShell() {
  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr]">
      <aside className="border-r bg-white">
        {/* <Sidebar /> */}
        <FallbackSidebar />
      </aside>
      <main className="p-6 bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
