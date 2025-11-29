import React from 'react';
import { NavLink } from 'react-router-dom';

export default function BottomNav() {
  const navItems = [
    { path: '/', label: 'Dashboard', icon: '🏠' },
    { path: '/orders',    label: 'Orders',    icon: '🧾' },
    { path: '/inventory', label: 'Inventory', icon: '📦' },
    { path: '/delivery',  label: 'Delivery',  icon: '🚚' },
  ];

  return (
    // 外層：背景白、上邊框
    <nav className="w-full bg-white border-t border-gray-200">
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full space-y-1 ${
                isActive ? 'text-blue-600' : 'text-gray-400'
              }`
            }
          >
            <span className="text-2xl leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </NavLink>
        ))}
      </div>
      {/* 底部安全區填充：
         使用 style 確保直接撐開高度，避免被 Home Bar 遮擋
      */}
      <div style={{ height: 'env(safe-area-inset-bottom)' }} className="w-full bg-white" />
    </nav>
  );
}
