// src/services/inventory.ts
import { supabase } from "../supabaseClient";

// === DB 端視圖 v_inventory 的欄位 ===
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

// === 讀取 v_inventory（產品 + 目前庫存） ===
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase.from("v_inventory").select("*");
  if (error) throw error;
  return (data || []) as InventoryRow[];
}

// === 將 DB rows 映射成你 UI 目前的 Inventory 形狀 ===
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
    .filter(r => r.category === "drinks" && r.sub_key === "espresso")
    .map(r => ({
      id: r.sku,                       // 直接用 sku 當 id
      name: r.name,
      price: Number(r.price ?? 0),
      usagePerCup: Number(r.usage_per_cup ?? 0.02),
      stock: Number(r.stock_kg ?? 0),
      unit: "kg",
      category: "drinks",
      subKey: "espresso",
    }));

  const singleOrigin: UIDrink[] = rows
    .filter(r => r.category === "drinks" && r.sub_key === "singleOrigin")
    .map(r => ({
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
    .filter(r => r.category === "HandDrip")
    .map(r => ({
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

// ===（可選）商品新增/更新：需有 upsert_product RPC ===
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

// ===（可選）手動調整庫存：需有 adjust_stock RPC ===
export async function adjustStock(sku: string, deltaKg: number, note?: string) {
  const { error } = await supabase.rpc("adjust_stock", {
    p_sku: sku,
    p_delta_kg: deltaKg,
    p_reason: deltaKg >= 0 ? "MANUAL_IN" : "MANUAL_OUT",
    p_note: note ?? null,
  });
  if (error) throw error;
}

// ===（可選）刪除商品：product_inventory 會因 FK cascade 一起清理 ===
export async function deleteProduct(sku: string) {
  const { error } = await supabase.from("product_catalog").delete().eq("sku", sku);
  if (error) throw error;
}

/* =========================
 *  Beans 變更克數（安全流程）
 *  1) 建立/更新新 SKU
 *  2) 搬庫存（舊 -stock → 新 +stock）
 *  3) 刪除舊 SKU
 *  成功回傳 newSku
 * ========================= */

// 產生新 id（當作新 SKU base 的後備方案）
function _newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return String(Date.now());
}

// 從舊 SKU 推導 base：xxxx-250g → xxxx
function _skuBase(oldSku: string) {
  const m = String(oldSku).match(/^(.*)-\d+g$/);
  return m ? m[1] : _newId();
}

/**
 * 變更 Beans 克數（會建立新 SKU、搬移庫存、刪舊 SKU）
 * @param oldSku     舊 SKU
 * @param oldStockKg 舊 SKU 當前庫存（kg）
 * @param name       品名（沿用）
 * @param price      價格（沿用）
 * @param newGrams   新克數（100/250/500/1000...）
 * @returns newSku
 */
export async function changeBeanPackSizeSafe(params: {
  oldSku: string;
  oldStockKg: number;
  name: string;
  price: number;
  newGrams: number;
}): Promise<string> {
  const { oldSku, oldStockKg, name, price, newGrams } = params;

  if (!Number.isFinite(newGrams) || newGrams <= 0) {
    throw new Error("newGrams 必須是正整數");
  }

  const base = _skuBase(oldSku);
  const newSku = `${base}-${newGrams}g`;
  const stock = Math.max(0, Number(oldStockKg) || 0);

  // 1) 新 SKU（upsert 可覆蓋/建立）
  await upsertProduct({
    sku: newSku,
    name,
    category: "HandDrip",
    grams: newGrams,
    price,
  });

  // 2) 搬庫存（舊扣 / 新加）
  if (stock > 0) {
    await adjustStock(oldSku, -stock, `migrate_to:${newSku}`);
    await adjustStock(newSku, +stock, `migrate_from:${oldSku}`);
  }

  // 3) 刪舊 SKU（若因歷史訂單 FK 無法刪除，丟出友善錯誤）
  try {
    await deleteProduct(oldSku);
  } catch (err: any) {
    const msg = err?.message || String(err);
    throw new Error(
      `新 SKU 已建立並搬移庫存（新 SKU: ${newSku}），但刪除舊 SKU 失敗（可能有歷史訂單關聯）：${msg}`
    );
  }

  return newSku;
}
    