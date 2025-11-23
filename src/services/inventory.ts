// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/* =========================
 * Types
 * =======================*/

export type Category = "drinks" | "HandDrip";
export type DrinkSubKey = "espresso" | "singleOrigin";

export type InventoryRow = {
  sku: string;
  name: string;
  category: Category;
  sub_key: DrinkSubKey | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number | null;
  stock_kg: number | null;
};

// 供 UI 使用的結構（與 AppState / Dashboard / Delivery 對齊）
export type DrinkProduct = {
  id: string;
  name: string;
  price: number;
  usagePerCup: number; // 每杯扣的公斤數
  stock: number;       // kg
  unit: "kg";
};
export type BeanProduct = {
  id: string;
  name: string;
  grams: number; // 100 / 250 / 500 / 1000
  price: number;
  stock: number; // kg
  unit: "kg";
};
export type UIInventory = {
  store: {
    drinks: {
      espresso: DrinkProduct[];
      singleOrigin: DrinkProduct[];
    };
    HandDrip: BeanProduct[];
  };
};

/* =========================
 * Helpers
 * =======================*/

function toNum(n: any, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function ensureString(v: any): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/* =========================
 * Query: v_inventory
 * =======================*/

/** 從 v_inventory 讀取原始列 */
export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from("v_inventory")
    .select(
      "sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg"
    )
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []) as InventoryRow[];
}

