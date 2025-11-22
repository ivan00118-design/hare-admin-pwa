// src/services/orders.ts
import { supabase } from "../supabaseClient";

// ---------- 型別 ----------
export type UIStatus = "all" | "active" | "voided";

export type PlaceOrderItem = {
  name: string;
  sku?: string | null;
  qty: number;
  price: number;                          // 與 DB 單位一致（元或分）
  category?: "HandDrip" | "drinks";
  grams?: number;                         // 豆子品項才有
  sub_key?: "espresso" | "singleOrigin";  // 飲品才有
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;           // ISO 字串（可選）
};

export type PlaceOrderOptions = {
  channel?: "IN_STORE" | "DELIVERY";
  deliveryFee?: number;
  deliveryInfo?: DeliveryInfo | null;
  status?: "ACTIVE" | "VOIDED";
};

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;                               // "all" | "active" | "voided"
  channel?: "ALL" | "IN_STORE" | "DELIVERY";       // 可選：只抓某通路
  page?: number;
  pageSize?: number;
}

// ---------- 小工具 ----------
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.toISOString();
}

// 依 SKU/欄位補全品項資訊（確保 Dashboard 的豆子統計不為空）
function normalizeItem(it: any) {
  const sku: string | null = it?.sku ?? null;

  let grams: number | null =
    typeof it?.grams === "number" ? it.grams : null;
  let subKey: "espresso" | "singleOrigin" | null =
    it?.sub_key ?? null;

  if (!grams && typeof sku === "string") {
    const m = sku.match(/-(\d+)g$/i);
    if (m) grams = Number(m[1]);
  }
  if (!subKey && typeof sku === "string") {
    const m = sku.match(/-(espresso|singleOrigin)$/i);
    if (m) subKey = m[1] as any;
  }

  const category: "HandDrip" | "drinks" | null =
    it?.category ?? (grams != null ? "HandDrip" : subKey ? "drinks" : null);

  return {
    name: it.name,
    category,
    subKey,
    grams,
    qty: Number(it.qty) || 0,
    price: Number(it.price) || 0,
    sku,
  };
}

