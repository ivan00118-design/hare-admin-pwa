// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/* ========= DB 視圖 v_inventory ========= */
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

/* ========= 讀取 v_inventory ========= */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase.from("v_inventory").select("*");
  if (error) throw error;
  return (data || []) as InventoryRow[];
}

/* ========= 映射成 UI 目前的 Inventory 形狀 ========= */
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

/* ========= 商品 upsert（避免 PGRST203） =========
   關鍵：只送該簽章會用到的參數 key；另一組 key 完全不送！ */
export async function upsertProduct(p: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price?: number | null;
}) {
  const cat = p.category;

  // 組裝 payload（只包含對應簽章的 key）
  const base = {
    p_sku: p.sku,
    p_name: p.name,
    p_category: cat,
    p_price: p.price ?? null,
  } as Record<string, any>;

  if (cat === "drinks") {
    base.p_sub_key = p.sub_key ?? null;
    base.p_usage_per_cup = p.usage_per_cup ?? 0.02;
    // **不要**加 p_grams
  } else {
    base.p_grams = p.grams ?? null;
    // **不要**加 p_sub_key / p_usage_per_cup
  }

  // 先試統一名稱 upsert_product（多簽章但已靠 key 唯一化）
  let { error } = await supabase.rpc("upsert_product", base);
  if (!error) return;

  // 若仍報 PGRST203（或沒有該函式），嘗試呼叫明確包裝函式
  const code = (error as any)?.code;
  if (code === "PGRST203" || code === "42883") {
    if (cat === "drinks") {
      const { error: e2 } = await supabase.rpc("upsert_product_drink", {
        p_sku: p.sku,
        p_name: p.name,
        p_sub_key: p.sub_key ?? null,
        p_usage_per_cup: p.usage_per_cup ?? 0.02,
        p_price: p.price ?? null,
      });
      if (e2) throw e2;
      return;
    } else {
      const { error: e2 } = await supabase.rpc("upsert_product_bean", {
        p_sku: p.sku,
        p_name: p.name,
        p_grams: p.grams ?? null,
        p_price: p.price ?? null,
      });
      if (e2) throw e2;
      return;
    }
  }

  // 其他錯誤照拋
  throw error;
}

/* ========= 手動調整庫存 ========= */
export async function adjustStock(sku: string, deltaKg: number, note?: string) {
  const { error } = await supabase.rpc("adjust_stock", {
    p_sku: sku,
    p_delta_kg: deltaKg,
    p_reason: deltaKg >= 0 ? "MANUAL_IN" : "MANUAL_OUT",
    p_note: note ?? null,
  });
  if (error) throw error;
}

/* ========= 刪除商品（會連動清理 FK） ========= */
export async function deleteProduct(sku: string) {
  const { error } = await supabase.from("product_catalog").delete().eq("sku", sku);
  if (error) throw error;
}

/* ========= 安全「變更豆子克數」流程 =========
   upsert 新 SKU → 舊 SKU 的庫存轉到新 SKU（adjust_stock 兩筆）→ 刪除舊 SKU */
export async function changeBeanPackSizeSafe(params: {
  oldSku: string;
  oldStockKg?: number | null; // 可不傳，會自動查
  name: string;
  price: number;
  newGrams: number; // 100 / 250 / 500 / 1000
}) {
  const { oldSku, oldStockKg, name, price, newGrams } = params;

  // 推導新 SKU：把尾巴的 "-{N}g" 改成新克數；若舊的不符規則就直接附上
  const base = oldSku.replace(/-\d+g$/i, "");
  const newSku = `${base}-${newGrams}g`;

  // 取得舊庫存（若未提供）
  let stock = Number(oldStockKg ?? NaN);
  if (!Number.isFinite(stock)) {
    const { data, error } = await supabase
      .from("v_inventory")
      .select("stock_kg")
      .eq("sku", oldSku)
      .maybeSingle();
    if (error) throw error;
    stock = Number((data as any)?.stock_kg ?? 0);
  }

  // 1) upsert 新 SKU（豆類）
  await upsertProduct({
    sku: newSku,
    name,
    category: "HandDrip",
    grams: newGrams,
    price,
  });

  // 2) 搬庫存（兩筆調整，保留追蹤）
  if (stock > 0) {
    await adjustStock(oldSku, -stock, `MIGRATE_TO ${newSku}`);
    await adjustStock(newSku, +stock, `MIGRATE_FROM ${oldSku}`);
  }

  // 3) 刪掉舊 SKU
  await deleteProduct(oldSku);

  return newSku;
}
