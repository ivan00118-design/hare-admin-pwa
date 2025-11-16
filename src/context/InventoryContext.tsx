import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

export type Category = "drinks" | "HandDrip";
export type DrinkSubKey = "espresso" | "singleOrigin";

export type DrinkProduct = {
  id: string; name: string; stock: number; price: number; usagePerCup: number; unit: "kg";
};
export type BeanProduct = {
  id: string; name: string; stock: number; price: number; grams: number; unit: "kg";
};
export type Inventory = {
  store: {
    drinks: { espresso: DrinkProduct[]; singleOrigin: DrinkProduct[] };
    HandDrip: BeanProduct[];
  };
};

export type CartItem = {
  id: string; name: string; qty: number; price: number;
  category: Category; subKey?: DrinkSubKey | null;
  grams?: number | null; deductKg?: number; usagePerCup?: number; unit?: "kg";
};

export type Order = {
  id: string;
  createdAt: string;
  items: CartItem[];
  total: number;
  paymentMethod?: string;
  voided?: boolean;
  voidedAt?: string | null;
  voidReason?: string | null;
};

type Ctx = {
  orgId: string | null;
  ready: boolean;
  inventory: Inventory;
  orders: Order[];
  setInventory: (updaterOrValue: Inventory | ((prev: Inventory) => Inventory)) => void;
  addProduct: (
    category: Category,
    subKey: DrinkSubKey | null,
    data: Partial<DrinkProduct & BeanProduct> & { name: string; price: number; grams?: number }
  ) => void;
  deleteProduct: (category: Category, subKey: DrinkSubKey | null, id: string) => void;
  sellItem: (category: Category, subKey: DrinkSubKey | null, id: string, deductKg: number) => void;
  createOrder: (cart: CartItem[], totalAmount: number, extra?: { paymentMethod?: string }) => string | null;
  voidOrder: (orderId: string, opts?: { restock?: boolean; reason?: string | null }) => void;
  repairInventory: () => void;
};

const DEFAULT_INVENTORY: Inventory = {
  store: { drinks: { espresso: [], singleOrigin: [] }, HandDrip: [] },
};

const InventoryContext = createContext<Ctx | null>(null);
export const useInventory = () => {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error("useInventory must be used within InventoryProvider");
  return ctx;
};

const newId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function normalizeInventory(v: any): Inventory {
  const espresso = Array.isArray(v?.store?.drinks?.espresso) ? v.store.drinks.espresso : [];
  const singleOrigin = Array.isArray(v?.store?.drinks?.singleOrigin) ? v.store.drinks.singleOrigin : [];
  const handDrip = Array.isArray(v?.store?.HandDrip) ? v.store.HandDrip : [];
  return { store: { drinks: { espresso, singleOrigin }, HandDrip: handDrip } };
}

