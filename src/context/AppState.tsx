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
  type PlaceOrderItem,
} from "../services/orders";

import {
  fetchInventoryRows,
  rowsToUIInventory,
} from "../services/inventory";

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
  isDelivery?: boolean;
  delivery?: any;
  deliveryFee?: number;
};

type Ctx = {
  ready: boolean;
  orgId: string | null;
  inventory: Inventory;
  orders: Order[];
  setInventory: (
    updater: Inventory | ((prev: Inventory) => Inventory)
  ) => Promise<void>;
  reloadInventory: () => Promise<void>;
  createOrder: (
    cart: CartItem[],
    totalFromUI?: number,
    extra?: { paymentMethod?: string }
  ) => Promise<string | null>;
  voidOrder: (
    orderId: string,
    opt?: { restock?: boolean; reason?: string }
  ) => Promise<void>;
  repairInventory: () => Promise<void>; // 現在僅做去重 & 本地校正
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
      else pick.set(
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
    else pick.set(
      key,
      (Number(it.stock) || 0) < (Number(kept.stock) || 0) ? it : kept
    );
  }
  for (const v of pick.values()) beans.push(v);
  next.store.HandDrip = beans;

  return next;
}

// ====== 本地 fallback：嘗試呼叫 DB 的 restock_by_order RPC（若無則忽略） ======
async function tryRestockByOrder(orderId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc("restock_by_order", {
      p_order_id: orderId,
    });
    if (error) throw error;
  } catch {
    // 若沒有此 RPC 或權限不足，忽略即可（避免前端報錯）
  }
}

// ====== Provider ======
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [inventory, _setInventory] = useState<Inventory>(DEFAULT_INV);
  const [orders, setOrders] = useState<Order[]>([]);
  const invVer = useRef<string | null>(null);

  // ---- 由 DB 讀取 Inventory（不再使用 app_state） ----
  const reloadInventory = useCallback(async () => {
    const rows = await fetchInventoryRows();
    const ui = rowsToUIInventory(rows); // 型別交由推論，不依賴外部別名
    // 對齊舊 UI 型別
    const normalized: Inventory = {
      store: {
        drinks: {
          espresso: (ui.store.drinks.espresso || []) as any,
          singleOrigin: (ui.store.drinks.singleOrigin || []) as any,
        },
        HandDrip: (ui.store.HandDrip || []) as any,
      },
    };
    _setInventory(dedupeInventory(normalized));
  }, []);

  // Orders（沿用你的 DB 版 services）
  const reloadOrders = useCallback(async () => {
    try {
      const { rows } = await fetchOrders({ pageSize: 500, status: "all" });
      setOrders(rows as Order[]);
    } catch (e) {
      console.error("[reloadOrders] failed:", e);
    }
  }, []);

  // 初始載入 + Realtime 訂閱
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 若你的系統需要 org，保留這段；不需要可移除
        try {
          const { data: auth } = await supabase.auth.getUser();
          const uid = auth.user?.id;
          if (uid) {
            const { data, error } = await supabase
              .from("employees")
              .select("org_id")
              .eq("user_id", uid)
              .limit(1)
              .maybeSingle();
            if (!error) setOrgId((data as any)?.org_id ?? null);
          }
        } catch { /* noop */ }

        await reloadInventory();
        await reloadOrders();
        setReady(true);

        // Realtime：只要 product_catalog / inventory_movements 有異動就重抓 inventory
        const chInv = supabase
          .channel("inventory_realtime")
          .on("postgres_changes",
            { event: "*", schema: "public", table: "product_catalog" },
            () => reloadInventory()
          )
          .on("postgres_changes",
            { event: "*", schema: "public", table: "inventory_movements" },
            () => reloadInventory()
          )
          .subscribe();

        // Realtime：orders / order_items
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
  }, [reloadInventory, reloadOrders]);

  // 僅本地更新（持久化請用 RPC）
  const setInventory = useCallback(
    async (updater: Inventory | ((prev: Inventory) => Inventory)) => {
      const next = dedupeInventory(
        typeof updater === "function"
          ? (updater as (prev: Inventory) => Inventory)(inventory)
          : updater
      );
      _setInventory(next);
    },
    [inventory]
  );

  // 相容門市下單：走 DB placeOrder（不再寫 app_state）
  const createOrder = useCallback(
  async (
    cart: CartItem[] = [],
    _totalFromUI?: number,
    extra?: { paymentMethod?: string }
  ) => {
    if (!Array.isArray(cart) || cart.length === 0) return null;

    const items: PlaceOrderItem[] = cart.map((it) => {
      const isDrink = it.category === "drinks";
      const sku = String(it.id || "");               // ✅ 直接用 id = sku

      return {
        name: it.name,
        sku,
        qty: it.qty,
        price: (it as any).price || 30,
        category: isDrink ? "drinks" : "HandDrip",
        sub_key: isDrink ? ((it as any).subKey as any) : undefined,
        grams: isDrink ? undefined : Number((it as any).grams ?? 0) || undefined,
      };
    });

    const id = await placeOrder(items, extra?.paymentMethod || "Cash", "ACTIVE");

    // ✅ 下單後，同步更新訂單列表 + 庫存
    await Promise.all([reloadOrders(), reloadInventory()]);

    return id;
  },
  [reloadOrders, reloadInventory] // ✅ 記得把 reloadInventory 加進依賴
);

  // 作廢（DB）
  const voidOrder = useCallback(
    async (orderId: string, opt?: { restock?: boolean; reason?: string }) => {
      await voidOrderDB(orderId, { reason: opt?.reason });
      if (opt?.restock) {
        await tryRestockByOrder(orderId); // 本地 fallback；有 RPC 則會執行，否則忽略
      }
      await reloadOrders();
    },
    [reloadOrders]
  );

  // 現在僅做去重 & 本地校正
  const repairInventory = useCallback(async () => {
    const next = dedupeInventory(inventory);
    _setInventory(next);
  }, [inventory]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      orgId,
      inventory,
      orders,
      setInventory,
      reloadInventory,
      createOrder,
      voidOrder,
      repairInventory,
    }),
    [ready, orgId, inventory, orders, setInventory, reloadInventory, createOrder, voidOrder, repairInventory]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export default AppStateProvider;
