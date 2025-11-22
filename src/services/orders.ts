// src/services/orders.ts
import { supabase } from "../supabaseClient";

// ---------- 型別 ----------
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
  scheduled_at?: string | null;         // ISO 字串（可選）

  // ⬇⬇ 新增：出貨狀態（出貨清單用），預設 PENDING
  ship_status?: "PENDING" | "CLOSED" | null;
};

// 設定出貨狀態：先試 RPC set_delivery_ship_status，若沒有則 fallback 成一般 update
export async function setOrderShipStatus(
  orderId: string,
  shipStatus: "PENDING" | "CLOSED"
) {
  // 1) 嘗試 RPC（如果你有建）
  try {
    const rpc = await supabase.rpc("set_delivery_ship_status", {
      p_order_id: orderId,
      p_ship_status: shipStatus,
    });
    if (!rpc.error) return;
  } catch { /* ignore and fallback */ }

  // 2) Fallback：讀出原本 delivery_info 後回寫（保留其他欄位）
  const { data, error: selErr } = await supabase
    .from("orders")
    .select("delivery_info")
    .eq("id", orderId)
    .maybeSingle();

  if (selErr) throw selErr;

  const prev = (data as any)?.delivery_info ?? {};
  const next = { ...prev, ship_status: shipStatus };

  const { error: updErr } = await supabase
    .from("orders")
    .update({ delivery_info: next })
    .eq("id", orderId);

  if (updErr) throw updErr;
}


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
  channel?: "ALL" | "IN_STORE" | "DELIVERY";       // 可選
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

// ---------- 查詢訂單（雙查詢：orders + order_items.in(order_id, ids)） ----------
export async function fetchOrders({
  from, to, status = "all",
  channel = "ALL",
  page = 0, pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  
  // 先以「舊欄位」為主（is_delivery / delivery），若 DB 沒有再回退「新欄位」（channel / delivery_info）
  const buildLegacy = () => {
    let q = supabase
      .from("orders")
      .select(
        `
        id,
        created_at,
        status,
        payment_method,
        total,
        delivery_fee,
        is_delivery,
        delivery,
        void_reason,
        voided_at
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel === "IN_STORE") q = q.eq("is_delivery", false);
    if (channel === "DELIVERY") q = q.eq("is_delivery", true);

    return q.range(fromIdx, toIdx);
  };

  const buildChannel = () => {
    let q = supabase
      .from("orders")
      .select(
        `
        id,
        created_at,
        status,
        payment_method,
        total,
        delivery_fee,
        channel,
        delivery_info,
        void_reason,
        voided_at
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel === "IN_STORE") q = q.eq("channel", "IN_STORE");
    if (channel === "DELIVERY") q = q.eq("channel", "DELIVERY");

    return q.range(fromIdx, toIdx);
  };

  // 先嘗試 legacy，失敗再用 channel
  let ordRes = await buildLegacy();

  // 先把 orders 轉成統一 UI 欄位
  const baseRows = (ordRes.data ?? []).map((r: any) => ({
    id: r.id,
    createdAt: r.created_at,
    paymentMethod: r.payment_method,
    total: r.total,
    deliveryFee: r.delivery_fee ?? 0,
    voided: r.status === "VOIDED",
    voidReason: r.void_reason ?? null,
    voidedAt: r.voided_at ?? null,
    isDelivery: typeof r.is_delivery !== "undefined"
      ? !!r.is_delivery
      : (r.channel ? r.channel === "DELIVERY" : false),
    delivery: typeof r.delivery !== "undefined" ? r.delivery : (r.delivery_info ?? null),
    items: [] as any[],
  }));

  const ids = baseRows.map(r => r.id);
  if (ids.length === 0) {
    return { rows: baseRows, count: ordRes.count ?? 0, totalAmount: 0 };
  }

  // 再把 order_items 一次抓回來並關聯
  const itsRes = await supabase
    .from("order_items")
    .select("order_id,name,category,sub_key,grams,qty,price,sku")
    .in("order_id", ids);

  if (!itsRes.error) {
    const byOrder = new Map<string, any[]>();
    for (const it of itsRes.data ?? []) {
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
    for (const r of baseRows) r.items = byOrder.get(r.id) ?? [];
  }

  const totalAmount = baseRows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
  return { rows: baseRows, count: ordRes.count ?? 0, totalAmount };
}

// ---------- 下單（支援通路/運費/配送資訊；含舊版 RPC 向後相容） ----------
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: {
    // ⛔️ 這裡不要再交由呼叫端傳 channel
    deliveryFee?: number;
    deliveryInfo?: DeliveryInfo | null;
    // 可選：仍可覆寫狀態
    status?: "ACTIVE" | "VOIDED";
  } = {}
) {
  const itemsTotal = items.reduce(
    (s, it) => s + Number(it.qty) * Number(it.price),
    0
  );

  // 新版 RPC 參數（建議）
  const payload: Record<string, any> = {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},     // DB 依這個判斷是否為外送
    // 解除 RPC overloading（PGRST203）
    p_fail_when_insufficient: false,
  };

  const { data, error } = await supabase.rpc("place_order", payload);
  if (error) throw error;
  return data as string;
  }

export async function placeDelivery(
  items: PlaceOrderItem[],
  paymentMethod: string,
  info: DeliveryInfo,
  deliveryFee = 0,
  status: "ACTIVE" | "VOIDED" = "ACTIVE"
) {
  // 外送單同樣走 placeOrder，但只傳 deliveryInfo / deliveryFee
  return placeOrder(items, paymentMethod, status, {
    deliveryInfo: info,
    deliveryFee,
  });
}

// ---------- 作廢（走 RPC；若你有回補庫存可在 DB 端處理） ----------
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const res = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (res.error) throw res.error;
}

export async function restockByOrder(_orderId: string) {
  // DB 端若已有回補庫存邏輯，可在 void_order 內處理；這裡保留接口即可。
  return;
}
