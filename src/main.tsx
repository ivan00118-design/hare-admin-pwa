import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppStateProvider } from "./context/AppState";
import { router } from "./routes";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  </React.StrictMode>
);