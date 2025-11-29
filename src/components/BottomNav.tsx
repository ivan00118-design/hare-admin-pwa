import React from 'react';
import { NavLink } from 'react-router-dom';

export default function BottomNav() {
  // 對應 Sidebar 的功能項目
  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '🏠' },
    { path: '/orders',    label: 'Orders',    icon: '🧾' },
    { path: '/inventory', label: 'Inventory', icon: '📦' },
    { path: '/delivery',  label: 'Delivery',  icon: '🚚' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 md:hidden pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.1)]">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors ${
                isActive ? 'text-blue-600 bg-blue-50/50' : 'text-gray-500 hover:bg-gray-50'
              }`
            }
          >
            <span className="text-2xl leading-none filter drop-shadow-sm">{item.icon}</span>
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
