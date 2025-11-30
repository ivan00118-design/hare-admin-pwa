import React from "react";
import { NavLink } from "react-router-dom";
// 引入 Logo
import Logo from "../assets/logo.png";

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

const keyToPath: Record<string, string> = {
  dashboard: "/dashboard",
  orders: "/orders",
  inventory: "/inventory",
  delivery: "/delivery",
  reports: "/reports",
  history: "/history",
};

export default function Sidebar({ items = defaultItems, onSelect }: Props) {
  return (
    <nav className="flex flex-col items-center gap-2 p-3 w-[64px] h-full bg-gray-50 border-r border-gray-200">
      
      {/* 頂部 Logo 區域：圓角、陰影 */}
      <div className="mb-4 mt-2 w-10 h-10 bg-white rounded-lg shadow-sm border border-gray-200 p-1 flex items-center justify-center shrink-0">
        <img src={Logo} alt="App" className="w-full h-full object-contain" />
      </div>

      {items.map((it) => {
        // Dashboard 通常對應根路徑 "/" 或 "/dashboard"
        // 這裡確保 dashboard 指向 "/"，避免選中狀態判斷錯誤 (如果路由設定是 "/" 為 Dashboard)
        const to = it.key === "dashboard" ? "/Dashboard" : (keyToPath[it.key] ?? "/Dashboard");
        
        return (
          <NavLink
            key={it.key}
            to={to}
            onClick={() => onSelect?.(it.key)}
            className={({ isActive }) =>
              [
                "flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200",
                "hover:bg-white hover:shadow-sm hover:text-blue-600 text-gray-500",
                // 選中狀態樣式
                isActive 
                  ? "bg-white shadow-md text-blue-600 ring-1 ring-black/5" 
                  : ""
              ].join(" ")
            }
            title={it.label}
            // 如果 dashboard 對應 "/"，則不需要 end 屬性，因為 NavLink 預設是模糊匹配
            // 如果 dashboard 對應 "/dashboard"，則需要 end 屬性
            end={it.key === "dashboard"}
          >
            <span className="text-xl filter drop-shadow-sm leading-none">{it.icon}</span>
            <span className="sr-only">{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