/** 把 v_inventory 的列轉成 UI 需要的結構 */
export function rowsToUIInventory(rows: InventoryRow[]): UIInventory {
  const espresso: DrinkProduct[] = [];
  const singleOrigin: DrinkProduct[] = [];
  const beans: BeanProduct[] = [];

  for (const r of rows) {
    if (r.category === "drinks") {
      const item: DrinkProduct = {
        id: r.sku,
        name: ensureString(r.name),
        price: toNum(r.price),
        usagePerCup: toNum(r.usage_per_cup, 0.02),
        stock: toNum(r.stock_kg),
        unit: "kg",
      };
      if (r.sub_key === "singleOrigin") singleOrigin.push(item);
      else espresso.push(item); // 預設歸到 espresso
    } else if (r.category === "HandDrip") {
      beans.push({
        id: r.sku,
        name: ensureString(r.name),
        grams: toNum(r.grams),
        price: toNum(r.price),
        stock: toNum(r.stock_kg),
        unit: "kg",
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

/* =========================
 * Mutations
 * =======================*/

type UpsertProductArgs =
  | {
      // drinks
      sku: string;
      name: string;
      category: "drinks";
      sub_key: DrinkSubKey;
      usage_per_cup: number;
      price: number;
    }
  | {
      // beans
      sku: string;
      name: string;
      category: "HandDrip";
      grams: number;
      price: number;
    };

/**
 * 新增/更新商品：
 * 1) 優先嘗試 RPC: upsert_product_unified（若存在）
 * 2) 若碰到 PGRST203 / 404 等，退回表格 upsert（避免 overloading 造成無法上線）
 */
export async function upsertProduct(args: UpsertProductArgs): Promise<string> {
  // 先嘗試 RPC（若你的 DB 有建立）
  try {
    // 嘗試以「全部命名參數」呼叫；若 DB 有重載而導致 PGRST203，會進入 catch。
    const payload: Record<string, any> = {
      p_sku: args.sku,
      p_name: args.name,
      p_category: args.category,
      p_sub_key: (args as any).sub_key ?? null,
      p_grams: (args as any).grams ?? null,
      p_usage_per_cup: (args as any).usage_per_cup ?? null,
      p_price: (args as any).price,
    };
    const { error } = await supabase.rpc("upsert_product_unified", payload);
    if (!error) return args.sku;
    // 若不是 overloading 類錯誤，直接丟出
    if (
      !String(error?.code || "").includes("PGRST203") &&
      error?.code !== "404"
    ) {
      throw error;
    }
  } catch (e: any) {
    // 繼續走 fallback
    if (
      e?.code &&
      !String(e.code).includes("PGRST203") &&
      e.code !== "404"
    ) {
      // 不是 overloading / 404，就直接往外丟
      throw e;
    }
  }

  // ---- Fallback：直接 upsert 到 products ----
  const row: any = {
    sku: args.sku,
    name: args.name,
    category: args.category,
    price: (args as any).price,
    updated_at: new Date().toISOString(),
  };
  if (args.category === "drinks") {
    row.sub_key = (args as any).sub_key;
    row.usage_per_cup = (args as any).usage_per_cup ?? 0.02;
  } else {
    row.grams = (args as any).grams;
  }

  const { error: upsertErr } = await supabase
    .from("products")
    .upsert(row, { onConflict: "sku" });
  if (upsertErr) throw upsertErr;
  return args.sku;
}

/** 刪除商品：先試 RPC delete_product，失敗再直接 delete */
export async function deleteProduct(sku: string): Promise<void> {
  // RPC
  try {
    const { error } = await supabase.rpc("delete_product", { p_sku: sku });
    if (!error) return;
    if (error?.code !== "404") throw error; // 不是不存在就丟出，由下方 fallback 處理
  } catch (e: any) {
    if (e?.code !== "404") throw e;
  }

  // Fallback: 直接刪資料表
  const { error } = await supabase.from("products").delete().eq("sku", sku);
  if (error) throw error;
}

/**
 * 變更豆子的克數（安全版）：
 * 1) 優先 RPC change_bean_pack_size_safe（交易式）
 * 2) Fallback：查舊 row -> 以新 grams 產生新 SKU upsert -> 搬移庫存 -> 刪舊 SKU
 *    （若你想保留舊 SKU，可改為把舊 SKU 置為 active=false）
 */
export async function changeBeanPackSizeSafe(params: {
  oldSku: string;
  name: string;
  price: number;
  oldStockKg: number;
  newGrams: number;
}): Promise<string> {
  // 優先 RPC
  try {
    const { data, error } = await supabase.rpc(
      "change_bean_pack_size_safe",
      {
        p_old_sku: params.oldSku,
        p_name: params.name,
        p_price: params.price,
        p_old_stock_kg: params.oldStockKg,
        p_new_grams: params.newGrams,
      }
    );
    if (!error && typeof data === "string") return data;
    if (error?.code !== "404") throw error;
  } catch (e: any) {
    if (e?.code !== "404") throw e;
  }

  // ---- Fallback：純 REST 流程 ----
  // 1) 讀舊 product
  const { data: oldRow, error: getErr } = await supabase
    .from("products")
    .select("*")
    .eq("sku", params.oldSku)
    .maybeSingle();
  if (getErr) throw getErr;

  const baseName = ensureString(oldRow?.name || params.name);
  const basePrice = toNum(oldRow?.price, params.price);
  const stockKg = toNum(oldRow?.stock_kg, params.oldStockKg);

  // 2) 產生新 SKU：<base>-<grams>g
  const newSku =
    String(params.oldSku).split("-")[0] + `-${params.newGrams}g`;

  // 3) upsert 新 SKU（沿用名字、價錢、庫存）
  const { error: upErr } = await supabase.from("products").upsert(
    {
      sku: newSku,
      name: baseName,
      category: "HandDrip",
      grams: params.newGrams,
      price: basePrice,
      stock_kg: stockKg,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sku" }
  );
  if (upErr) throw upErr;

  // 4) 刪舊 SKU（若想保留歷史，改成 active=false）
  const { error: delErr } = await supabase
    .from("products")
    .delete()
    .eq("sku", params.oldSku);
  if (delErr) throw delErr;

  return newSku;
}

/**
 * 直接設定某 SKU 的庫存（kg）
 * 供 Inventory 頁面「手動編輯庫存」使用
 */
export async function setStockKg(sku: string, stockKg: number): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({
      stock_kg: toNum(stockKg, 0),
      updated_at: new Date().toISOString(),
    })
    .eq("sku", sku);
  if (error) throw error;
}

/* =========================
 * （選用）輔助：刷新前端所需的一次性管線
 * =======================*/

/**
 * 方便頁面使用：一次拉 v_inventory 並轉成 UI 結構
 * 例如：
 *   const ui = await loadUIInventory();
 *   setInventory(ui);
 */
export async function loadUIInventory(): Promise<UIInventory> {
  const rows = await fetchInventoryRows();
  return rowsToUIInventory(rows);
}
