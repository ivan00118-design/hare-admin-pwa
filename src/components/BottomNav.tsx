import { Link, useLocation } from 'react-router-dom';
// 引入您在 Sidebar 使用的相同 icon

export default function BottomNav() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  // 定義選單項目 (參考 Sidebar.tsx)
  const navItems = [
    { path: '/', label: '儀表板', icon: 'ChartIcon' }, // 替換為您的 Icon 元件
    { path: '/sales', label: '銷售', icon: 'TagIcon' },
    { path: '/inventory', label: '庫存', icon: 'BoxIcon' },
    { path: '/orders', label: '訂單', icon: 'ClipboardIcon' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)] z-50 md:hidden">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => (
          <Link 
            key={item.path} 
            to={item.path} 
            className={`flex flex-col items-center justify-center w-full h-full ${isActive(item.path) ? 'text-blue-600' : 'text-gray-500'}`}
          >
            {/* 這裡放 Icon 元件 */}
            <span className="text-[10px] mt-1">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
