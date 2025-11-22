// src/services/orders.ts
import { supabase } from "../supabaseClient";

/* ---------- 型別 ---------- */
export type UIStatus = "all" | "active" | "voided";

export type PlaceOrderItem = {
  name: string;
  sku?: string | null;
  qty: number;
  price: number;                         // 與 DB 單位一致
  category?: "HandDrip" | "drinks";
  grams?: number;                        // 豆子品項才有
  sub_key?: "espresso" | "singleOrigin";// 飲品才有
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;         // ISO 字串
  ship_status?: "PENDING" | "CLOSED" | null; // 出貨清單用
};

export type PlaceOrderOptions = {
  deliveryFee?: number;
  deliveryInfo?: DeliveryInfo | null;
  status?: "ACTIVE" | "VOIDED";
};

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;                               // "all" | "active" | "voided"
  channel?: "ALL" | "IN_STORE" | "DELIVERY";       // 若 DB 沒欄位會在客端過濾
  page?: number;
  pageSize?: number;
}

/* ---------- 小工具 ---------- */
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
function safeIsDelivery(row: any): boolean {
  // 1) 有 is_delivery 就用
  if (typeof row?.is_delivery === "boolean") return !!row.is_delivery;
  // 2) 有 channel 就用
  if (typeof row?.channel === "string") return row.channel === "DELIVERY";
  // 3) 保險：只要 delivery json 有內容或 delivery_fee > 0，也視為外送
  const hasInfo =
    (row?.delivery_info && Object.keys(row.delivery_info || {}).length > 0) ||
    (row?.delivery && Object.keys(row.delivery || {}).length > 0) ||
    (Number(row?.delivery_fee) || 0) > 0;
  return !!hasInfo;
}

/* ---------- 查詢訂單（雙查詢：orders + order_items） ---------- */
export async function fetchOrders({
  from, to, status = "all", channel = "ALL",
  page = 0, pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // 優先嘗試同時撈「新舊欄位」；若 400（欄位不存在）再退回只撈舊欄位
  const runWide = async () => {
    let q = supabase
      .from("orders")
      .select(`
        id, created_at, status, payment_method, total, delivery_fee,
        channel, is_delivery, delivery_info, delivery,
        void_reason, voided_at
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());

    return q.range(fromIdx, toIdx);
  };

  const runLegacy = async () => {
    let q = supabase
      .from("orders")
      .select(`
        id, created_at, status, payment_method, total, delivery_fee,
        is_delivery, delivery,
        void_reason, voided_at
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());

    return q.range(fromIdx, toIdx);
  };

  let ordRes: any;
  try {
    ordRes = await runWide();
    if (ordRes.error) throw ordRes.error;
  } catch (_e) {
    ordRes = await runLegacy();
    if (ordRes.error) throw ordRes.error;
  }

  // 先做 base rows
  const baseRows: any[] = (ordRes.data ?? []).map((r: any) => ({
    id: r.id,
    createdAt: r.created_at,
    paymentMethod: r.payment_method,
    total: r.total,
    deliveryFee: r.delivery_fee ?? 0,
    voided: r.status === "VOIDED",
    voidReason: r.void_reason ?? null,
    voidedAt: r.voided_at ?? null,
    // 客端穩健推斷 isDelivery（修正外送營收分類）
    isDelivery: safeIsDelivery(r),
    // 兩種 schema 的 delivery json 都接起來
    delivery: r.delivery_info ?? r.delivery ?? null,
    items: [] as any[],
  }));

  // 前端 channel 過濾（避免 DB 沒 channel 欄位時 400）
  const filteredRows =
    channel === "ALL"
      ? baseRows
      : baseRows.filter((o) =>
          channel === "DELIVERY" ? o.isDelivery : !o.isDelivery
        );

  const ids = filteredRows.map((r) => r.id);
  if (ids.length === 0) {
    return { rows: filteredRows, count: ordRes.count ?? 0, totalAmount: 0 };
  }

  // 再抓 order_items 並關聯
  const itsRes = await supabase
    .from("order_items")
    .select("order_id,name,category,sub_key,grams,qty,price,sku")
    .in("order_id", ids);

  if (!itsRes.error) {
    const byOrder = new Map<string, any[]>();
    for (const it of (itsRes.data ?? []) as any[]) {
      if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
      byOrder.get(it.order_id)!.push({
        name: it.name,
        category: it.category ?? null,
        subKey: it.sub_key ?? null,
        grams: typeof it.grams === "number" ? it.grams : (it.grams ?? null),
        qty: it.qty,
        price: it.price,
        sku: it.sku ?? null,
      });
    }
    for (const r of filteredRows) r.items = byOrder.get(r.id) ?? [];
  }

  const totalAmount = filteredRows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
  return { rows: filteredRows, count: ordRes.count ?? 0, totalAmount };
}

/* ---------- 下單（支援外送；不傳 p_channel，靠 delivery_info 推斷） ---------- */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce((s: number, it: PlaceOrderItem) => s + Number(it.qty) * Number(it.price), 0);

  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {}, // 有值 → 會被視為外送（由上游推斷）
    // 破除 RPC overloading 歧義
    p_fail_when_insufficient: false,
  });
  if (error) throw error;
  return data as string;
}

