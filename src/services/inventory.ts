// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** === DB 視圖 v_inventory 的欄位 === */
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

/** === 將 DB rows 映射成 UI 形狀（保持你現有的 UI 型別） === */
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

/** 產品 upsert（需要 DB 端 upsert_product） */
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

/** 手動調整庫存（需要 DB 端 adjust_stock） */
export async function adjustStock(sku: string, deltaKg: number, note?: string) {
  const { error } = await supabase.rpc("adjust_stock", {
    p_sku: sku,
    p_delta_kg: deltaKg,
    p_reason: deltaKg >= 0 ? "MANUAL_IN" : "MANUAL_OUT",
    p_note: note ?? null,
  });
  if (error) throw error;
}

/** 刪除商品（inventory 會因 FK cascade 一起清理） */
export async function deleteProduct(sku: string) {
  const { error } = await supabase.from("product_catalog").delete().eq("sku", sku);
  if (error) throw error;
}

/** 安全變更克數：優先呼叫 DB RPC；沒有就用前端 fallback */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  oldStockKg: number;
  name: string;
  price: number;
  newGrams: number;
  newSku?: string; // 可自訂，預設自動產生
}): Promise<string> {
  const newSku =
    args.newSku ??
    `${(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10))}-${args.newGrams}g`;

  // 1) 優先用 DB 端的原子操作
  try {
    const { data, error } = await supabase.rpc("change_pack_size_safe", {
      p_old_sku: args.oldSku,
      p_new_sku: newSku,
      p_name: args.name,
      p_new_grams: args.newGrams,
      p_new_price: args.price,
    });
    if (!error) return (data as string) ?? newSku;
    // 若 RPC 存在但報錯，直接丟出
    throw error;
  } catch (e: any) {
    // 2) Fallback：前端分步執行（非原子）
    try {
      await upsertProduct({
        sku: newSku,
        name: args.name,
        category: "HandDrip",
        grams: args.newGrams,
        price: args.price,
      });

      const qty = Number(args.oldStockKg || 0);
      if (qty > 0) {
        await adjustStock(args.oldSku, -qty, "transfer out (change pack size)");
        await adjustStock(newSku, qty, "transfer in (change pack size)");
      }

      await deleteProduct(args.oldSku);
      return newSku;
    } catch (fallbackErr) {
      throw fallbackErr;
    }
  }
}
