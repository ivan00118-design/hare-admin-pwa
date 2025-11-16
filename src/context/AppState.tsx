import React, { createContext, useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { supabase } from "../supabaseClient";

// ====== 型別 ======
export type Category = "drinks" | "HandDrip";
export type DrinkSubKey = "espresso" | "singleOrigin";

export type DrinkProduct = {
  id: string;
  name: string;
  price: number;
  usagePerCup: number; // 每杯扣的公斤數
  stock: number;       // 庫存公斤數
  unit: "kg";
};

export type BeanProduct = {
  id: string;
  name: string;
  price: number;
  grams: number;       // 包裝克數：100 / 250 / 500 / 1000
  stock: number;       // 庫存公斤數（總量，以 kg）
  unit: "kg";
};

export type Inventory = {
  store: {
    drinks: {
      espresso: DrinkProduct[];
      singleOrigin: DrinkProduct[];
    };
    HandDrip: BeanProduct[];
  };
};

export type UIItem = (DrinkProduct | BeanProduct) & {
  category: Category;
  subKey?: DrinkSubKey | null;
  grams?: number | null;
};

// ====== 預設結構 ======
const DEFAULT_INV: Inventory = {
  store: {
    drinks: { espresso: [], singleOrigin: [] },
    HandDrip: []
  }
};

type CartItem = UIItem & { qty: number; deductKg?: number };

type Order = {
  id: string;
  createdAt: string;
  items: Array<Pick<UIItem, "id" | "name" | "grams" | "category" | "subKey"> & { qty: number; price: number }>;
  total: number;
  paymentMethod?: string;
  voided?: boolean;
  voidedAt?: string | null;
  voidReason?: string | null;
};

const POS_INV_KEY = "pos_inventory";
const POS_ORD_KEY = "pos_orders";

type Ctx = {
  ready: boolean;
  orgId: string | null;
  inventory: Inventory;
  orders: Order[];
  setInventory: (updater: Inventory | ((prev: Inventory) => Inventory)) => Promise<void>;
  createOrder: (cart: CartItem[], totalFromUI?: number, extra?: { paymentMethod?: string }) => Promise<string | null>;
  voidOrder: (orderId: string, opt?: { restock?: boolean; reason?: string }) => Promise<void>;
  repairInventory: () => Promise<void>;
};

const AppStateContext = createContext<Ctx | null>(null);
export const useAppState = () => {
  const c = useContext(AppStateContext);
  if (!c) throw new Error("useAppState must be used within AppStateProvider");
  return c;
};

// ====== 小工具 ======
const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function deepClone<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

// 把 Drinks 的 grams 視為 0；HandDrip 用實際 grams，供「去重」用
function keyOf(category: Category, subKey: DrinkSubKey | null, p: Partial<UIItem>) {
  const name = (p?.name || "").trim().toLowerCase();
  const grams = category === "drinks" ? 0 : Number(p?.grams || 0);
  return `${category}|${subKey || ""}|${name}|${grams}`;
}

function dedupeInventory(inv: Inventory): Inventory {
  const next = deepClone(inv);
  const pick = new Map<string, any>();
  // Drinks
  (["espresso", "singleOrigin"] as DrinkSubKey[]).forEach((k) => {
    const list = next.store.drinks[k] || [];
    const arr: DrinkProduct[] = [];
    for (const it of list) {
      const key = keyOf("drinks", k, it);
      const kept = pick.get(key);
      if (!kept) pick.set(key, it);
      else pick.set(key, (Number(it.stock) || 0) < (Number(kept.stock) || 0) ? it : kept);
    }
    for (const v of pick.values()) arr.push(v);
    next.store.drinks[k] = arr;
    pick.clear();
  });
  // Beans
  const beans: BeanProduct[] = [];
  for (const it of next.store.HandDrip || []) {
    const key = keyOf("HandDrip", null, it);
    const kept = pick.get(key);
    if (!kept) pick.set(key, it);
    else pick.set(key, (Number(it.stock) || 0) < (Number(kept.stock) || 0) ? it : kept);
  }
  for (const v of pick.values()) beans.push(v);
  next.store.HandDrip = beans;
  return next;
}

async function getOrgIdForCurrentUser(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("employees")
    .select("org_id")
    .eq("user_id", uid)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.org_id) throw new Error("No organization bound to this user");
  return data.org_id as string;
}

async function readAppState<T>(orgId: string, key: string, fallback: T): Promise<{ value: T; updated_at: string | null }> {
  const { data, error } = await supabase
    .from("app_state")
    .select("value, updated_at")
    .eq("org_id", orgId)
    .eq("key", key)
    .maybeSingle();
  if (error && error.code !== "PGRST116") throw error; // 404 not found → 視為空

  if (!data) {
    // 首次建立
    const { error: upErr } = await supabase
      .from("app_state")
      .upsert([{ org_id: orgId, key, value: fallback }], { onConflict: "org_id,key" });
    if (upErr) throw upErr;
    return { value: fallback, updated_at: null };
  }
  return { value: (data.value as T) ?? fallback, updated_at: data.updated_at ?? null };
}

