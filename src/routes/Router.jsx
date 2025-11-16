import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import InventoryPage from "../modules/inventory/InventoryPage.jsx";
import SalesDashboard from "../modules/sales/SalesDashboard.jsx";

export default function AppRouter() {
  console.log("✅ Router loaded"); // 確認是否有出現在 console
  return (
    <BrowserRouter>
      <div className="flex">
        <Sidebar />
        <main className="flex-1 bg-gray-50 min-h-screen p-6 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/pos" />} />
            <Route path="/pos" element={<SalesDashboard />} /> {/* ✅ POS Order 頁 */}
            <Route path="/inventory" element={<InventoryPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
