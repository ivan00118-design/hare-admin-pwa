import React, { useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import SalesDashboard from "./pages/SalesDashboard";
import History from "./pages/History";
import Dashboard from "./pages/Dashboard";
import InventoryManagement from "./pages/InventoryManagement";
import { AuthGate } from "./auth/AuthGate";
import { AppStateProvider } from "./context/AppState";

function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-extrabold mb-2">{title}</h1>
      <p className="text-gray-500">{note || "This page is under construction."}</p>
    </div>
  );
}

const App: React.FC = () => {
  const [activePage, setActivePage] = useState("orders");
  const menu = useMemo(
    () => [
      { key: "dashboard", label: "Dashboard", icon: "🏠" },
      { key: "inventory", label: "Inventory", icon: "📦" },
      { key: "orders", label: "Orders", icon: "🧾" },
      { key: "reports", label: "Reports", icon: "📊" },
      { key: "history", label: "History", icon: "🕘" }
    ],
    []
  );

  const Page = useMemo(() => {
    switch (activePage) {
      case "orders":
        return <SalesDashboard />;
      case "history":
        return <History />;
      case "inventory":
        return <InventoryManagement />;
      case "dashboard":
        return <Dashboard />;
      case "reports":
        return <Placeholder title="Reports" />;
      default:
        return <Placeholder title="Not Found" />;
    }
  }, [activePage]);

  return (
    <AuthGate>
      <AppStateProvider>
        <div className="min-h-screen bg-gray-100 md:flex">
          <Sidebar items={menu} activeKey={activePage} onSelect={setActivePage} />
          <main className="flex-1">{Page}</main>
        </div>
      </AppStateProvider>
    </AuthGate>
  );
};

export default App;
