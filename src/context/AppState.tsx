// src/context/AppState.tsx
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
} from "react";
import { supabase } from "../supabaseClient";
import {
  fetchOrders,
  placeOrder,
  voidOrderDB,
  restockByOrder,
  type PlaceOrderItem,
} from "../services/orders";

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

const DEFAULT_INV: Inventory = {
  store: {
    drinks: { espresso: [], singleOrigin: [] },
    HandDrip: [],
  },
};

type CartItem = UIItem & { qty: number; deductKg?: number };

export type Order = {
  id: string;
  createdAt: string;
  items: Array<
    Pick<UIItem, "id" | "name" | "grams" | "category" | "subKey"> & {
      qty: number;
      price: number;
    }
  >;
  total: number;
  paymentMethod?: string;
  voided?: boolean;
  voidedAt?: string | null;
  voidReason?: string | null;
  // 來自 DB 的欄位（Dashboard 會用到）
  isDelivery?: boolean;
  delivery?: any;
  deliveryFee?: number;
};

const POS_INV_KEY = "pos_inventory";
// const POS_ORD_KEY = "pos_orders"; // ✅ 不再使用 app_state 的 orders

type Ctx = {
  ready: boolean;
  orgId: string | null;
  inventory: Inventory;
  orders: Order[];
  setInventory: (
    updater: Inventory | ((prev: Inventory) => Inventory)
  ) => Promise<void>;
  createOrder: (
    cart: CartItem[],
    totalFromUI?: number,
    extra?: { paymentMethod?: string }
  ) => Promise<string | null>;
  voidOrder: (
    orderId: string,
    opt?: { restock?: boolean; reason?: string }
  ) => Promise<void>;
  repairInventory: () => Promise<void>;
  reloadOrders: () => Promise<void>;
};

const AppStateContext = createContext<Ctx | null>(null);
export const useAppState = () => {
  const c = useContext(AppStateContext);
  if (!c) throw new Error("useAppState must be used within AppStateProvider");
  return c;
};

// ====== 小工具 ======
function deepClone<T>(v: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));
}

// 把 Drinks 的 grams 視為 0；HandDrip 用實際 grams，供「去重」用
function keyOf(
  category: Category,
  subKey: DrinkSubKey | null,
  p: Partial<UIItem>
) {
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
      else
        pick.set(
          key,
          (Number(it.stock) || 0) < (Number(kept.stock) || 0) ? it : kept
        );
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
    else
      pick.set(
        key,
        (Number(it.stock) || 0) < (Number(kept.stock) || 0) ? it : kept
      );
  }
  for (const v of pick.values()) beans.push(v);
  next.store.HandDrip = beans;

  return next;
}

