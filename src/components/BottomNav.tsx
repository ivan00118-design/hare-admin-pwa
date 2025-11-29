// 新增 src/components/BottomNav.tsx
import { Link, useLocation } from 'react-router-dom';
// TODO: 請確認這裡的 Icon 引入路徑與你專案中使用的 Icon 套件一致
// 這裡假設你使用 heroicons 或類似的庫，請替換為你 Sidebar 中使用的 Icon
import { 
  Squares2X2Icon as DashboardIcon, 
  BanknotesIcon as SalesIcon, 
  CubeIcon as InventoryIcon, 
  ClipboardDocumentListIcon as OrdersIcon 
} from '@heroicons/react/24/outline'; 

export default function BottomNav() {
  const location = useLocation();

  // 定義導航項目 (請依據你的需求增減)
  const navItems = [
    { path: '/', label: '儀表板', icon: DashboardIcon },
    { path: '/sales', label: '銷售', icon: SalesIcon },
    { path: '/inventory', label: '庫存', icon: InventoryIcon },
    { path: '/orders', label: '訂單', icon: OrdersIcon },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <item.icon className="w-6 h-6" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
