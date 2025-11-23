// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** v_inventory 行型別（請確保 DB view 欄位齊全：sku/name/category/sub_key/grams/usage_per_cup/price/stock_kg） */
export type InventoryRow = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number;
  stock_kg: number; // 由 view 以 coalesce(...) 保證為 number
};

/** 從 v_inventory 取清單（依 name 排序） */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    sku: r.sku,
    name: r.name,
    category: r.category,
    sub_key: r.sub_key,
    grams: r.grams,
    usage_per_cup: r.usage_per_cup,
    price: Number(r.price || 0),
    stock_kg: Number(r.stock_kg || 0),
  }));
}

/** UI 需要的分組結構（若保留原有 AppState，可用此把 rows 映射成前端使用的型態） */
export function rowsToUIInventory(rows: InventoryRow[]) {
  const drinks = { espresso: [] as any[], singleOrigin: [] as any[] };
  const beans: any[] = [];
  for (const r of rows) {
    const base = {
      id: r.sku,
      name: r.name,
      price: r.price,
      stock: r.stock_kg,     // 顯示每品項庫存
      grams: r.grams,
      usagePerCup: r.usage_per_cup,
    };
    if (r.category === "drinks") {
      if (r.sub_key === "singleOrigin") drinks.singleOrigin.push(base);
      else drinks.espresso.push(base);
    } else {
      beans.push(base);
    }
  }
  return { store: { drinks, HandDrip: beans } };
}

/** 庫存總覽（對接 v_stock_totals；全部回傳 number） */
export type StockTotals = {
  totalKg: number;
  drinksKg: number;
  beansKg: number;
  espressoKg: number;
  singleOriginKg: number;
};
export async function fetchStockTotals(): Promise<StockTotals> {
  const { data, error } = await supabase
    .from("v_stock_totals")
    .select("total_kg,drinks_kg,beans_kg,espresso_kg,single_origin_kg")
    .maybeSingle();
  if (error) throw error;

  return {
    totalKg: Number((data as any)?.total_kg || 0),
    drinksKg: Number((data as any)?.drinks_kg || 0),
    beansKg: Number((data as any)?.beans_kg || 0),
    espressoKg: Number((data as any)?.espresso_kg || 0),
    singleOriginKg: Number((data as any)?.single_origin_kg || 0),
  };
}

/** 單一 upsert（避免 overloading；對應 SQL 的 public.upsert_product(...)） */
export async function upsertProduct(args: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price: number;
}): Promise<string> {
  const { sku, name, category, sub_key = null, grams = null, usage_per_cup = null, price } = args;
  const { data, error } = await supabase.rpc("upsert_product", {
    p_sku: sku,
    p_name: name,
    p_category: category,
    p_sub_key: sub_key,
    p_grams: grams,
    p_usage_per_cup: usage_per_cup,
    p_price: price,
  });
  if (error) throw error;
  return (data as string) || sku;
}

/** 刪產品（對應 SQL public.delete_product） */
export async function deleteProduct(sku: string): Promise<void> {
  const { error } = await supabase.rpc("delete_product", { p_sku: sku });
  if (error) throw error;
}

/** Beans 安全變更克數（對應 SQL public.change_bean_pack_size_safe） */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string; name: string; price: number; oldStockKg: number; newGrams: number;
}): Promise<string> {
  const { oldSku, name, price, oldStockKg, newGrams } = args;
  const { data, error } = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: oldSku,
    p_name: name,
    p_price: price,
    p_old_stock_kg: oldStockKg,
    p_new_grams: newGrams,
  });
  if (error) throw error;
  return data as string;
}
