// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/* =========================
 * 型別：DB 端 v_inventory
 * ========================= */
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

/* =========================
 * 讀取 v_inventory（產品 + 目前庫存）
 * ========================= */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase.from("v_inventory").select("*");
  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

/* =========================
 * 對應到 UI 目前的 Inventory 形狀
 * ========================= */
export type UIDrink = {
  id: string;
  name: string;
  price: number;
  usagePerCup: number; // kg per cup
  stock: number; // kg
  unit: "kg";
  category: "drinks";
  subKey: "espresso" | "singleOrigin";
};

export type UIBean = {
  id: string;
  name: string;
  price: number;
  grams: number; // 包裝克數
  stock: number; // kg
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

/* =========================
 * 商品 upsert（用 RPC；避免 PGRST203）
 * ========================= */
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
    // 加上長版簽名的參數，打破函式重載歧義
    p_extra_info: null,
    p_fail_when_insufficient: false,
  });
  if (error) throw error;
}

/* =========================
 * 手動調整庫存（RPC）
 * ========================= */
export async function adjustStock(
  sku: string,
  deltaKg: number,
  note?: string
) {
  const { error } = await supabase.rpc("adjust_stock", {
    p_sku: sku,
    p_delta_kg: deltaKg,
    p_reason: deltaKg >= 0 ? "MANUAL_IN" : "MANUAL_OUT",
    p_note: note ?? null,
  });
  if (error) throw error;
}

/* =========================
 * 刪除商品（SKU）
 * ========================= */
export async function deleteProduct(sku: string) {
  const { error } = await supabase
    .from("product_catalog")
    .delete()
    .eq("sku", sku);
  if (error) throw error;
}

/* =========================
 * Beans 變更克數（安全流程）
 * upsert 新 SKU → 轉移庫存（兩筆 adjust_stock）
 * → 刪除舊 SKU → 回傳新 SKU
 * ========================= */
export async function changeBeanPackSizeSafe(input: {
  oldSku: string;
  name: string;
  price: number;
  newGrams: number;
  oldStockKg?: number; // 若未提供，會自動讀 v_inventory
}): Promise<string> {
  // 讀取舊 SKU 的現有庫存（若呼叫端未提供）
  let oldStockKg = typeof input.oldStockKg === "number" ? input.oldStockKg : 0;
  if (typeof input.oldStockKg !== "number") {
    const { data: found, error } = await supabase
      .from("v_inventory")
      .select("stock_kg")
      .eq("sku", input.oldSku)
      .maybeSingle();
    if (error) throw error;
    oldStockKg = Number(found?.stock_kg ?? 0);
  }

  // 產生新 SKU：沿用舊 SKU 前綴 + 新 grams + 隨機尾碼避免碰撞
  const prefix = input.oldSku.split("-")[0] || input.oldSku;
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const newSku = `${prefix}-${input.newGrams}g-${rnd}`;

  // 1) 建立新 SKU / 更新基本資料
  await upsertProduct({
    sku: newSku,
    name: input.name,
    category: "HandDrip",
    grams: input.newGrams,
    price: input.price,
  });

  // 2) 轉移庫存（若有庫存才轉）
  const moved = Number(oldStockKg || 0);
  if (moved > 0) {
    await adjustStock(input.oldSku, -moved, `MIGRATE_PACK_SIZE → ${newSku}`);
    await adjustStock(newSku, moved, `MIGRATE_PACK_SIZE from ${input.oldSku}`);
  }

  // 3) 刪除舊 SKU
  await deleteProduct(input.oldSku);

  return newSku;
}

/* =========================
 * 庫存彙總（完全 DB 化）
 * 提供給 InventoryManagement 畫面
 * ========================= */
export type StockTotals = {
  totalKg: number;
  drinksKg: number;
  beansKg: number;
  espressoKg: number;
  singleOriginKg: number;
};

export async function fetchStockTotals(): Promise<StockTotals> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select("category, sub_key, stock_kg");
  if (error) throw error;

  let totalKg = 0;
  let drinksKg = 0;
  let beansKg = 0;
  let espressoKg = 0;
  let singleOriginKg = 0;

  for (const r of (data ?? []) as Array<{
    category: InventoryRow["category"];
    sub_key: InventoryRow["sub_key"];
    stock_kg: number | null;
  }>) {
    const s = Number(r.stock_kg ?? 0);
    totalKg += s;
    if (r.category === "drinks") {
      drinksKg += s;
      if (r.sub_key === "espresso") espressoKg += s;
      if (r.sub_key === "singleOrigin") singleOriginKg += s;
    } else if (r.category === "HandDrip") {
      beansKg += s;
    }
  }

  return { totalKg, drinksKg, beansKg, espressoKg, singleOriginKg };
}
