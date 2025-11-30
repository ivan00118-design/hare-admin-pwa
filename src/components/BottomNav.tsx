import React from 'react';
import { NavLink } from 'react-router-dom';

export default function BottomNav() {
  // 使用 Emoji 作為圖示，風格統一且效能好
  const navItems = [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/orders', label: 'Orders', icon: '🧾' },
    { path: '/inventory', label: 'Items', icon: '📦' },
    { path: '/delivery', label: 'Ship', icon: '🚚' },
  ];

  return (
    // 使用 backdrop-blur-md 製作毛玻璃效果，並加上頂部邊框與陰影
    <nav className="w-full bg-white/90 backdrop-blur-md border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
      <div className="flex justify-around items-center h-[60px] px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full space-y-[2px] active-press transition-all duration-200 ${
                isActive 
                  ? 'text-blue-600' 
                  : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* 選中時圖示稍微放大並增加陰影 */}
                <span className={`text-2xl leading-none filter ${isActive ? 'drop-shadow-sm scale-110' : 'grayscale opacity-80'} transition-all`}>
                  {item.icon}
                </span>
                <span className={`text-[10px] font-semibold tracking-wide ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
      
      {/* 底部安全區填充 (Home Bar) */}
      <div style={{ height: 'var(--sab)' }} className="w-full bg-white/90 backdrop-blur-md" />
    </nav>
  );
}
