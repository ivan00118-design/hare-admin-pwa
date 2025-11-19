// src/components/Sidebar.tsx
import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { NavLink } from "react-router-dom";


type Item = { key: string; label: string; icon: string };
type Props = {
  items?: Item[];
  activeKey?: string;
  onSelect?: (k: string) => void;
};

const defaultItems: Item[] = [
  { key: "dashboard", label: "Dashboard", icon: "🏠" },
  { key: "inventory", label: "Inventory", icon: "📦" },
  { key: "orders",    label: "Orders",    icon: "🧾" },
  { key: "reports",   label: "Reports",   icon: "📊" },
  { key: "delivery",  label: "Delivery",  icon:"🚚"  },
  { key: "history",   label: "History",   icon: "🕘" },
];

const routeByKey: Record<string, string> = {
  dashboard: "/",
  inventory: "/inventory",
  orders: "/orders",
  reports: "/dashboard", // 或你實際的 reports 路由
  delivery: "/delivery",
  history: "/history",
};

export default function Sidebar({ items = defaultItems, activeKey, onSelect }: Props) {
  const [openMobile, setOpenMobile] = useState(false);

  const ItemBtn = ({ it }: { it: Item }) => {
    const active = it.key === activeKey;
    return (
      <button
        type="button"
        onClick={() => { onSelect?.(it.key); setOpenMobile(false); }}
        className={[
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
          active ? "bg-red-600 text-white" : "text-gray-800 hover:bg-gray-100 active:bg-gray-200",
        ].join(" ")}
      >
        <span className="text-lg w-6 shrink-0">{it.icon}</span>
        <span className="truncate hidden md:inline-block md:group-[.sidebar]:hover:inline-block">
          {it.label}
        </span>
      </button>
    );
  };

  const signOutNow = async () => {
    await supabase.auth.signOut();
    location.replace("/"); // 清 session 後回首頁
  };

  return (
    <>
      {/* Mobile Hamburger */}
      <button
        type="button"
        className="md:hidden fixed left-3 top-3 z-40 h-10 w-10 rounded-lg bg-white/90 border border-gray-200 shadow flex items-center justify-center"
        onClick={() => setOpenMobile(true)}
        aria-label="Open menu"
      >
        ☰
      </button>

      {/* Mobile Drawer */}
      {openMobile && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenMobile(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div className="font-extrabold text-lg">Menu</div>
              <button
                type="button"
                className="h-8 w-8 rounded-md border border-gray-200"
                onClick={() => setOpenMobile(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <nav className="space-y-1">
              {items.map((it) => <ItemBtn key={it.key} it={it} />)}
            </nav>
            {/* ←← 在 nav 後面追加 Sign out（行動抽屜） */}
            <div className="mt-auto pt-3 border-t">
              <button
                type="button"
                onClick={signOutNow}
                className="w-full h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Rail */}
      <aside
        className="sidebar group/sidebar hidden md:flex md:flex-col md:gap-2 md:p-3
                   md:sticky md:top-0 md:h-screen md:bg-white md:border-r md:border-gray-200
                   md:w-16 md:hover:w-56 transition-[width] duration-200"
      >
        <div className="font-extrabold text-lg mb-1 hidden md:group-[.sidebar]:hover:block">Menu</div>
        <nav className="space-y-1">
          {items.map((it) => <ItemBtn key={it.key} it={it} />)}
        </nav>
        {/* ←← 在 </nav> 後面追加 Sign out（桌面側欄） */}
        <div className="mt-auto pt-3 border-t">
          <button
            type="button"
            onClick={signOutNow}
            className="w-full h-10 rounded-lg border border-gray-300 bg-white hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
