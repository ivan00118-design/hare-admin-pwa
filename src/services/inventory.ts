// src/services/inventory.ts
import { supabase } from "../supabaseClient";
export type Category = "drinks" | "HandDrip";
export type DrinkSubKey = "espresso" | "singleOrigin";

export interface InventoryRow {
  sku: string;
  name: string;
  category: Category;
  sub_key: DrinkSubKey | null;
  grams: number | null;
  usage_per_cup: number | null; // kg
  price: number;
  stock_kg: number;             // from v_inventory
}

// ===== 讀取清單 (view) =====
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
    sub_key: r.sub_key ?? null,
    grams: r.grams ?? null,
    usage_per_cup: r.usage_per_cup ?? null,
    price: Number(r.price) || 0,
    stock_kg: Number(r.stock_kg) || 0,
  }));
}

// ===== KPI：Total Stock =====
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

  const d = (data ?? {}) as any;
  return {
    totalKg: Number(d.total_kg) || 0,
    drinksKg: Number(d.drinks_kg) || 0,
    beansKg: Number(d.beans_kg) || 0,
    espressoKg: Number(d.espresso_kg) || 0,
    singleOriginKg: Number(d.single_origin_kg) || 0,
  };
}

// ===== 新增 / 更新商品 (改呼叫不重名的 RPC) =====
export async function upsertProduct(input: {
  sku: string;
  name: string;
  category: Category;
  sub_key?: DrinkSubKey | null;
  usage_per_cup?: number | null; // drinks only (kg)
  grams?: number | null;         // beans only (g)
  price: number;
}) {
  if (input.category === "drinks") {
    const { error } = await supabase.rpc("upsert_product_drink", {
      p_sku: input.sku,
      p_name: input.name,
      p_sub_key: input.sub_key ?? "espresso",
      p_usage_per_cup: Number(input.usage_per_cup ?? 0),
      p_price: Number(input.price || 0),
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.rpc("upsert_product_bean", {
      p_sku: input.sku,
      p_name: input.name,
      p_grams: Number(input.grams ?? 0),
      p_price: Number(input.price || 0),
    });
    if (error) throw error;
  }
}

// ===== 變更豆子包裝克數（新 SKU + 搬庫存 + 停用舊 SKU）=====
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  oldStockKg: number; // 目前舊 SKU 的庫存 (kg)
  name: string;
  price: number;
  newGrams: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: args.oldSku,
    p_old_stock_kg: Number(args.oldStockKg || 0),
    p_name: args.name,
    p_price: Number(args.price || 0),
    p_new_grams: Number(args.newGrams),
  });
  if (error) throw error;
  return String(data); // new sku
}

// ===== 軟刪商品（改為停用 active=false）=====
export async function deleteProduct(sku: string) {
  const { error } = await supabase.from("products").update({ active: false }).eq("sku", sku);
  if (error) throw error;
}

// ===== 將 v_inventory 映射回原本 UI 結構 =====
export function rowsToUIInventory(rows: InventoryRow[]) {
  const drinks = { espresso: [] as any[], singleOrigin: [] as any[] };
  const beans: any[] = [];

  for (const r of rows) {
    const base = {
      id: r.sku,
      name: r.name,
      price: Number(r.price) || 0,
      stock: Number(r.stock_kg) || 0,
    };

    if (r.category === "drinks") {
      const it = { ...base, category: "drinks" as const, subKey: r.sub_key ?? "espresso", usagePerCup: r.usage_per_cup ?? 0, grams: null };
      (r.sub_key === "singleOrigin" ? drinks.singleOrigin : drinks.espresso).push(it);
    } else {
      const it = { ...base, category: "HandDrip" as const, subKey: null, grams: r.grams ?? 0 };
      beans.push(it);
    }
  }

  drinks.espresso.sort((a, b) => a.name.localeCompare(b.name));
  drinks.singleOrigin.sort((a, b) => a.name.localeCompare(b.name));
  beans.sort((a, b) => a.name.localeCompare(b.name) || (a.grams || 0) - (b.grams || 0));

  return {
    store: {
      drinks,
      HandDrip: beans,
    },
  };
}
