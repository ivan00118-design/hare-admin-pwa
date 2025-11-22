// src/services/orders.ts
import { supabase } from "../supabaseClient";

/* ========= 型別 ========= */
export type UIStatus = "all" | "active" | "voided";

export type PlaceOrderItem = {
  name: string;
  sku?: string | null;
  qty: number;
  price: number;
  category?: "HandDrip" | "drinks";
  grams?: number;
  sub_key?: "espresso" | "singleOrigin";
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;
  // 出貨清單用；可不傳，DB 端預設 PENDING
  ship_status?: "PENDING" | "CLOSED" | null;
};

export type PlaceOrderOptions = {
  deliveryFee?: number;
  deliveryInfo?: DeliveryInfo | null;
  status?: "ACTIVE" | "VOIDED";
};

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;                         // "all" | "active" | "voided"
  channel?: "ALL" | "IN_STORE" | "DELIVERY"; // 前端過濾用（相容三種欄位）
  page?: number;
  pageSize?: number;
}

/* ========= 小工具 ========= */
function startOfDay(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString();
}
function endOfDay(d: Date) {
  const x = new Date(d); x.setHours(23, 59, 59, 999); return x.toISOString();
}

// 同一筆 order 在不同 schema（channel / is_delivery / delivery_info）下，統一判斷是否為 Delivery
function normalizeIsDelivery(row: any): boolean {
  if (typeof row?.channel === "string") return row.channel === "DELIVERY";
  if (typeof row?.is_delivery === "boolean") return !!row.is_delivery;
  const info = row?.delivery_info ?? row?.delivery ?? null;
  if (info && typeof info === "object") {
    // 只要 delivery json 非空就視為 Delivery
    try { return JSON.stringify(info) !== "{}"; } catch { return true; }
  }
  return false;
}

/* ========= Shipping List（完全 DB 化） ========= */
export type ShipStatus = "PENDING" | "CLOSED";
export type ShippingRow = {
  id: string;                 // order id
  created_at: string;
  status: string;
  payment_method: string | null;
  total: number;
  channel: "DELIVERY" | "IN_STORE";
  delivery_json: any;
  ship_status: ShipStatus | null;
  customer_name: string | null;
  items_count: number;
};

// 直接讀取 View（第 C 節給了 View 的 SQL）
export async function listShipping(status: ShipStatus, limit = 200) {
  const { data, error } = await supabase
    .from("v_shipping_list_compat")
    .select("*")
    .eq("ship_status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ShippingRow[];
}

// 透過 RPC 設定出貨狀態（第 C 節給了 RPC 的 SQL）
export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus) {
  const { error } = await supabase.rpc("set_delivery_ship_status", {
    p_order_id: orderId,
    p_ship_status: shipStatus,
  });
  if (error) throw error;
}

/* ========= 訂單查詢（兩段查詢 + 相容欄位 + 回傳 totalAmount） ========= */
export async function fetchOrders({
  from, to, status = "all", channel = "ALL",
  page = 0, pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;

  // 只抓 orders（不 join order_items）
  let q = supabase
    .from("orders")
    .select(`
      id, created_at, status, payment_method,
      total, delivery_fee,
      channel, delivery_info,
      is_delivery, delivery,
      void_reason, voided_at
    `, { count: "exact" })
    .order("created_at", { ascending: false });

  if (fromISO) q = q.gte("created_at", fromISO);
  if (toISO)   q = q.lte("created_at", toISO);
  if (status !== "all") q = q.eq("status", status.toUpperCase());

  // ⚠️ 不做 server-side channel 過濾（舊庫沒有 channel 欄位會 400），改成前端過濾
  const ordRes = await q;
  if (ordRes.error) throw ordRes.error;

  // 標準化 + 前端過濾 channel
  const base = (ordRes.data ?? []).map((r: any) => {
    const isDelivery = normalizeIsDelivery(r);
    return {
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery,
      delivery: r.delivery_info ?? r.delivery ?? null,
      items: [] as any[],
    };
  });

  const filtered = base.filter((row) => {
    if (channel === "ALL") return true;
    return channel === "DELIVERY" ? row.isDelivery : !row.isDelivery;
  });

  // 分頁（前端）
  const count = filtered.length;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize;
  const pageRows = filtered.slice(fromIdx, toIdx);

  // 二段查詢：抓本頁的 order_items
  const ids = pageRows.map(r => r.id);
  if (ids.length) {
    const its = await supabase
      .from("order_items")
      .select("order_id,name,category,sub_key,grams,qty,price,sku")
      .in("order_id", ids);
    if (its.error) throw its.error;

    const byOrder = new Map<string, any[]>();
    for (const it of its.data ?? []) {
      if (!byOrder.has((it as any).order_id)) byOrder.set((it as any).order_id, []);
      byOrder.get((it as any).order_id)!.push({
        name: (it as any).name,
        category: (it as any).category ?? null,
        subKey: (it as any).sub_key ?? null,
        grams: (typeof (it as any).grams === "number" ? (it as any).grams : (it as any).grams ?? null),
        qty: (it as any).qty,
        price: (it as any).price,
        sku: (it as any).sku ?? null,
      });
    }
    for (const r of pageRows) r.items = byOrder.get(r.id) ?? [];
  }

  const totalAmount = filtered.reduce((s, r) => s + (Number(r.total) || 0), 0);
  return { rows: pageRows, count, totalAmount };
}

/* ========= 下單（DB 依 delivery_info 判斷是否為 Delivery） ========= */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  // 絕對不要傳 p_channel，避免「cannot insert a non-DEFAULT value into column 'channel'」
  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {}, // 交給 DB 判斷 Delivery
    // 打破 RPC overloading 歧義（若你的 DB 還留著舊版 place_order）
    p_fail_when_insufficient: false,
  });
  if (error) throw error;
  return data as string; // order id
}

export async function placeDelivery(
  items: PlaceOrderItem[],
  paymentMethod: string,
  info: DeliveryInfo,
  deliveryFee = 0,
  status: "ACTIVE" | "VOIDED" = "ACTIVE"
) {
  return placeOrder(items, paymentMethod, status, {
    deliveryInfo: info,
    deliveryFee,
  });
}

/* ========= 作廢（仍走 RPC） ========= */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

// 可留空（若 DB 已在 void_order 內回補庫存）
export async function restockByOrder(_orderId: string) {
  return;
}

/* ========= （可選）供 Dashboard 使用：簡單營收統計 ========= */
export async function fetchRevenueSummary(params: Omit<FetchParams, "channel" | "page" | "pageSize">) {
  // 取足量資料在前端彙總（規模小時很方便）
  const { rows } = await fetchOrders({ ...params, channel: "ALL", page: 0, pageSize: 1000 });
  const active = rows.filter(r => !r.voided);
  const instore = active.filter(r => !r.isDelivery);
  const delivery = active.filter(r => r.isDelivery);
  const sum = (arr: any[]) => arr.reduce((s, r) => s + (Number(r.total) || 0), 0);
  return {
    orderRevenue: sum(instore),
    deliveryRevenue: sum(delivery),
    countOrders: instore.length,
    countDeliveries: delivery.length,
  };
}
