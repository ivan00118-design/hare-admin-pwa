// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppStateProvider } from "./context/AppState";
import SalesDashboard from "./pages/SalesDashboard";
import Dashboard from "./pages/Dashboard";
import Delivery from "./pages/Delivery";
import History from "./pages/History";
import InventoryManagement from "./pages/InventoryManagement";
import "./index.css";

const router = createBrowserRouter([
  { path: "/", element: <SalesDashboard /> },
  { path: "/dashboard", element: <Dashboard /> },
  { path: "/inventory", element: <InventoryManagement /> },
  { path: "/history", element: <History /> },
  // ★ 新增的 Delivery 路由
  { path: "/delivery", element: <Delivery /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  </React.StrictMode>
);
