// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/** 從 DB view 取回的單筆資料型別 */
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

/** 從 v_inventory 抓商品清單（含目前庫存 kg） */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select(
      "sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg"
    )
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as InventoryRow[];
}

/**
 * 將 DB rows 轉為前端 Inventory（符合 AppState 期望）
 * 注意：drinks 產品陣列需要帶 unit 屬性，否則型別不匹配
 */
export function rowsToUIInventory(rows: InventoryRow[]) {
  const espresso: any[] = [];
  const singleOrigin: any[] = [];
  const beans: any[] = [];

  for (const r of rows) {
    const price = Number(r.price) || 0;
    const stock = Number(r.stock_kg) || 0;

    if (r.category === "drinks") {
      const base = {
        id: r.sku,
        name: r.name,
        price,
        usagePerCup: Number(r.usage_per_cup) || 0.02,
        unit: "cup" as const,        // ★ AppState.DrinkProduct 需要
        stock,                       // 方便前端顯示
      };
      if (r.sub_key === "espresso") espresso.push(base);
      else if (r.sub_key === "singleOrigin") singleOrigin.push(base);
    } else {
      beans.push({
        id: r.sku,
        name: r.name,
        price,
        grams: Number(r.grams) || 0,
        unit: "pack" as const,       // 與 drinks 區分
        stock,                       // 單品項庫存（kg）
      });
    }
  }

  return {
    store: {
      drinks: {
        espresso,
        singleOrigin,
      },
      HandDrip: beans,
    },
  };
}

/** 產品 upsert（統一走一個 RPC，避免 overloading） */
export async function upsertProduct(input: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin" | null;
  grams?: number | null;
  usage_per_cup?: number | null;
  price: number;
}): Promise<string> {
  const payload = {
    p_sku: input.sku,
    p_name: input.name,
    p_category: input.category,
    p_sub_key: input.category === "drinks" ? (input.sub_key ?? null) : null,
    p_grams:    input.category === "HandDrip" ? (input.grams ?? null) : null,
    p_usage_per_cup: input.category === "drinks" ? (input.usage_per_cup ?? null) : null,
    p_price: Number(input.price) || 0,
  };

  const { data, error } = await supabase.rpc("upsert_product", payload);
  if (error) throw error;
  return String(data); // 回傳 sku（函式內有 return p_sku）
}

/** 刪除產品（以 sku） */
export async function deleteProduct(sku: string) {
  const { error } = await supabase.rpc("delete_product", { p_sku: sku });
  if (error) throw error;
}

/**
 * Beans 安全變更克數（新 SKU、搬移/保留庫存、標記舊 SKU）
 * 後端 SQL 會建立/覆寫新 SKU，並將舊 SKU 置為不啟用或刪除（依你 SQL 設定）
 */
export async function changeBeanPackSizeSafe(input: {
  oldSku: string;
  name: string;
  price: number;
  oldStockKg: number; // 舊 SKU 當下庫存（kg），若 SQL 端會自行查就可傳 0
  newGrams: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("change_bean_pack_size_safe", {
    p_old_sku: input.oldSku,
    p_name: input.name,
    p_price: Number(input.price) || 0,
    p_old_stock_kg: Number(input.oldStockKg) || 0,
    p_new_grams: Number(input.newGrams) || 0,
  });
  if (error) throw error;
  return String(data); // 新 SKU
}
