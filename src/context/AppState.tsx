// src/context/AppState.tsx
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
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

// DB 版 inventory 服務
import {
  fetchInventoryRows,
  rowsToUIInventory,
} from "../services/inventory";

// ====== 型別 ======
export type Category = "drinks" | "HandDrip";
export type DrinkSubKey = "espresso" | "singleOrigin";

export type DrinkProduct = {
  id: string;            // ⚠ 現在以 sku 作為 id
  name: string;
  price: number;
  usagePerCup: number;   // 每杯扣的公斤數
  stock: number;         // 庫存公斤數
  unit: "kg";
};

export type BeanProduct = {
  id: string;            // ⚠ 現在以 sku 作為 id
  name: string;
  price: number;
  grams: number;         // 包裝克數：100 / 250 / 500 / 1000
  stock: number;         // 庫存公斤數（總量，以 kg）
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
  reloadInventory: () => Promise<void>;
};

const AppStateContext = createContext<Ctx | null>(null);
export const useAppState = () => {
  const c = useContext(AppStateContext);
  if (!c) throw new Error("useAppState must be used within AppStateProvider");
  return c;
};

// ====== 小工具 ======
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

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [inventory, _setInventory] = useState<Inventory>(DEFAULT_INV);
  const [orders, setOrders] = useState<Order[]>([]);

  // ── Orders：從資料表讀，提供外部可重載 ──────────────────────────
  const reloadOrders = useCallback(async () => {
    try {
      const { rows } = await fetchOrders({ pageSize: 500, status: "all" });
      setOrders(rows as Order[]);
    } catch (e) {
      console.error("[reloadOrders] failed:", e);
    }
  }, []);

  // ── Inventory：從 DB v_inventory 讀，提供外部可重載 ──────────────
  const reloadInventory = useCallback(async () => {
    try {
      const rows = await fetchInventoryRows();
      _setInventory(rowsToUIInventory(rows));
    } catch (e) {
      console.error("[reloadInventory] failed:", e);
    }
  }, []);

  // ── 初始化：取得 org → 載入 inventory & orders → 建立 Realtime ────
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const org = await getOrgIdForCurrentUser();
        if (!alive) return;
        setOrgId(org);

        // 先拉 inventory（DB）
        await reloadInventory();
        // 再拉 orders（DB）
        await reloadOrders();

        setReady(true);

        // Realtime：商品/庫存異動即刷新
        const chInv = supabase
          .channel("inv_realtime")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "product_catalog" },
            () => reloadInventory()
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "product_inventory" },
            () => reloadInventory()
          )
          .subscribe();

        // Realtime：訂單/明細異動即刷新
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

  // ── setInventory：暫時只更新前端狀態（不落 DB） ───────────────────
  // 之後請把 UI 編輯改為呼叫 upsertProduct / adjustStock，完全 DB 化。
  const setInventory = useCallback(
    async (updater: Inventory | ((prev: Inventory) => Inventory)) => {
      const next =
        typeof updater === "function"
          ? (updater as (prev: Inventory) => Inventory)(inventory)
          : updater;
      _setInventory(next);
      // 不再 write app_state；若要永久保存請改用 services/inventory 的 RPC
    },
    [inventory]
  );

  // ── 下單：送 RPC，完成後刷新 orders（DB 負責扣庫存） ───────────────
  const createOrder = useCallback(
    async (
      cart: CartItem[] = [],
      _totalFromUI?: number,
      extra?: { paymentMethod?: string }
    ) => {
      if (!Array.isArray(cart) || cart.length === 0) return null;

      // 注意：現在 UI item.id 就是 sku
      const items: PlaceOrderItem[] = cart.map((it) => {
        const isDrink = it.category === "drinks";
        return {
          name: it.name,
          sku: String(it.id), // ⬅ 直接用 sku，不再自行拼接
          qty: it.qty,
          price: (it as any).price || 30,
          category: isDrink ? "drinks" : "HandDrip",
          sub_key: isDrink ? ((it as any).subKey as any) : undefined,
          grams: isDrink ? undefined : Number((it as any).grams ?? 0) || undefined,
        };
      });

      const id = await placeOrder(items, extra?.paymentMethod || "Cash", "ACTIVE");
      await reloadOrders();
      // 若希望下單後 UI 立即看到庫存變動，可等 Realtime；或手動：
      // await reloadInventory();
      return id;
    },
    [reloadOrders]
  );

  // ── 作廢：RPC（可選回補），完成後刷新 ───────────────────────────────
  const voidOrder = useCallback(
    async (orderId: string, opt?: { restock?: boolean; reason?: string }) => {
      await voidOrderDB(orderId, { reason: opt?.reason, restock: !!opt?.restock });
      if (opt?.restock) {
        try { await restockByOrder(orderId); } catch { /* 可忽略 */ }
      }
      await reloadOrders();
      // 同理需要的話可同步刷新庫存
      // await reloadInventory();
    },
    [reloadOrders]
  );

  // ── repairInventory：完全 DB 化後改為「重新讀庫存」 ────────────────
  const repairInventory = useCallback(async () => {
    await reloadInventory();
  }, [reloadInventory]);

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
      reloadInventory,
    }),
    [
      ready,
      orgId,
      inventory,
      orders,
      setInventory,
      createOrder,
      voidOrder,
      repairInventory,
      reloadOrders,
      reloadInventory,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export default AppStateProvider;