// 將 DB 撈回來的任意 shape 規格化成 Inventory（避免 undefined 造成 UI 異常）
function normalizeInventory(raw: any): Inventory {
  if (!raw || typeof raw !== "object") return deepClone(DEFAULT_INV);

  // 新版 shape：{ store: { drinks, HandDrip } }
  if (
    raw.store &&
    typeof raw.store === "object" &&
    raw.store.drinks &&
    raw.store.HandDrip
  ) {
    const drinks = raw.store.drinks || {};
    return {
      store: {
        drinks: {
          espresso: Array.isArray(drinks.espresso) ? drinks.espresso : [],
          singleOrigin: Array.isArray(drinks.singleOrigin) ? drinks.singleOrigin : [],
        },
        HandDrip: Array.isArray(raw.store.HandDrip) ? raw.store.HandDrip : [],
      },
    };
  }

  // 舊版 shape：{ drinks: {...}, HandDrip: [...] }
  const drinks = (raw as any).drinks || {};
  return {
    store: {
      drinks: {
        espresso: Array.isArray(drinks.espresso) ? drinks.espresso : [],
        singleOrigin: Array.isArray(drinks.singleOrigin) ? drinks.singleOrigin : [],
      },
      HandDrip: Array.isArray((raw as any).HandDrip) ? (raw as any).HandDrip : [],
    },
  };
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

async function readAppState<T>(
  orgId: string,
  key: string,
  fallback: T
): Promise<{ value: T; updated_at: string | null }> {
  const { data, error } = await supabase
    .from("app_state")
    .select("state, updated_at")
    .eq("org_id", orgId)
    .eq("key", key)
    .maybeSingle();

  // 404 not found → 視為空
  if (error && (error as any).code !== "PGRST116") throw error;

  if (!data) {
    // 首次建立
    const { error: upErr } = await supabase
      .from("app_state")
      .upsert([{ org_id: orgId, key, state: fallback }]);
    if (upErr) throw upErr;
    return { value: fallback, updated_at: null };
  }

  return {
    value: ((data as any).state as T) ?? fallback,
    updated_at: (data as any).updated_at ?? null,
  };
}

async function writeAppState<T>(orgId: string, key: string, value: T) {
  const { error } = await supabase
    .from("app_state")
    .upsert([{ org_id: orgId, key, state: value }]);
  if (error) throw error;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [inventory, _setInventory] = useState<Inventory>(DEFAULT_INV);
  const [orders, setOrders] = useState<Order[]>([]);
  const invVer = useRef<string | null>(null);

  // 只在 Provider 內定義，所有畫面共用
  const reloadOrders = useCallback(async () => {
    try {
      const { rows } = await fetchOrders({ pageSize: 500, status: "all" });
      setOrders(rows as Order[]);
    } catch (e) {
      console.error("[reloadOrders] failed:", e);
    }
  }, []);

  // 初始載入：inventory 走 app_state；orders 走資料表；加上 Realtime 訂閱
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const org = await getOrgIdForCurrentUser();
        if (!alive) return;
        setOrgId(org);

        // 只從 app_state 取 inventory
        const inv = await readAppState<Inventory>(org, POS_INV_KEY, DEFAULT_INV);
        if (!alive) return;

        const normalizedInv = normalizeInventory(inv.value);
        invVer.current = inv.updated_at;
        _setInventory(dedupeInventory(normalizedInv));

        // 一進來就從 DB 抓 orders
        await reloadOrders();

        setReady(true);

        // Realtime：app_state（inventory）
        const chInv = supabase
          .channel(`app_state_${org}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "app_state", filter: `org_id=eq.${org}` },
            (payload) => {
              const row = payload.new as any;
              if (!row) return;
              if (row.key === POS_INV_KEY) {
                invVer.current = row.updated_at;
                _setInventory(dedupeInventory(normalizeInventory(row.state)));
              }
              // ❌ 不再處理 POS_ORD_KEY，避免覆蓋 DB orders
            }
          )
          .subscribe();

        // Realtime：orders / order_items 有異動就刷新
        const chOrders = supabase
          .channel("orders_realtime")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "orders" },
            () => reloadOrders()
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "order_items" },
            () => reloadOrders()
          )
          .subscribe();

        return () => {
          supabase.removeChannel(chInv);
          supabase.removeChannel(chOrders);
        };
      } catch (e) {
        console.error(e);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadOrders]);

  const setInventory = useCallback(
    async (updater: Inventory | ((prev: Inventory) => Inventory)) => {
      const next = dedupeInventory(
        typeof updater === "function"
          ? (updater as (prev: Inventory) => Inventory)(inventory)
          : updater
      );
      _setInventory(next);
      if (orgId) await writeAppState(orgId, POS_INV_KEY, next);
    },
    [orgId, inventory]
  );

  // 相容用：把門市 createOrder 轉為呼叫 DB placeOrder（不要再寫 app_state）
  const createOrder = useCallback(
    async (
      cart: CartItem[] = [],
      _totalFromUI?: number,
      extra?: { paymentMethod?: string }
    ) => {
      if (!Array.isArray(cart) || cart.length === 0) return null;

      const items: PlaceOrderItem[] = cart.map((it) => {
        const isDrink = it.category === "drinks";
        return {
          name: it.name,
          sku: isDrink
            ? `${it.id}-${(it as any).subKey ?? ""}`
            : `${it.id}-${(it as any).grams ?? 0}g`,
          qty: it.qty,
          price: (it as any).price || 30,
          category: isDrink ? "drinks" : "HandDrip",
          sub_key: isDrink ? ((it as any).subKey as any) : undefined,
          grams: isDrink ? undefined : Number((it as any).grams ?? 0) || undefined,
        };
      });

      const id = await placeOrder(items, extra?.paymentMethod || "Cash", "ACTIVE");
      await reloadOrders();
      return id;
    },
    [reloadOrders]
  );

  // 作廢走 DB；（可選）回補庫存再自己實作
  const voidOrder = useCallback(
    async (orderId: string, opt?: { restock?: boolean; reason?: string }) => {
      await voidOrderDB(orderId, { reason: opt?.reason });
      if (opt?.restock) {
        try { await restockByOrder(orderId); } catch {}
      }
      await reloadOrders();
    },
    [reloadOrders]
  );

  const repairInventory = useCallback(async () => {
    if (!orgId) return;
    const next = dedupeInventory(inventory);
    _setInventory(next);
    await writeAppState(orgId, POS_INV_KEY, next);
  }, [orgId, inventory]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      orgId,
      inventory,
      orders,
      setInventory,
      createOrder,
      voidOrder,
      repairInventory,
      reloadOrders,
    }),
    [ready, orgId, inventory, orders, setInventory, createOrder, voidOrder, repairInventory, reloadOrders]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export default AppStateProvider;
