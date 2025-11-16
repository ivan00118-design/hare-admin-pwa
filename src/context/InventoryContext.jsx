// src/context/InventoryContext.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../supabaseClient";

/** ========= 初始結構 ========= */
const INITIAL_INVENTORY = {
  store: {
    drinks: {
      espresso: [],
      singleOrigin: [],
    },
    HandDrip: [], // Coffee Beans（以 grams 規格區分）
  },
};

/** ========= 去重工具 ========= */
// 統一鍵：Drinks 將 grams 視為 0；HandDrip 用實際 grams
const keyOfProduct = (category, subKey, p) => {
  const name = (p?.name || "").trim().toLowerCase();
  const grams = category === "drinks" ? 0 : Number(p?.grams || 0);
  return `${category}|${subKey || ""}|${name}|${grams}`;
};

/** 對單一清單做去重：同鍵只保留「庫存較低」那筆（通常是已扣庫存的正確項） */
const dedupeList = (category, subKey, list = []) => {
  const pick = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const k = keyOfProduct(category, subKey, item);
    const kept = pick.get(k);
    if (!kept) {
      pick.set(k, item);
    } else {
      const a = Number(kept.stock) || 0;
      const b = Number(item.stock) || 0;
      // 保留庫存較低的
      pick.set(k, b < a ? item : kept);
    }
  }
  return Array.from(pick.values());
};

/** 對整份 inventory 結構做去重（不變性返回） */
const normalizeInventory = (inv) => {
  if (!inv?.store) return inv;
  const drinks = inv.store.drinks || {};
  return {
    ...inv,
    store: {
      ...inv.store,
      drinks: {
        ...drinks,
        espresso: dedupeList("drinks", "espresso", drinks.espresso || []),
        singleOrigin: dedupeList("drinks", "singleOrigin", drinks.singleOrigin || []),
      },
      HandDrip: dedupeList("HandDrip", null, inv.store.HandDrip || []),
    },
  };
};

/** ========= Supabase 輔助 ========= */
const getOrgIdFromSession = async () => {
  const { data } = await supabase.auth.getUser();
  const meta = data?.user?.user_metadata || {};
  // 若 metadata 沒有 org，退回前端 .env
  return meta.org_id || meta.orgId || import.meta.env.VITE_DEFAULT_ORG_ID || null;
};

const loadRemote = async (orgId, key) => {
  if (!orgId) return null;
  const { data, error } = await supabase
    .from("app_state")
    .select("value")
    .eq("org_id", orgId)
    .eq("key", key)
    .single();
  if (error) return null;
  return data?.value ?? null;
};

const saveRemote = async (orgId, key, value) => {
  if (!orgId) return;
  await supabase
    .from("app_state")
    .upsert(
      { org_id: orgId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "org_id,key" }
    );
};

/** ========= Context ========= */
const InventoryContext = createContext({
  inventory: INITIAL_INVENTORY,
  setInventory: () => {},
  addProduct: () => {},
  deleteProduct: () => {},
  sellItem: () => {},
  repairInventory: () => {},
  // 訂單
  orders: [],
  createOrder: () => null,
  voidOrder: () => {},
  restoreOrder: () => {},
});

export const useInventory = () => useContext(InventoryContext);