// ---------- 查詢訂單（相容新舊 schema；必要時單獨抓 order_items 合併；回傳 totalAmount） ----------
export async function fetchOrders({
  from,
  to,
  status = "all",
  channel = "ALL", // IN_STORE / DELIVERY / ALL
  page = 0,
  pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {
  const fromISO = from ? startOfDay(from) : undefined;
  const toISO = to ? endOfDay(to) : undefined;
  const fromIdx = page * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  // 依 SKU/欄位補齊缺值，避免統計出不來
  const normalizeItem = (it: any) => {
    const sku: string | null = it?.sku ?? null;
    let grams: number | null = typeof it?.grams === "number" ? it.grams : null;
    let subKey: "espresso" | "singleOrigin" | null = it?.sub_key ?? null;

    if (grams == null && typeof sku === "string") {
      const m = sku.match(/-(\d+)g$/i);
      if (m) grams = Number(m[1]);
    }
    if (!subKey && typeof sku === "string") {
      const m = sku.match(/-(espresso|singleOrigin)$/i);
      if (m) subKey = m[1] as any;
    }

    const category: "HandDrip" | "drinks" | null =
      it?.category ?? (grams != null ? "HandDrip" : subKey ? "drinks" : null);

    return {
      name: it.name,
      category,
      subKey,
      grams,
      qty: it.qty,
      price: it.price,
      sku,
    };
  };

  const mapRow = (r: any, mode: "channel" | "legacy") => {
    const isDelivery =
      mode === "channel" ? r.channel === "DELIVERY" : !!r.is_delivery;

    // 避免 {} 被當成 truthy：門市單 delivery 一律 null
    const rawInfo =
      mode === "channel" ? (r.delivery_info ?? null) : (r.delivery ?? null);
    const delivery =
      isDelivery && rawInfo && typeof rawInfo === "object" ? rawInfo : null;

    return {
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: Number(r.total) || 0,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery,
      delivery,
      items: Array.isArray(r.order_items)
        ? r.order_items.map((it: any) => normalizeItem(it))
        : [],
    };
  };

  // 新版（有 channel / delivery_info）
  const runChannel = async () => {
    let q = supabase
      .from("orders")
      .select(
        `
        id, created_at, status, payment_method, total, delivery_fee,
        channel, delivery_info, void_reason, voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
        `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO) q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel !== "ALL") q = q.eq("channel", channel);

    return q.range(fromIdx, toIdx);
  };

  // 舊版（is_delivery / delivery）
  const runLegacy = async () => {
    let q = supabase
      .from("orders")
      .select(
        `
        id, created_at, status, payment_method, total,
        is_delivery, delivery, delivery_fee, void_reason, voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
        `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO) q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());

    return q.range(fromIdx, toIdx);
  };

  // 巢狀 items 都是空 → 另外抓 order_items 合併
  const attachItemsIfEmpty = async (rows: any[]) => {
    if (!rows.length) return rows;
    const allEmpty = rows.every((r) => !Array.isArray(r.items) || r.items.length === 0);
    if (!allEmpty) return rows;

    const ids = rows.map((r) => r.id);
    const { data: itemRows, error: itemsErr } = await supabase
      .from("order_items")
      .select("order_id, name, category, sub_key, grams, qty, price, sku")
      .in("order_id", ids);

    if (itemsErr || !itemRows) return rows;

    const bucket = new Map<string, any[]>();
    for (const it of itemRows) {
      const list = bucket.get(it.order_id) || [];
      list.push(normalizeItem(it));
      bucket.set(it.order_id, list);
    }
    return rows.map((r) => ({ ...r, items: bucket.get(r.id) || [] }));
  };

  try {
    const { data, error, count } = await runChannel();
    if (error) throw error;
    let rows = (data ?? []).map((r: any) => mapRow(r, "channel"));
    rows = await attachItemsIfEmpty(rows);
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    return { rows, count: count ?? 0, totalAmount };
  } catch {
    const { data, error, count } = await runLegacy();
    if (error) throw error;
    let rows = (data ?? []).map((r: any) => mapRow(r, "legacy"));
    rows = await attachItemsIfEmpty(rows);
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    return { rows, count: count ?? 0, totalAmount };
  }
}


// ---------- 下單（支援通路/運費/配送資訊；相容多版本 RPC） ----------
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce(
    (s: number, it: PlaceOrderItem) => s + Number(it.qty) * Number(it.price),
    0
  );

  // 先嘗試新版（帶 channel / delivery / fail_when_insufficient）
  const tryV2 = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_channel: opts.channel ?? "IN_STORE",
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? null, // 門市單送 null
    p_fail_when_insufficient: false,
  });

  if (!tryV2.error) return tryV2.data as string;

  // 若遇到重載歧義（PGRST203），fallback 舊版參數
  const ambiguous =
    String(tryV2.error.code || "").toUpperCase() === "PGRST203" ||
    /Could not choose the best candidate function/i.test(String(tryV2.error.message || ""));

  if (ambiguous) {
    const tryV1 = await supabase.rpc("place_order", {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
    });
    if (tryV1.error) throw tryV1.error;
    return tryV1.data as string;
  }

  throw tryV2.error;
}

// 小幫手：Delivery 包裝
export async function placeDelivery(
  items: PlaceOrderItem[],
  paymentMethod: string,
  info: DeliveryInfo,
  deliveryFee: number = 0,
  status: "ACTIVE" | "VOIDED" = "ACTIVE"
) {
  return placeOrder(items, paymentMethod, status, {
    channel: "DELIVERY",
    deliveryInfo: info,
    deliveryFee,
  });
}

// ---------- 作廢訂單（用 DB RPC） ----------
export async function voidOrderDB(
  orderId: string,
  opts?: { reason?: string; restock?: boolean }
) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

// （預留）若需回補庫存可在此實作（或以 DB 端觸發器/函式處理）
export async function restockByOrder(_orderId: string) {
  return;
}
