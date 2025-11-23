// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** v_inventory 的單列型別 */
export type InventoryRow = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number | null;
  stock_kg: number | null;
};

/** 供前端頁面使用的 UI 形狀（與現有頁面相容） */
export type UIItemLike = {
  id: string;
  name: string;
  price: number;
  category: "drinks" | "HandDrip";
  subKey?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usagePerCup?: number;
  stock?: number;
  unit?: "kg";
};
export type UIInventory = {
  store: {
    drinks: {
      espresso: UIItemLike[];
      singleOrigin: UIItemLike[];
    };
    HandDrip: UIItemLike[];
  };
};

/** 從 view 取清單 */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select(
      "sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg"
    )
    .order("name", { ascending: true });

  if (error) {
    console.error("[fetchInventoryRows] error:", error);
    throw error;
  }
  return (data ?? []) as InventoryRow[];
}

/** 將 v_inventory 轉成頁面需要的 UI 結構 */
export function rowsToUIInventory(rows: InventoryRow[]): UIInventory {
  const out: UIInventory = {
    store: {
      drinks: { espresso: [], singleOrigin: [] },
      HandDrip: [],
    },
  };
  for (const r of rows) {
    const item: UIItemLike = {
      id: r.sku,
      name: r.name,
      price: Number(r.price) || 0,
      category: r.category,
      subKey: r.sub_key ?? null,
      grams: r.grams ?? null,
      usagePerCup: r.usage_per_cup ?? undefined,
      stock: Number(r.stock_kg) || 0,
      unit: "kg",
    };
    if (r.category === "drinks") {
      if (r.sub_key === "espresso") out.store.drinks.espresso.push(item);
      else out.store.drinks.singleOrigin.push(item);
    } else {
      out.store.HandDrip.push(item);
    }
  }
  // 依名稱排序（可自行調整）
  out.store.drinks.espresso.sort((a, b) => a.name.localeCompare(b.name));
  out.store.drinks.singleOrigin.sort((a, b) => a.name.localeCompare(b.name));
  out.store.HandDrip.sort((a, b) =>
    a.name === b.name
      ? (Number(a.grams || 0) - Number(b.grams || 0))
      : a.name.localeCompare(b.name)
  );
  return out;
}

/** 新增/更新商品（走單一 RPC，避免 PostgREST overloading） */
export type UpsertProductInput =
  | {
      // drinks
      sku: string;
      name: string;
      category: "drinks";
      sub_key: "espresso" | "singleOrigin";
      usage_per_cup: number;
      price: number;
    }
  | {
      // beans
      sku: string;
      name: string;
      category: "HandDrip";
      grams: number;
      price: number;
    };

export async function upsertProduct(input: UpsertProductInput): Promise<string> {
  const { sku, name, category } = input as any;
  const price = Number((input as any).price) || 0;
  const sub_key = (input as any).sub_key ?? null;
  const grams = (input as any).grams ?? null;
  const usage_per_cup = (input as any).usage_per_cup ?? null;

  const { data, error } = await supabase.rpc("upsert_product_unified", {
    p_sku: sku,
    p_name: name,
    p_category: category,
    p_price: price,             // ★ 非預設參數放在前面（RPC 也如此）
    p_sub_key: sub_key,
    p_grams: grams,
    p_usage_per_cup: usage_per_cup,
  });

  if (error) {
    console.error("[upsertProduct] error:", error);
    throw error;
  }
  return (data as unknown as string) ?? sku;
}

/** 刪除商品（SKU） */
export async function deleteProduct(sku: string): Promise<void> {
  const { error } = await supabase.rpc("delete_product", { p_sku: sku });
  if (error) {
    console.error("[deleteProduct] error:", error);
    throw error;
  }
}

/** 變更豆子包裝克數（建立新 SKU、保留庫存、刪舊 SKU） */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  name: string;
  price: number;
  oldStockKg: number;
  newGrams: number;
}): Promise<string> {
  const { oldSku, name, price, oldStockKg, newGrams } = args;
  const { data, error } = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: oldSku,
    p_name: name,
    p_price: price,
    p_old_stock_kg: oldStockKg,
    p_new_grams: newGrams,
  });
  if (error) {
    console.error("[changeBeanPackSizeSafe] error:", error);
    throw error;
  }
  return (data as unknown as string) ?? "";
}

/** 直接設定庫存（kg） */
export async function setStockKg(sku: string, stockKg: number): Promise<void> {
  const { error } = await supabase.rpc("set_stock_kg", {
    p_sku: sku,
    p_stock_kg: Number(stockKg) || 0,
  });
  if (error) {
    console.error("[setStockKg] error:", error);
    throw error;
  }
}

/** 調整庫存（kg，正負皆可） */
export async function adjustStockKg(sku: string, deltaKg: number): Promise<void> {
  const { error } = await supabase.rpc("adjust_stock_kg", {
    p_sku: sku,
    p_delta_kg: Number(deltaKg) || 0,
  });
  if (error) {
    console.error("[adjustStockKg] error:", error);
    throw error;
  }
}
