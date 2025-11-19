import React from "react";
import { createBrowserRouter } from "react-router-dom";
import AppShell from "./layouts/AppShell";
import AuthGuard from "./components/AuthGuard";

import SalesDashboard from "./pages/SalesDashboard";
import Dashboard from "./pages/Dashboard";
import Delivery from "./pages/Delivery";
import History from "./pages/History";
import InventoryManagement from "./pages/InventoryManagement";
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
      { path: "dashboard", element: <Dashboard /> },
      { path: "delivery", element: <Delivery /> },      // "/delivery" ⬅ 這條給 Sidebar 用
      { path: "history", element: <History /> },
    ],
  },
  { path: "/login", element: <Login /> },
]);
