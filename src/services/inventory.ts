// src/services/inventory.ts
import { supabase } from "../supabaseClient";

/* ==============================
 * 型別：DB 與 UI
 * ============================== */

export type DrinkSubKey = "espresso" | "singleOrigin";

export type InventoryRow = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: DrinkSubKey | null;     // drinks 才有
  grams: number | null;            // beans 才有（g）
  usage_per_cup: number | null;    // drinks 才有（kg）
  price: number;
  stock_kg: number;                // 現存量（kg）
  active?: boolean | null;
};

export type UIItem = {
  id: string;                      // = sku
  name: string;
  price: number;
  stock?: number;                  // 顯示用（kg）
  // drinks
  category?: "drinks" | "HandDrip";
  subKey?: DrinkSubKey | null;
  usagePerCup?: number | null;
  // beans
  grams?: number | null;
};

export type UIInventory = {
  store: {
    drinks: {
      espresso: UIItem[];
      singleOrigin: UIItem[];
    };
    HandDrip: UIItem[];
  };
};

export type StockTotals = {
  totalKg: number;
  drinksKg: number;
  beansKg: number;
  espressoKg: number;
  singleOriginKg: number;
};

/* ==============================
 * 讀取 Inventory（View 優先、表格回退）
 * ============================== */

export async function fetchInventoryRows(): Promise<InventoryRow[]> {
  // 1) 先試 v_inventory（建議做法）
  try {
    const res = await supabase
      .from("v_inventory")
      .select(
        "sku,name,category,sub_key,grams,usage_per_cup,price,stock_kg,active"
      )
      .order("name", { ascending: true });

    if (res.error) throw res.error;
    return (res.data ?? []) as InventoryRow[];
  } catch (_e) {
    // 2) 回退舊表（盡量包容）
    const res = await supabase
      .from("products")
      .select(
        "sku,name,category,sub_key,grams,usage_per_cup,price,active,inventory!left(stock_kg)"
      )
      .order("name", { ascending: true });

    if (res.error) throw res.error;

    // products×inventory left-join 的情況：把 stock_kg 攤平
    const rows: InventoryRow[] = (res.data ?? []).map((r: any) => ({
      sku: r.sku,
      name: r.name,
      category: r.category,
      sub_key: r.sub_key ?? null,
      grams: typeof r.grams === "number" ? r.grams : r.grams ?? null,
      usage_per_cup:
        typeof r.usage_per_cup === "number" ? r.usage_per_cup : r.usage_per_cup ?? null,
      price: Number(r.price) || 0,
      stock_kg:
        typeof r?.inventory?.stock_kg === "number"
          ? r.inventory.stock_kg
          : Number(r.stock_kg) || 0,
      active: typeof r.active === "boolean" ? r.active : true,
    }));

    return rows;
  }
}

/** 把 DB rows 轉成 UI 結構（供 AppState / Pages 使用） */
export function rowsToUIInventory(rows: InventoryRow[]): UIInventory {
  const espresso: UIItem[] = [];
  const singleOrigin: UIItem[] = [];
  const beans: UIItem[] = [];

  for (const r of rows) {
    if (r.active === false) continue;

    if (r.category === "drinks") {
      const it: UIItem = {
        id: r.sku,
        name: r.name,
        price: Number(r.price) || 0,
        stock: Number(r.stock_kg) || 0,
        category: "drinks",
        subKey: (r.sub_key ?? null) as DrinkSubKey | null,
        usagePerCup:
          typeof r.usage_per_cup === "number" ? r.usage_per_cup : (r.usage_per_cup ?? null),
        grams: null,
      };
      if (r.sub_key === "singleOrigin") singleOrigin.push(it);
      else espresso.push(it);
    } else {
      // beans
      beans.push({
        id: r.sku,
        name: r.name,
        price: Number(r.price) || 0,
        stock: Number(r.stock_kg) || 0,
        category: "HandDrip",
        subKey: null,
        usagePerCup: null,
        grams: typeof r.grams === "number" ? r.grams : r.grams ?? null,
      });
    }
  }

  // 按名稱排序；beans 另外按克數分群內排序
  espresso.sort((a, b) => a.name.localeCompare(b.name));
  singleOrigin.sort((a, b) => a.name.localeCompare(b.name));
  beans.sort((a, b) => {
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return (a.grams || 0) - (b.grams || 0);
  });

  return {
    store: {
      drinks: { espresso, singleOrigin },
      HandDrip: beans,
    },
  };
}

/* ==============================
 * 總量：Inventory Management 顯示用
 * ============================== */