async function writeAppState<T>(orgId: string, key: string, value: T) {
  const { error } = await supabase
    .from("app_state")
    .upsert([{ org_id: orgId, key, value }], { onConflict: "org_id,key" });
  if (error) throw error;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [inventory, _setInventory] = useState<Inventory>(DEFAULT_INV);
  const [orders, setOrders] = useState<Order[]>([]);
  const invVer = useRef<string | null>(null);
  const ordVer = useRef<string | null>(null);

  // 初始載入
  useEffect(() => {
    let alive = true;
    (async () => {
      const org = await getOrgIdForCurrentUser();
      if (!alive) return;
      setOrgId(org);

      const inv = await readAppState<Inventory>(org, POS_INV_KEY, DEFAULT_INV);
      const ord = await readAppState<Order[]>(org, POS_ORD_KEY, []);
      if (!alive) return;

      invVer.current = inv.updated_at;
      ordVer.current = ord.updated_at;
      _setInventory(dedupeInventory(inv.value));
      setOrders(ord.value);
      setReady(true);

      // Realtime（選配：Supabase Studio → Realtime → 將 public.app_state 納入 supabase_realtime）
      // 沒啟用也沒關係，只是少了即時同步，仍會以以讀寫為主。
      const ch = supabase
        .channel(`app_state_${org}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "app_state", filter: `org_id=eq.${org}` },
          (payload) => {
            const row = payload.new as any;
            if (!row) return;
            if (row.key === POS_INV_KEY) {
              invVer.current = row.updated_at;
              _setInventory(dedupeInventory(row.value as Inventory));
            } else if (row.key === POS_ORD_KEY) {
              ordVer.current = row.updated_at;
              setOrders(row.value as Order[]);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(ch);
      };
    })().catch((e) => {
      console.error(e);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setInventory = useCallback(
    async (updater: Inventory | ((prev: Inventory) => Inventory)) => {
      const next = dedupeInventory(typeof updater === "function" ? (updater as any)(_setInventory) : updater);
      _setInventory(next);
      if (orgId) await writeAppState(orgId, POS_INV_KEY, next);
    },
    [orgId]
  );

  const createOrder = useCallback(
    async (cart: CartItem[] = [], totalFromUI?: number, extra?: { paymentMethod?: string }) => {
      if (!orgId) return null;
      if (!Array.isArray(cart) || cart.length === 0) return null;

      // 先檢查庫存
      const calcDeductKg = (it: CartItem) => {
        if (typeof it.deductKg !== "undefined") return Math.max(0, Number(it.deductKg) || 0);
        if (it.category === "drinks") {
          return Math.max(0, (Number((it as any).usagePerCup) || 0.02) * (Number(it.qty) || 0));
        }
        const grams = Number(it.grams) || 0;
        return Math.max(0, (grams * (Number(it.qty) || 0)) / 1000);
      };

      const nextInv = deepClone(inventory);
      for (const it of cart) {
        const d = calcDeductKg(it);
        const mutate = (arr: any[]) =>
          arr.map((p) => (p.id === it.id ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - d) } : p));
        if (it.category === "drinks") {
          const key = it.subKey as DrinkSubKey;
          nextInv.store.drinks[key] = mutate(nextInv.store.drinks[key] || []);
        } else {
          nextInv.store.HandDrip = mutate(nextInv.store.HandDrip || []);
        }
      }

      const items = cart.map(({ id, name, qty, price, grams, category, subKey }) => ({
        id,
        name,
        qty,
        price,
        grams: grams ?? null,
        category,
        subKey: subKey ?? null
      }));
      const total =
        typeof totalFromUI === "number"
          ? totalFromUI
          : items.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 0), 0);

      const order: Order = {
        id: newId(),
        createdAt: new Date().toISOString(),
        items,
        total,
        paymentMethod: extra?.paymentMethod,
        voided: false
      };

      const nextOrders = [order, ...orders];

      // 一次 upsert 兩筆 app_state（idempotent）
      await supabase.from("app_state").upsert(
        [
          { org_id: orgId, key: POS_INV_KEY, value: nextInv },
          { org_id: orgId, key: POS_ORD_KEY, value: nextOrders }
        ],
        { onConflict: "org_id,key" }
      );

      _setInventory(nextInv);
      setOrders(nextOrders);
      return order.id;
    },
    [orgId, inventory, orders]
  );

  const voidOrder = useCallback(
    async (orderId: string, opt?: { restock?: boolean; reason?: string }) => {
      if (!orgId) return;
      const now = new Date().toISOString();
      let nextInv = deepClone(inventory);
      const nextOrders = orders.map((o) =>
        o.id === orderId ? { ...o, voided: true, voidedAt: now, voidReason: opt?.reason ?? "" } : o
      );

      if (opt?.restock) {
        const target = orders.find((o) => o.id === orderId);
        if (target) {
          for (const it of target.items || []) {
            const perUnit =
              it.category === "drinks" ? ((it as any).usagePerCup || 0.02) : ((Number(it.grams) || 0) / 1000);
            const d = perUnit * (Number((it as any).qty) || 0);
            const mapOne = (p: any) => (p.id === it.id ? { ...p, stock: (Number(p.stock) || 0) + d } : p);
            if (it.category === "drinks") {
              const key = it.subKey as DrinkSubKey;
              nextInv.store.drinks[key] = (nextInv.store.drinks[key] || []).map(mapOne);
            } else {
              nextInv.store.HandDrip = (nextInv.store.HandDrip || []).map(mapOne);
            }
          }
        }
      }

      await supabase.from("app_state").upsert(
        [
          { org_id: orgId, key: POS_INV_KEY, value: nextInv },
          { org_id: orgId, key: POS_ORD_KEY, value: nextOrders }
        ],
        { onConflict: "org_id,key" }
      );

      _setInventory(nextInv);
      setOrders(nextOrders);
    },
    [orgId, inventory, orders]
  );

  const repairInventory = useCallback(async () => {
    if (!orgId) return;
    const next = dedupeInventory(inventory);
    _setInventory(next);
    await writeAppState(orgId, POS_INV_KEY, next);
  }, [orgId, inventory]);

  const value = useMemo<Ctx>(
    () => ({ ready, orgId, inventory, orders, setInventory, createOrder, voidOrder, repairInventory }),
    [ready, orgId, inventory, orders, setInventory, createOrder, voidOrder, repairInventory]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
