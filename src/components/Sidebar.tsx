// src/components/Sidebar.tsx
import React from "react";
import { NavLink } from "react-router-dom";

type Item = { key: string; label: string; icon: string };
type Props = { items?: Item[]; onSelect?: (k: string) => void };

const defaultItems: Item[] = [
  { key: "dashboard", label: "Dashboard", icon: "🏠" },
  { key: "inventory", label: "Inventory", icon: "📦" },
  { key: "orders",    label: "Orders",    icon: "🧾" },
  { key: "reports",   label: "Reports",   icon: "📊" },
  { key: "delivery",  label: "Delivery",  icon: "🚚" },
  { key: "history",   label: "History",   icon: "🕘" },
];

// 👉 key -> path 的對照表（依你的實際路由調整）
// 如果沒有 /orders 或 /reports 路由，先刪除 defaultItems 裡對應項目，或把下列路徑改到現有頁面。
const keyToPath: Record<string, string> = {
  dashboard: "/",
  inventory: "/inventory",
  orders: "/orders",
  reports: "/dashboard", // 若你有 /reports，改成 "/reports"
  delivery: "/delivery",
  history: "/history",
};

export default function Sidebar({ items = defaultItems, onSelect }: Props) {
  return (
    <nav className="flex flex-col items-center gap-2 p-2 w-[64px]">
      {items.map((it) => {
        const to = keyToPath[it.key] ?? "/";
        return (
          <NavLink
            key={it.key}
            to={to}
            onClick={() => onSelect?.(it.key)}
            className={({ isActive }) =>
              [
                "flex items-center justify-center w-10 h-10 rounded-md",
                "hover:bg-gray-100",
                isActive ? "bg-gray-200 ring-1 ring-gray-300" : ""
              ].join(" ")
            }
            title={it.label}
            // 避免 "/" 也把 "/dashboard" 判成 active
            end={it.key === "dashboard"}
          >
            <span className="text-xl" aria-hidden>{it.icon}</span>
            <span className="sr-only">{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
