// src/context/OrdersContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

export type PlainOrderItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
  grams?: number;
  category?: string;
  subKey?: string | null;
};

export type PlainOrder = {
  id: string;
  createdAt: string;
  items: PlainOrderItem[];
  total: number;
  discount: number; // 【新增】折扣金額欄位
};

type OrdersContextValue = {
  orders: PlainOrder[];
  addOrder: (order: PlainOrder) => void;
  setOrders: React.Dispatch<React.SetStateAction<PlainOrder[]>>;
};

const OrdersContext = createContext<OrdersContextValue | null>(null);

export function OrdersProvider({ children }: PropsWithChildren) {
  const [orders, setOrders] = useState<PlainOrder[]>(() => {
    try {
      const raw = localStorage.getItem("orders_v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("orders_v1", JSON.stringify(orders));
  }, [orders]);

  const addOrder = (order: PlainOrder) => setOrders((prev) => [order, ...prev]);
  const value = useMemo<OrdersContextValue>(() => ({ orders, addOrder, setOrders }), [orders]);

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  const ctx = useContext(OrdersContext);
  if (!ctx) throw new Error("useOrders must be used within OrdersProvider");
  return ctx;
}