export async function fetchStockTotals(): Promise<StockTotals> {
  // 若你有 v_inventory_totals，優先使用
  try {
    const res = await supabase
      .from("v_inventory_totals")
      .select("total_kg, drinks_kg, beans_kg, espresso_kg, single_origin_kg")
      .maybeSingle();

    if (!res.error && res.data) {
      const d = res.data as any;
      return {
        totalKg: Number(d.total_kg) || 0,
        drinksKg: Number(d.drinks_kg) || 0,
        beansKg: Number(d.beans_kg) || 0,
        espressoKg: Number(d.espresso_kg) || 0,
        singleOriginKg: Number(d.single_origin_kg) || 0,
      };
    }
  } catch (_e) {
    /* ignore and fallback */
  }

  // 回退：用 rows 計算
  const rows = await fetchInventoryRows();
  let drinksKg = 0,
    beansKg = 0,
    espressoKg = 0,
    singleOriginKg = 0;

  for (const r of rows) {
    const s = Number(r.stock_kg) || 0;
    if (r.category === "drinks") {
      drinksKg += s;
      if (r.sub_key === "singleOrigin") singleOriginKg += s;
      else espressoKg += s;
    } else {
      beansKg += s;
    }
  }

  return {
    totalKg: drinksKg + beansKg,
    drinksKg,
    beansKg,
    espressoKg,
    singleOriginKg,
  };
}

/* ==============================
 * 產品維護：RPC 優先，表級回退
 * ============================== */

/** upsert 商品（自動判斷 drinks / beans） */
export async function upsertProduct(input: {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  // drinks
  sub_key?: DrinkSubKey;
  usage_per_cup?: number;
  // beans
  grams?: number;
  // 共用
  price: number;
}) {
  const isDrink = input.category === "drinks";
  const p = {
    p_sku: input.sku,
    p_name: input.name,
    p_category: input.category,
    ...(isDrink
      ? {
          p_sub_key: input.sub_key ?? "espresso",
          p_usage_per_cup: Number(input.usage_per_cup ?? 0),
        }
      : {
          p_grams: Number(input.grams ?? 0),
        }),
    p_price: Number(input.price || 0),
  };

  // 1) 試較明確的 RPC 名稱
  try {
    const fn = isDrink ? "upsert_product_drink" : "upsert_product_bean";
    const r1 = await supabase.rpc(fn, p as any);
    if (!r1.error) return r1.data;
  } catch (_e) {
    /* fallthrough */
  }

  // 2) 回到通用 upsert_product（避免 PGRST203：確保只帶對應參數）
  try {
    const r2 = await supabase.rpc("upsert_product", p as any);
    if (!r2.error) return r2.data;
  } catch (_e) {
    /* fallthrough */
  }

  // 3) 最後回退：直接 upsert 到 products
  //   - 這段只保證能工作；細節（trigger 同步庫存等）建議仍優先 RPC
  const body: any = {
    sku: input.sku,
    name: input.name,
    category: input.category,
    price: Number(input.price || 0),
    active: true,
  };
  if (isDrink) {
    body.sub_key = input.sub_key ?? "espresso";
    body.usage_per_cup = Number(input.usage_per_cup ?? 0);
    body.grams = null;
  } else {
    body.sub_key = null;
    body.usage_per_cup = null;
    body.grams = Number(input.grams ?? 0);
  }

  const up = await supabase.from("products").upsert(body, { onConflict: "sku" }).select("sku").maybeSingle();
  if (up.error) throw up.error;
  return up.data?.sku ?? input.sku;
}

/** 刪除（優先 RPC，否則軟刪除 active=false，再不行才硬刪） */
export async function deleteProduct(sku: string) {
  // 1) RPC
  try {
    const r1 = await supabase.rpc("delete_product", { p_sku: sku });
    if (!r1.error) return true;
  } catch (_e) {}

  // 2) 軟刪除（active=false）
  const soft = await supabase.from("products").update({ active: false }).eq("sku", sku);
  if (!soft.error && (soft.count || 0) >= 0) return true;

  // 3) 硬刪
  const hard = await supabase.from("products").delete().eq("sku", sku);
  if (hard.error) throw hard.error;
  return true;
}

/** Beans 安全變更克數（優先 RPC；否則回退新建SKU+停用舊SKU） */
export async function changeBeanPackSizeSafe(args: {
  oldSku: string;
  oldStockKg: number;
  name: string;
  price: number;
  newGrams: number;
}): Promise<string> {
  // 1) RPC
  try {
    const r1 = await supabase.rpc("change_bean_pack_size_safe", {
      p_old_sku: args.oldSku,
      p_old_stock_kg: Number(args.oldStockKg || 0),
      p_name: args.name,
      p_price: Number(args.price || 0),
      p_new_grams: Number(args.newGrams || 0),
    });
    if (!r1.error && r1.data) return String(r1.data);
  } catch (_e) {}

  // 2) 回退流程：新建 SKU → 停用舊 SKU
  const newSku = `${crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}-${args.newGrams}g`;
  await upsertProduct({
    sku: newSku,
    name: args.name,
    category: "HandDrip",
    grams: Number(args.newGrams || 0),
    price: Number(args.price || 0),
  });

  // 舊 SKU 停用
  await deleteProduct(args.oldSku);
  return newSku;
}

/* ==============================
 * 方便頁面一次拉：UI 結構
 * ============================== */

export async function fetchUIInventory(): Promise<UIInventory> {
  const rows = await fetchInventoryRows();
  return rowsToUIInventory(rows);
}
