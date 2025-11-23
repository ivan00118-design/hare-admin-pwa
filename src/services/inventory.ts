// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** === DB 行資料（對應 v_inventory）=== */
export type InventoryRow = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number;
  stock_kg: number | null;
};

/** === 讀取 v_inventory === */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg")
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

/** === 將 v_inventory 轉為 AppState 需要的結構（含 unit）=== */
export function rowsToUIInventory(rows: InventoryRow[]): any {
  const drinks = { espresso: [] as any[], singleOrigin: [] as any[] };
  const beans: any[] = [];

  for (const r of rows) {
    if (r.category === "drinks") {
      const item = {
        id: r.sku,
        name: r.name,
        category: "drinks",
        subKey: r.sub_key,
        usagePerCup: Number(r.usage_per_cup ?? 0.02),
        price: Number(r.price) || 0,
        stock: Number(r.stock_kg) || 0,
        unit: "cup", // <== 供 AppState 型別檢查
      };
      if (r.sub_key === "espresso") drinks.espresso.push(item);
      else drinks.singleOrigin.push(item);
    } else {
      beans.push({
        id: r.sku,
        name: r.name,
        category: "HandDrip",
        grams: Number(r.grams) || 0,
        price: Number(r.price) || 0,
        stock: Number(r.stock_kg) || 0,
        unit: "g", // <== 供 AppState 型別檢查
      });
    }
  }

  return { store: { drinks, HandDrip: beans } };
}

/** === Product Upsert：單一 RPC 版本（避免 overloading）=== */
export async function upsertProduct(args: {
  sku: string; name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price: number;
}) {
  const payload = {
    p_sku: args.sku,
    p_name: args.name,
    p_category: args.category,
    p_sub_key: args.sub_key ?? null,
    p_grams: args.grams ?? null,
    p_usage_per_cup: args.usage_per_cup ?? null,
    p_price: args.price,
  };
  const { data, error } = await supabase.rpc("upsert_product", payload);
  if (error) throw error;
  return data as string; // 回傳 sku
}

/** === 刪除 Product（優先 RPC，Fallback 直刪 products）=== */
export async function deleteProduct(sku: string) {
  const rpc = await supabase.rpc("delete_product", { p_sku: sku });
  if (!rpc.error) return;
  const res = await supabase.from("products").delete().eq("sku", sku);
  if (res.error) throw res.error;
}

/** === Beans 安全變更克數（建立新 SKU / 刪舊 SKU 等細節交給 DB）=== */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string; name: string; price: number; oldStockKg: number; newGrams: number;
}) {
  const { data, error } = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: args.oldSku,
    p_name: args.name,
    p_price: args.price,
    p_old_stock_kg: args.oldStockKg,
    p_new_grams: args.newGrams,
  });
  if (error) throw error;
  return data as string; // new sku
}

/** === 存量總覽（v_stock_totals）=== */
export type StockTotals = {
  totalKg: number;
  drinksKg: number;
  beansKg: number;
  espressoKg: number;
  singleOriginKg: number;
};

export async function fetchStockTotals(): Promise<StockTotals> {
  const { data, error } = await supabase.from("v_stock_totals").select("*").maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as any;
  return {
    totalKg: Number(row.total_kg) || 0,
    drinksKg: Number(row.drinks_kg) || 0,
    beansKg: Number(row.beans_kg) || 0,
    espressoKg: Number(row.espresso_kg) || 0,
    singleOriginKg: Number(row.single_origin_kg) || 0,
  };
}
