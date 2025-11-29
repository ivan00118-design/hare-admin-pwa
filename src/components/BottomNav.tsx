import { Link, useLocation } from 'react-router-dom';

export default function BottomNav() {
  const location = useLocation();

  // 改用 Emoji，與 Sidebar 風格一致，且無需安裝額外套件
  const navItems = [
    { path: '/', label: '儀表板', icon: '🏠' },
    { path: '/sales', label: '銷售', icon: '💰' }, 
    { path: '/inventory', label: '庫存', icon: '📦' },
    { path: '/orders', label: '訂單', icon: '🧾' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          // 簡單的路由匹配判斷
          const isActive = location.pathname === item.path || 
                           (item.path !== '/' && location.pathname.startsWith(item.path));
                           
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
                isActive ? 'text-blue-600 bg-gray-50' : 'text-gray-500'
              }`}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
