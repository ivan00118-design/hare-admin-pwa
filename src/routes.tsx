// src/routes.tsx
import React from "react";
import { createBrowserRouter } from "react-router-dom";

import AppShell from "./layouts/AppShell";
import AuthGuard from "./components/AuthGuard";

// 依你的專案調整匯入的頁面
import SalesDashboard from "./pages/SalesDashboard";
import InventoryManagement from "./pages/InventoryManagement";
import Orders from "./pages/OrdersPage";
import Dashboard from "./pages/Dashboard";
import Delivery from "./pages/Delivery";
import History from "./pages/History";
import Login from "./auth/Login";

export const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <SalesDashboard /> },     // "/"
      { path: "inventory", element: <InventoryManagement /> },
      { path: "orders", element: <Orders /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "delivery", element: <Delivery /> },      // "/delivery" ⬅ 這條給 Sidebar 用
      { path: "history", element: <History /> },
    ],
  },
  { path: "/login", element: <Login /> },
]);
