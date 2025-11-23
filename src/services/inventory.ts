// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** 直接從 v_inventory 取回的列 */
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

/** 前端 UI 期望的結構（與 AppState 相容） */
export type UIItem = {
  id: string;
  name: string;
  price: number;
  stock: number;
  unit: "kg";
  // drinks only
  usagePerCup?: number;
  // beans only
  grams?: number;
};

export type UIInventory = {
  store: {
    drinks: {
      espresso: UIItem[];
      singleOrigin: UIItem[];
    };
    HandDrip: UIItem[];
  };
};

/** 讀 v_inventory */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []) as InventoryRow[];
}

/** rows -> UIInventory（與 AppState 兼容） */
export function rowsToUIInventory(rows: InventoryRow[]): UIInventory {
  const espresso: UIItem[] = [];
  const singleOrigin: UIItem[] = [];
  const beans: UIItem[] = [];

  for (const r of rows) {
    if (r.category === "drinks") {
      const item: UIItem = {
        id: r.sku,
        name: r.name,
        price: Number(r.price ?? 0),
        stock: Number(r.stock_kg ?? 0),
        unit: "kg",
        usagePerCup: Number(r.usage_per_cup ?? 0.02),
      };
      if (r.sub_key === "espresso") espresso.push(item);
      else singleOrigin.push(item);
    } else {
      beans.push({
        id: r.sku,
        name: r.name,
        price: Number(r.price ?? 0),
        grams: Number(r.grams ?? 0),
        stock: Number(r.stock_kg ?? 0),
        unit: "kg",
      });
    }
  }
  return { store: { drinks: { espresso, singleOrigin }, HandDrip: beans } };
}

/** 新增/更新商品（單一 RPC，避免 overload） */
export async function upsertProduct(input: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_product_unified", {
    p_sku: input.sku,
    p_name: input.name,
    p_category: input.category,
    p_sub_key: input.sub_key ?? null,
    p_grams: input.grams ?? null,
    p_usage_per_cup: input.usage_per_cup ?? null,
    p_price: input.price,
  });
  if (error) throw error;
  return (data as string) ?? input.sku;
}

/** 刪除商品（直接刪 products.sku） */
export async function deleteProduct(sku: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("sku", sku);
  if (error) throw error;
}

/** Beans 改克數（使用 v2，若不存在再退回舊名） */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  name: string;
  price: number;
  oldStockKg: number;
  newGrams: number;
}): Promise<string> {
  let res = await supabase.rpc("change_bean_pack_size_safe_v2", {
    p_old_sku: args.oldSku,
    p_name: args.name,
    p_price: args.price,
    p_old_stock_kg: args.oldStockKg,
    p_new_grams: args.newGrams,
  });
  if (res.error && res.error.code === "PGRST116") {
    // 若 v2 不存在，退回舊名（但前面 SQL 已清理 overload）
    res = await supabase.rpc("change_bean_pack_size_safe", {
      p_old_sku: args.oldSku,
      p_name: args.name,
      p_price: args.price,
      p_old_stock_kg: args.oldStockKg,
      p_new_grams: args.newGrams,
    });
  }
  if (res.error) throw res.error;
  return (res.data as string) ?? "";
}
export async function updateStockKgBySku(sku: string, newStockKg: number): Promise<number> {
  const value = Number.isFinite(newStockKg) ? Number(newStockKg) : 0;

  const { data, error } = await supabase
    .from("products")
    .update({
      stock_kg: value,
      updated_at: new Date().toISOString(),
    })
    .eq("sku", sku)
    .select("stock_kg")
    .maybeSingle();

  if (error) throw error;
  return Number(data?.stock_kg ?? value);
}