/** ========= Provider ========= */
export function InventoryProvider({ children }) {
  // 本地狀態（初始化先給預設，等載入完再覆蓋）
  const [inventory, _setInventory] = useState(INITIAL_INVENTORY);
  const [orders, setOrders] = useState([]);
  const [orgId, setOrgId] = useState(null);

  /** 取得 orgId 後，從雲端覆蓋（沒有雲端就用本地並寫回雲端） */
  useEffect(() => {
    (async () => setOrgId(await getOrgIdFromSession()))();
  }, []);

  // Inventory
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const cloudInv = await loadRemote(orgId, "pos_inventory");
      if (cloudInv) {
        _setInventory(normalizeInventory(cloudInv));
      } else {
        const raw = typeof window !== "undefined" ? window.localStorage.getItem("pos_inventory") : null;
        const localInv = raw ? normalizeInventory(JSON.parse(raw)) : INITIAL_INVENTORY;
        _setInventory(localInv);
        await saveRemote(orgId, "pos_inventory", localInv);
      }
    })();
  }, [orgId]);

  // Orders
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const cloud = await loadRemote(orgId, "pos_orders");
      if (Array.isArray(cloud)) {
        setOrders(cloud);
      } else {
        const raw = typeof window !== "undefined" ? window.localStorage.getItem("pos_orders") : null;
        const localOrders = raw ? JSON.parse(raw) : [];
        setOrders(localOrders);
        await saveRemote(orgId, "pos_orders", localOrders);
      }
    })();
  }, [orgId]);

  /** 本地持久化 + 寫回雲端 */
  useEffect(() => {
    try { window?.localStorage?.setItem("pos_inventory", JSON.stringify(inventory)); } catch {}
    if (orgId) saveRemote(orgId, "pos_inventory", inventory);
  }, [inventory, orgId]);

  useEffect(() => {
    try { window?.localStorage?.setItem("pos_orders", JSON.stringify(orders)); } catch {}
    if (orgId) saveRemote(orgId, "pos_orders", orders);
  }, [orders, orgId]);

  /** Realtime：別的視窗/裝置更新後即時同步 */
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`app_state:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_state", filter: `org_id=eq.${orgId}` },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row) return;
          if (payload.new && row.key === "pos_inventory") {
            _setInventory(normalizeInventory(payload.new.value));
          }
          if (payload.new && row.key === "pos_orders") {
            setOrders(Array.isArray(payload.new.value) ? payload.new.value : []);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]);

  /** ====== 包裝 setInventory：任何 set 都自動去重 ====== */
  const setInventory = useCallback((updaterOrValue) => {
    _setInventory((prev) => {
      const next =
        typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
      return normalizeInventory(next);
    });
  }, []);

  // 啟動時把既有資料做一次清理（避免歷史重覆）
  useEffect(() => { _setInventory((prev) => normalizeInventory(prev)); }, []);

  /** ====== 主要操作：新增 / 刪除 / 扣庫存 ====== */
  const addProduct = useCallback(
    (category, subKey, data) => {
      setInventory((prev) => {
        const name = (data?.name || "").trim();
        if (!name) return prev;

        const currentList =
          category === "drinks"
            ? prev.store?.drinks?.[subKey] || []
            : prev.store?.[category] || [];

        const k = keyOfProduct(category, subKey, { name, grams: data?.grams });
        // 已存在就不新增
        if (currentList.some((p) => keyOfProduct(category, subKey, p) === k)) return prev;

        const newItem = {
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          name,
          stock: Number(data?.stock) || 0,
          price: Number(data?.price) || 0,
          unit: "kg",
          ...(category === "drinks"
            ? { usagePerCup: Number(data?.usagePerCup) || 0.02 }
            : { grams: Number(data?.grams) || 0 }),
        };

        if (category === "drinks") {
          return {
            ...prev,
            store: { ...prev.store, drinks: { ...prev.store.drinks, [subKey]: [...currentList, newItem] } },
          };
        }
        return { ...prev, store: { ...prev.store, [category]: [...currentList, newItem] } };
      });
    },
    [setInventory]
  );

  const deleteProduct = useCallback(
    (category, subKey, id) => {
      setInventory((prev) => {
        const currentList =
          category === "drinks"
            ? prev.store?.drinks?.[subKey] || []
            : prev.store?.[category] || [];
        const nextList = currentList.filter((p) => p.id !== id);
        if (category === "drinks") {
          return { ...prev, store: { ...prev.store, drinks: { ...prev.store.drinks, [subKey]: nextList } } };
        }
        return { ...prev, store: { ...prev.store, [category]: nextList } };
      });
    },
    [setInventory]
  );

  const sellItem = useCallback(
    (category, subKey, id, deductKg) => {
      setInventory((prev) => {
        const d = Math.max(0, Number(deductKg) || 0);
        const mapOne = (item) =>
          item.id === id ? { ...item, stock: Math.max(0, (Number(item.stock) || 0) - d) } : item;

        if (category === "drinks") {
          const list = (prev.store?.drinks?.[subKey] || []).map(mapOne);
          return { ...prev, store: { ...prev.store, drinks: { ...prev.store.drinks, [subKey]: list } } };
        }
        const list = (prev.store?.[category] || []).map(mapOne);
        return { ...prev, store: { ...prev.store, [category]: list } };
      });
    },
    [setInventory]
  );

  /** ====== 訂單：建立 / 作廢 / 還原 ====== */
  const createOrder = useCallback(
    (cart = [], totalFromUI, extra = {}) => {
      if (!Array.isArray(cart) || cart.length === 0) return null;

      const calcDeductKg = (it) => {
        if (typeof it.deductKg !== "undefined") return Math.max(0, Number(it.deductKg) || 0);
        if (it.category === "drinks") return Math.max(0, (Number(it.usagePerCup) || 0.02) * (Number(it.qty) || 0));
        const grams = Number(it.grams) || 0;
        return Math.max(0, (grams * (Number(it.qty) || 0)) / 1000);
      };

      // 庫存檢查
      const lacks = [];
      for (const it of cart) {
        const need = calcDeductKg(it);
        const lists = it.category === "drinks"
          ? (inventory.store?.drinks?.[it.subKey] || [])
          : (inventory.store?.[it.category] || []);
        const found = lists.find((p) => p.id === it.id);
        const stock = Number(found?.stock) || 0;
        if (!found || stock < need) lacks.push(`${it.name} 庫存不足（需要 ${need.toFixed(3)} kg）`);
      }
      if (lacks.length) { alert(lacks.join("\n")); return null; }

      // 一次扣庫存
      setInventory((prev) => {
        const next = { ...prev, store: { ...prev.store, drinks: { ...(prev.store?.drinks || {}) } } };
        for (const it of cart) {
          const d = calcDeductKg(it);
          const mapOne = (item) =>
            item.id === it.id ? { ...item, stock: Math.max(0, (Number(item.stock) || 0) - d) } : item;
          if (it.category === "drinks") {
            const key = it.subKey;
            next.store.drinks[key] = (next.store.drinks[key] || []).map(mapOne);
          } else {
            next.store[it.category] = (next.store[it.category] || []).map(mapOne);
          }
        }
        return next;
      });

      // 記錄訂單
      const items = cart.map(({ id, name, qty, price, grams, category, subKey }) => ({
        id, name, qty, price, grams, category, subKey,
      }));
      const total =
        typeof totalFromUI === "number"
          ? totalFromUI
          : items.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 0), 0);

      const order = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        createdAt: new Date().toISOString(),
        items,
        total,
        paymentMethod: extra?.paymentMethod || null,
        voided: false,
      };
      setOrders((prev) => [order, ...prev]);
      return order.id;
    },
    [inventory, setInventory]
  );

  const voidOrder = useCallback((orderId, opt = {}) => {
    const { restock = false, reason = "" } = opt || {};
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, voided: true, voidReason: reason || undefined, voidedAt: new Date().toISOString() }
          : o
      )
    );
    if (restock) {
      // 回補庫存
      const theOrder = orders.find((o) => o.id === orderId);
      if (theOrder) {
        setInventory((prev) => {
          const next = { ...prev, store: { ...prev.store, drinks: { ...(prev.store?.drinks || {}) } } };
          for (const it of (theOrder.items || [])) {
            const d = it.category === "drinks" ? (it.usagePerCup || 0.02) * (it.qty || 0) : ((it.grams || 0) * (it.qty || 0)) / 1000;
            const addBack = (item) => item.id === it.id ? { ...item, stock: (Number(item.stock) || 0) + d } : item;
            if (it.category === "drinks") {
              const key = it.subKey;
              next.store.drinks[key] = (next.store.drinks[key] || []).map(addBack);
            } else {
              next.store[it.category] = (next.store[it.category] || []).map(addBack);
            }
          }
          return normalizeInventory(next);
        });
      }
    }
  }, [orders, setInventory]);

  const restoreOrder = useCallback((orderId) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, voided: false, voidReason: undefined, voidedAt: undefined } : o)));
  }, []);

  const repairInventory = useCallback(() => {
    setInventory((prev) => normalizeInventory(prev));
  }, [setInventory]);

  /** ========= 輸出 ========= */
  const value = useMemo(
    () => ({
      inventory,
      setInventory,
      addProduct,
      deleteProduct,
      sellItem,
      repairInventory,
      orders,
      createOrder,
      voidOrder,
      restoreOrder,
    }),
    [inventory, setInventory, addProduct, deleteProduct, sellItem, repairInventory, orders, createOrder, voidOrder, restoreOrder]
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}
