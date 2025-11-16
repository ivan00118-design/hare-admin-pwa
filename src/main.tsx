// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { InventoryProvider } from "./context/InventoryContext";
// 若有登入保護：import AuthGate from "./auth/AuthGate"; import Login from "./auth/Login";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <InventoryProvider>
      {/* 有登入保護時可改成：
        <AuthGate fallback={<Login />}><App/></AuthGate>
      */}
      <App />
    </InventoryProvider>
  </React.StrictMode>
);
