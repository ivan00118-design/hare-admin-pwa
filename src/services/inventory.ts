// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** 從視圖讀 inventory 列 */
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

/** 供 UI 使用的資料結構（對齊 AppState 的需求） */
export type UIInventory = {
  store: {
    drinks: {
      espresso: Array<{ id: string; name: string; price: number; usagePerCup: number; stock: number; unit: "kg" }>;
      singleOrigin: Array<{ id: string; name: string; price: number; usagePerCup: number; stock: number; unit: "kg" }>;
    };
    HandDrip: Array<{ id: string; name: string; price: number; grams: number; stock: number; unit: "kg" }>;
  };
};

export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []) as InventoryRow[];
}

/** DB rows → UI 結構（保證必要欄位都有數值，不會是 undefined） */
export function rowsToUIInventory(rows: InventoryRow[]): UIInventory {
  const ui: UIInventory = {
    store: {
      drinks: { espresso: [], singleOrigin: [] },
      HandDrip: [],
    },
  };

  for (const r of rows || []) {
    if (r.category === "drinks") {
      const sub = r.sub_key === "singleOrigin" ? "singleOrigin" : "espresso";
      ui.store.drinks[sub].push({
        id: r.sku,
        name: r.name,
        price: Number(r.price) || 0,
        usagePerCup: Number(r.usage_per_cup) || 0.02,
        stock: Number(r.stock_kg) || 0,
        unit: "kg",
      });
    } else {
      ui.store.HandDrip.push({
        id: r.sku,
        name: r.name,
        price: Number(r.price) || 0,
        grams: Number(r.grams) || 0,
        stock: Number(r.stock_kg) || 0,
        unit: "kg",
      });
    }
  }
  return ui;
}

/** 手動設定庫存（kg） */
export async function setStockKg(sku: string, stockKg: number) {
  const { error } = await supabase.from("products").update({ stock_kg: Number(stockKg) || 0 }).eq("sku", sku);
  if (error) throw error;
}

/** Upsert product（優先 RPC，否則回寫資料表） */
export async function upsertProduct(arg: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin";
  grams?: number;
  usage_per_cup?: number;
  price: number;
}) {
  // 單一簽名避免 PostgREST 203 overloading：優先呼叫新 RPC 名稱，失敗再嘗試舊的
  const payload = {
    p_sku: arg.sku,
    p_name: arg.name,
    p_category: arg.category,
    p_sub_key: arg.sub_key ?? null,
    p_grams: arg.grams ?? null,
    p_usage_per_cup: arg.usage_per_cup ?? null,
    p_price: arg.price,
  };

  const tryNew = await supabase.rpc("upsert_product_unified", payload as any);
  if (!tryNew.error) return tryNew.data as string;

  const tryOld = await supabase.rpc("upsert_product", payload as any);
  if (!tryOld.error) return tryOld.data as string;

  // fallback 直接資料表
  const { error } = await supabase
    .from("products")
    .upsert({
      sku: arg.sku,
      name: arg.name,
      category: arg.category,
      sub_key: arg.sub_key ?? null,
      grams: arg.grams ?? null,
      usage_per_cup: arg.usage_per_cup ?? null,
      price: arg.price,
    }, { onConflict: "sku" });
  if (error) throw error;
  return arg.sku;
}

/** 刪除 product（優先 RPC，否則資料表） */
export async function deleteProduct(sku: string) {
  const r = await supabase.rpc("delete_product", { p_sku: sku });
  if (!r.error) return;
  const { error } = await supabase.from("products").delete().eq("sku", sku);
  if (error) throw error;
}

/** Beans 變更克數（優先 RPC，否則在前端執行等價流程） */
export async function changeBeanPackSizeSafe(arg: {
  oldSku: string;
  name: string;
  price: number;
  oldStockKg: number;
  newGrams: number;
}) {
  const r = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: arg.oldSku,
    p_name: arg.name,
    p_price: arg.price,
    p_old_stock_kg: arg.oldStockKg,
    p_new_grams: arg.newGrams,
  });
  if (!r.error && r.data) return r.data as string;

  // fallback：前端執行
  const base = arg.oldSku.replace(/-(\d+g|espresso|singleOrigin)$/, "");
  const newSku = `${base}-${arg.newGrams}g`;

  // 讀舊 stock
  const { data: pOld } = await supabase.from("products").select("stock_kg").eq("sku", arg.oldSku).maybeSingle();
  const oldKG = Number(pOld?.stock_kg) || Number(arg.oldStockKg) || 0;

  // upsert 新商品（沿用庫存）
  await supabase.from("products").upsert({
    sku: newSku,
    name: arg.name,
    category: "HandDrip",
    grams: arg.newGrams,
    price: arg.price,
    stock_kg: oldKG,
    active: true,
  }, { onConflict: "sku" });

  // 刪除舊 sku
  await supabase.from("products").delete().eq("sku", arg.oldSku);

  return newSku;
}