// -------- 以 select→update/insert 寫入 app_state（完全避免 on_conflict）--------
async function saveAppState(orgId: string | null, key: "pos_inventory" | "pos_orders", value: unknown) {
  if (!orgId) return;

  // 先查是否存在
  const { data: exists, error: selErr } = await supabase
    .from("app_state")
    .select("org_id,key")
    .eq("org_id", orgId)
    .eq("key", key)
    .maybeSingle();

  // 非「找不到」的錯誤才記錄
  if (selErr && (selErr as any).code !== "PGRST116") {
    console.error("[app_state select]", key, selErr);
    return;
  }

  if (exists) {
    const { error: updErr } = await supabase
      .from("app_state")
      .update({ state: value }) // ← 統一使用 state 欄位
      .eq("org_id", orgId)
      .eq("key", key);
    if (updErr) console.error("[app_state update]", key, updErr);
  } else {
    const { error: insErr } = await supabase
      .from("app_state")
      .insert([{ org_id: orgId, key, state: value }]); // ← 第一次建立
    if (insErr) console.error("[app_state insert]", key, insErr);
  }
}

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [inventory, setInventoryState] = useState<Inventory>(DEFAULT_INVENTORY);
  const [orders, setOrders] = useState<Order[]>([]);

  // ---- load org & app_state ----
  useEffect(() => {
    let disposed = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;
      if (!userId) { setReady(true); return; }

      const { data: emp, error: empErr } = await supabase
        .from("employees")
        .select("org_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (empErr) console.error(empErr);

      const oid = emp?.org_id ?? null;
      setOrgId(oid);

      if (!oid) { setReady(true); return; }

      // 讀取 app_state（使用 state jsonb）
      const [{ data: invRow }, { data: ordRow }] = await Promise.all([
        supabase.from("app_state").select("state").eq("org_id", oid).eq("key", "pos_inventory").maybeSingle(),
        supabase.from("app_state").select("state").eq("org_id", oid).eq("key", "pos_orders").maybeSingle(),
      ]);

      if (!disposed) {
        if (invRow?.state) setInventoryState(normalizeInventory(invRow.state));
        if (ordRow?.state) setOrders(Array.isArray(ordRow.state) ? ordRow.state : []);
      }

      // Realtime：同 org 的 app_state 變更就同步（使用 state）
      const channel = supabase
        .channel("realtime:app_state")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "app_state", filter: `org_id=eq.${oid}` },
          (payload: any) => {
            const row = payload.new || payload.old || {};
            if (row.key === "pos_inventory" && row.state) {
              setInventoryState(normalizeInventory(row.state));
            }
            if (row.key === "pos_orders" && row.state) {
              setOrders(Array.isArray(row.state) ? row.state : []);
            }
          }
        );
      await channel.subscribe();

      setReady(true);

      return () => { supabase.removeChannel(channel); };
    })();

    return () => { disposed = true; };
  }, []);

  // ---- persist helpers ----
  const setInventory: Ctx["setInventory"] = (updaterOrValue) => {
    setInventoryState((prev) => {
      const next = typeof updaterOrValue === "function"
        ? (updaterOrValue as (p: Inventory) => Inventory)(prev)
        : updaterOrValue;
      // 非同步保存（idempotent）
      saveAppState(orgId, "pos_inventory", next);
      return next;
    });
  };

  // ---- CRUD：產品 ----
  const addProduct: Ctx["addProduct"] = (category, subKey, data) => {
    const id = newId();
    const price = Number(data.price) || 0;

    setInventory((prev) => {
      const next = normalizeInventory(prev);
      if (category === "drinks") {
        const item: DrinkProduct = {
          id, name: (data.name || "").trim(), stock: Number(data.stock) || 0,
          price, usagePerCup: Number((data as any).usagePerCup) || 0.02, unit: "kg",
        };
        const key = (subKey || "espresso") as DrinkSubKey;
        next.store.drinks[key] = [...(Array.isArray(next.store.drinks[key]) ? next.store.drinks[key] : []), item];
      } else {
        const item: BeanProduct = {
          id, name: (data.name || "").trim(), stock: Number(data.stock) || 0,
          price, grams: Number((data as any).grams) || 250, unit: "kg",
        };
        next.store.HandDrip = [...(Array.isArray(next.store.HandDrip) ? next.store.HandDrip : []), item];
      }
      return next;
    });
  };

  const deleteProduct: Ctx["deleteProduct"] = (category, subKey, id) => {
    setInventory((prev) => {
      const next = normalizeInventory(prev);
      if (category === "drinks") {
        const key = (subKey || "espresso") as DrinkSubKey;
        next.store.drinks[key] = (Array.isArray(next.store.drinks[key]) ? next.store.drinks[key] : []).filter((p) => p.id !== id);
      } else {
        next.store.HandDrip = (Array.isArray(next.store.HandDrip) ? next.store.HandDrip : []).filter((p) => p.id !== id);
      }
      return next;
    });
  };

  const sellItem: Ctx["sellItem"] = (category, subKey, id, deductKg) => {
    setInventory((prev) => {
      const next = normalizeInventory(prev);
      const minus = Math.max(0, Number(deductKg) || 0);
      if (category === "drinks") {
        const key = (subKey || "espresso") as DrinkSubKey;
        next.store.drinks[key] = (Array.isArray(next.store.drinks[key]) ? next.store.drinks[key] : []).map((p) =>
          p.id === id ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - minus) } : p
        );
      } else {
        next.store.HandDrip = (Array.isArray(next.store.HandDrip) ? next.store.HandDrip : []).map((p) =>
          p.id === id ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - minus) } : p
        );
      }
      return next;
    });
  };

  // ---- 訂單：結帳 / 作廢 ----
  const createOrder: Ctx["createOrder"] = (cart, totalAmount, extra) => {
    if (!Array.isArray(cart) || cart.length === 0) return null;

    // 試算庫存
    const next = normalizeInventory(inventory);
    for (const it of cart) {
      const minus = Number(it.deductKg) || (
        it.category === "drinks"
          ? (Number(it.qty) || 0) * (Number(it.usagePerCup) || 0.02)
          : ((Number(it.grams) || 0) * (Number(it.qty) || 0)) / 1000
      );
      if (it.category === "drinks") {
        const key = (it.subKey || "espresso") as DrinkSubKey;
        next.store.drinks[key] = (Array.isArray(next.store.drinks[key]) ? next.store.drinks[key] : []).map((p) =>
          p.id === it.id ? { ...p, stock: (Number(p.stock) || 0) - minus } : p
        );
      } else {
        next.store.HandDrip = (Array.isArray(next.store.HandDrip) ? next.store.HandDrip : []).map((p) =>
          p.id === it.id ? { ...p, stock: (Number(p.stock) || 0) - minus } : p
        );
      }
    }

    // 不允許變成負數（放寬一點點浮點誤差）
    const tooLow = [
      ...next.store.drinks.espresso,
      ...next.store.drinks.singleOrigin,
      ...next.store.HandDrip,
    ].some((p) => (Number(p.stock) || 0) < -1e-9);
    if (tooLow) {
      alert("庫存不足，請檢查商品設定");
      return null;
    }

    const id = newId();
    const order: Order = {
      id,
      createdAt: new Date().toISOString(),
      items: cart.map((c) => ({
        id: c.id, name: c.name, qty: c.qty, price: c.price,
        category: c.category, subKey: c.subKey ?? null,
        grams: c.grams ?? null, deductKg: c.deductKg,
      })),
      total: Number(totalAmount) || 0,
      paymentMethod: extra?.paymentMethod,
    };

    // 本地更新
    setInventoryState(next);
    const nextOrders = [order, ...orders];
    setOrders(nextOrders);

    // 後寫入（避免 on_conflict）
    saveAppState(orgId, "pos_inventory", next);
    saveAppState(orgId, "pos_orders", nextOrders);

    return id;
  };

  const voidOrder: Ctx["voidOrder"] = (orderId, opts) => {
    const { restock = true, reason = null } = opts || {};
    const idx = orders.findIndex((o) => o.id === orderId);
    if (idx < 0) return;
    const target = orders[idx];
    if (target.voided) return; // already voided

    let nextInv = inventory;
    if (restock) {
      nextInv = normalizeInventory(inventory);
      for (const it of target.items) {
        const plus = Number(it.deductKg) || (
          it.category === "drinks"
            ? (Number(it.qty) || 0) * (Number(it.usagePerCup) || 0.02)
            : ((Number(it.grams) || 0) * (Number(it.qty) || 0)) / 1000
        );
        if (it.category === "drinks") {
          const key = (it.subKey || "espresso") as DrinkSubKey;
          nextInv.store.drinks[key] = (Array.isArray(nextInv.store.drinks[key]) ? nextInv.store.drinks[key] : []).map((p) =>
            p.id === it.id ? { ...p, stock: (Number(p.stock) || 0) + plus } : p
          );
        } else {
          nextInv.store.HandDrip = (Array.isArray(nextInv.store.HandDrip) ? nextInv.store.HandDrip : []).map((p) =>
            p.id === it.id ? { ...p, stock: (Number(p.stock) || 0) + plus } : p
          );
        }
      }
      setInventoryState(nextInv);
      saveAppState(orgId, "pos_inventory", nextInv);
    }

    const updated = { ...target, voided: true, voidedAt: new Date().toISOString(), voidReason: reason };
    const nextOrders = orders.slice();
    nextOrders[idx] = updated;
    setOrders(nextOrders);
    saveAppState(orgId, "pos_orders", nextOrders);
  };

  // ---- 工具：刪重（name+grams 同名合併）----
  const repairInventory: Ctx["repairInventory"] = () => {
    setInventory((prev) => {
      const next = normalizeInventory(prev);

      const dedup = <T extends { id: string; name: string; grams?: number }>(arr: T[]) => {
        const m = new Map<string, T>();
        for (const it of (Array.isArray(arr) ? arr : [])) {
          const k = `${(it.name || "").trim().toLowerCase()}|${Number(it.grams) || 0}`;
          if (!m.has(k)) m.set(k, it);
        }
        return Array.from(m.values());
      };

      next.store.drinks.espresso = dedup(next.store.drinks.espresso);
      next.store.drinks.singleOrigin = dedup(next.store.drinks.singleOrigin);
      next.store.HandDrip = dedup(next.store.HandDrip);
      return next;
    });
  };

  const value = useMemo<Ctx>(() => ({
    orgId, ready,
    inventory, orders,
    setInventory, addProduct, deleteProduct, sellItem,
    createOrder, voidOrder, repairInventory,
  }), [orgId, ready, inventory, orders]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}