export async function placeDelivery(
  items: PlaceOrderItem[],
  paymentMethod: string,
  info: DeliveryInfo,
  deliveryFee: number = 0,
  status: "ACTIVE" | "VOIDED" = "ACTIVE"
) {
  return placeOrder(items, paymentMethod, status, {
    deliveryInfo: info,
    deliveryFee,
  });
}

/* ---------- Shipping List（完全 DB 化 + 容錯） ---------- */
export type ShipStatus = "PENDING" | "CLOSED";

export type ShippingRow = {
  id: string;
  created_at: string;
  status: string;
  payment_method: string | null;
  total: number;
  channel: "DELIVERY" | "IN_STORE";
  delivery_json: any;
  ship_status: ShipStatus;
  customer_name: string | null;
  items_count: number;
};

/** 讀取出貨清單：優先 View，失敗則 orders 聚合 */
export async function listShipping(status: ShipStatus, limit = 200): Promise<ShippingRow[]> {
  // 1) 優先走 view
  try {
    const { data, error } = await supabase
      .from("v_shipping_list_compat")
      .select("*")
      .eq("ship_status", status)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    // 規範回傳
    return rows.map((r: any): ShippingRow => ({
      id: r.id,
      created_at: r.created_at,
      status: r.status,
      payment_method: r.payment_method ?? null,
      total: Number(r.total) || 0,
      channel: (r.channel === "DELIVERY" ? "DELIVERY" : "IN_STORE") as "DELIVERY" | "IN_STORE",
      delivery_json: r.delivery_info ?? r.delivery ?? null,
      ship_status: (r.ship_status === "CLOSED" ? "CLOSED" : "PENDING") as ShipStatus,
      customer_name: r.customer_name ?? r.delivery_json?.customer_name ?? null,
      items_count: Number(r.items_count) || 0,
    }));
  } catch {
    // 2) 回退：直接查 orders + order_items
    const { data: od, error: oe } = await supabase
      .from("orders")
      .select("id, created_at, status, payment_method, total, delivery_fee, channel, is_delivery, delivery_info, delivery")
      .order("created_at", { ascending: false })
      .limit(limit * 3); // 多抓一些，因為等等會再 filter
    if (oe) throw oe;

    const candidates = (od ?? []).filter((r: any) => safeIsDelivery(r));
    const withShip = candidates.map((r: any) => {
      const info = r.delivery_info ?? r.delivery ?? {};
      const shipStatus: ShipStatus = (info?.ship_status === "CLOSED") ? "CLOSED" : "PENDING";
      return { row: r, shipStatus, info };
    }).filter((x) => x.shipStatus === status);

    const ids = withShip.map((x) => x.row.id);
    const { data: its, error: ie } = await supabase
      .from("order_items")
      .select("order_id")
      .in("order_id", ids);
    if (ie) throw ie;

    const cnt = new Map<string, number>();
    for (const it of (its ?? []) as any[]) {
      cnt.set(it.order_id, (cnt.get(it.order_id) || 0) + 1);
    }

    return withShip.slice(0, limit).map(({ row, shipStatus, info }) => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status,
      payment_method: row.payment_method ?? null,
      total: Number(row.total) || 0,
      channel: (row.channel === "DELIVERY" || safeIsDelivery(row)) ? "DELIVERY" : "IN_STORE",
      delivery_json: info,
      ship_status: shipStatus,
      customer_name: info?.customer_name ?? null,
      items_count: cnt.get(row.id) || 0,
    }));
  }
}

/** 設定出貨狀態：先 RPC，沒有就更新 orders.delivery_info JSON */
export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus) {
  // 1) RPC
  try {
    const rpc = await supabase.rpc("set_delivery_ship_status", {
      p_order_id: orderId,
      p_ship_status: shipStatus,
    });
    if (!rpc.error) return;
  } catch {
    /* ignore */
  }
  // 2) Fallback：讀出原本 delivery 欄位後回寫（保留其他欄位）
  const sel = await supabase
    .from("orders")
    .select("delivery_info, delivery")
    .eq("id", orderId)
    .maybeSingle();
  if (sel.error) throw sel.error;

  const prevInfo = sel.data?.delivery_info ?? sel.data?.delivery ?? {};
  const nextInfo = { ...prevInfo, ship_status: shipStatus };

  const patch: Record<string, any> = {};
  if (sel.data && Object.prototype.hasOwnProperty.call(sel.data, "delivery_info")) {
    patch.delivery_info = nextInfo;
  } else {
    patch.delivery = nextInfo;
  }
  const upd = await supabase.from("orders").update(patch).eq("id", orderId);
  if (upd.error) throw upd.error;
}

/* ---------- 作廢（RPC；若需回補在 DB 端處理） ---------- */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const res = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (res.error) throw res.error;
}

export async function restockByOrder(_orderId: string) {
  return;
}
