// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** DB rows (v_inventory) */
export type InventoryRow = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number;
  stock_kg: number;
};

/** 讀取 v_inventory */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

/** 上/改品項：統一呼叫 upsert_product_unified（避免 PGRST203） */
export async function upsertProduct(args: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_product_unified", {
    p_sku: args.sku,
    p_name: args.name,
    p_category: args.category,
    p_sub_key: args.sub_key ?? null,
    p_grams: args.grams ?? null,
    p_usage_per_cup: args.usage_per_cup ?? null,
    p_price: args.price ?? 0,
  });
  if (error) throw error;
  return data as string;
}

/** 刪除單一 SKU */
export async function deleteProduct(sku: string): Promise<void> {
  const { error } = await supabase.rpc("delete_product", { p_sku: sku });
  if (error) throw error;
}

/** Beans 換包裝克數（安全流程） */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  name: string;
  price: number;
  oldStockKg?: number; // 可選，DB 端會沿用舊 SKU 的 stock_kg
  newGrams: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: args.oldSku,
    p_name: args.name,
    p_price: args.price,
    p_old_stock_kg: args.oldStockKg ?? 0,
    p_new_grams: args.newGrams,
  });
  if (error) throw error;
  return data as string; // 回傳 new SKU
}

/** 若你需要把 DB rows 轉成 UI inventory，可在這裡做（選用） */
export function rowsToUIInventory(rows: InventoryRow[]) {
  // 依你 AppState 設計自行映射；這裡回傳簡單分組供參考
  const drinks = {
    espresso: [] as any[],
    singleOrigin: [] as any[],
  };
  const HandDrip: any[] = [];

  for (const r of rows) {
    const base = {
      id: r.sku,
      name: r.name,
      price: Number(r.price) || 0,
      stock: Number(r.stock_kg) || 0,
    };
    if (r.category === "drinks") {
      const it = { ...base, usagePerCup: Number(r.usage_per_cup) || 0.02 };
      if (r.sub_key === "espresso") drinks.espresso.push(it);
      else drinks.singleOrigin.push(it);
    } else {
      HandDrip.push({ ...base, grams: r.grams || 0 });
    }
  }
  return { store: { drinks, HandDrip } };
}
