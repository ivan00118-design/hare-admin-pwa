// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** ========== DB 視圖 v_inventory 的欄位 ========== */
export type InventoryRow = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number | null;
  unit: string | null;
  stock_kg: number | null;
};

/** 讀取 v_inventory（產品 + 目前庫存） */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase.from("v_inventory").select("*");
  if (error) throw error;
  return (data || []) as InventoryRow[];
}

/** 將 DB rows 映射成 UI inventory 形狀 */
export type UIDrink = {
  id: string;
  name: string;
  price: number;
  usagePerCup: number; // kg per cup
  stock: number;       // kg
  unit: "kg";
  category: "drinks";
  subKey: "espresso" | "singleOrigin";
};
export type UIBean = {
  id: string;
  name: string;
  price: number;
  grams: number;       // 包裝克數
  stock: number;       // kg
  unit: "kg";
  category: "HandDrip";
};
export type UIInventory = {
  store: {
    drinks: {
      espresso: UIDrink[];
      singleOrigin: UIDrink[];
    };
    HandDrip: UIBean[];
  };
};

export function rowsToUIInventory(rows: InventoryRow[]): UIInventory {
  const espresso: UIDrink[] = rows
    .filter((r) => r.category === "drinks" && r.sub_key === "espresso")
    .map((r) => ({
      id: r.sku,
      name: r.name,
      price: Number(r.price ?? 0),
      usagePerCup: Number(r.usage_per_cup ?? 0.02),
      stock: Number(r.stock_kg ?? 0),
      unit: "kg",
      category: "drinks",
      subKey: "espresso",
    }));

  const singleOrigin: UIDrink[] = rows
    .filter((r) => r.category === "drinks" && r.sub_key === "singleOrigin")
    .map((r) => ({
      id: r.sku,
      name: r.name,
      price: Number(r.price ?? 0),
      usagePerCup: Number(r.usage_per_cup ?? 0.02),
      stock: Number(r.stock_kg ?? 0),
      unit: "kg",
      category: "drinks",
      subKey: "singleOrigin",
    }));

  const beans: UIBean[] = rows
    .filter((r) => r.category === "HandDrip")
    .map((r) => ({
      id: r.sku,
      name: r.name,
      price: Number(r.price ?? 0),
      grams: Number(r.grams ?? 0),
      stock: Number(r.stock_kg ?? 0),
      unit: "kg",
      category: "HandDrip",
    }));

  return { store: { drinks: { espresso, singleOrigin }, HandDrip: beans } };
}

/** 新增/更新商品（RPC: upsert_product） */
export async function upsertProduct(p: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price?: number | null;
}) {
  const { error } = await supabase.rpc("upsert_product", {
    p_sku: p.sku,
    p_name: p.name,
    p_category: p.category,
    p_sub_key: p.sub_key ?? null,
    p_grams: p.grams ?? null,
    p_usage_per_cup: p.usage_per_cup ?? null,
    p_price: p.price ?? null,
  });
  if (error) throw error;
}

/** 手動調整庫存（RPC: adjust_stock） */
export async function adjustStock(sku: string, deltaKg: number, note?: string) {
  const { error } = await supabase.rpc("adjust_stock", {
    p_sku: sku,
    p_delta_kg: deltaKg,
    p_reason: deltaKg >= 0 ? "MANUAL_IN" : "MANUAL_OUT",
    p_note: note ?? null,
  });
  if (error) throw error;
}

/** 刪除商品（FK cascade 會清理 product_inventory） */
export async function deleteProduct(sku: string) {
  const { error } = await supabase.from("product_catalog").delete().eq("sku", sku);
  if (error) throw error;
}

/** ========== 完全 DB 化：直接由 v_inventory 彙總總庫存（kg） ========== */
const round2 = (n: number) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export type StockTotals = {
  totalKg: number;
  drinksKg: number;
  beansKg: number;
  espressoKg: number;
  singleOriginKg: number;
};

/**
 * 從 DB 讀 v_inventory 的每個 SKU 當前庫存（kg）並彙總，
 * 回傳：總庫存、飲品/豆子拆分、espresso/singleOrigin 拆分。
 */
export async function fetchStockTotals(): Promise<StockTotals> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("category, sub_key, stock_kg");
  if (error) throw error;

  let total = 0, drinks = 0, beans = 0, esp = 0, so = 0;
  for (const r of (data || []) as Array<{ category: "drinks" | "HandDrip"; sub_key: "espresso" | "singleOrigin" | null; stock_kg: number | null }>) {
    const kg = Number(r.stock_kg ?? 0);
    total += kg;
    if (r.category === "drinks") {
      drinks += kg;
      if (r.sub_key === "espresso") esp += kg;
      else if (r.sub_key === "singleOrigin") so += kg;
    } else if (r.category === "HandDrip") {
      beans += kg;
    }
  }

  return {
    totalKg: round2(total),
    drinksKg: round2(drinks),
    beansKg: round2(beans),
    espressoKg: round2(esp),
    singleOriginKg: round2(so),
  };
}

/** ========== 豆子「變更克數」安全流程（新 SKU、搬庫存、刪舊 SKU） ========== */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  oldStockKg: number; // 舊 SKU 目前庫存（kg）
  name: string;
  price: number;
  newGrams: number;
}): Promise<string> {
  const { oldSku, oldStockKg, name, price, newGrams } = args;
  // 產生新 SKU（避免撞名，直接隨機一個 id + 克數）
  const rand = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10));
  const newSku = `${rand}-${newGrams}g`;

  // 1) upsert 新 SKU
  await upsertProduct({
    sku: newSku,
    name,
    category: "HandDrip",
    grams: newGrams,
    price,
  });

  // 2) 搬庫存：oldSku -> newSku（兩筆 adjust）
  const move = Number(oldStockKg) || 0;
  if (move > 0) {
    await adjustStock(oldSku, -move, `MIGRATE_TO:${newSku}`);
    await adjustStock(newSku, +move, `MIGRATE_FROM:${oldSku}`);
  }

  // 3) 刪除舊 SKU
  await deleteProduct(oldSku);

  return newSku;
}
