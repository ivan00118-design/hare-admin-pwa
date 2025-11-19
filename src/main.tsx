// src/main.tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppStateProvider } from "./context/AppState";

import AppShell from "./layouts/AppShell";
import AuthGuard from "./components/AuthGuard";

import SalesDashboard from "./pages/SalesDashboard";
import Dashboard from "./pages/Dashboard";
import Delivery from "./pages/Delivery";
import History from "./pages/History";
import InventoryManagement from "./pages/InventoryManagement";
import Login from "./auth/Login"; // 確保這支檔存在

import "./index.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <SalesDashboard /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "inventory", element: <InventoryManagement /> },
      { path: "history", element: <History /> },
      { path: "delivery", element: <Delivery /> }
    ]
  },
  { path: "/login", element: <Login /> }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  </React.StrictMode>
);


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  </React.StrictMode>
);
