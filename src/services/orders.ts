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
  grams?: number;                         // 豆子才有
  sub_key?: "espresso" | "singleOrigin";  // 飲品才有
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;          // ISO
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
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  // 新版 RPC 參數（建議）
  const fullArgs: Record<string, any> = {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_channel: opts.channel ?? "IN_STORE",
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},
    p_fail_when_insufficient: false,
  };

  let res = await supabase.rpc("place_order", fullArgs);

  // 若環境仍是舊簽名，回退到最小參數組（避免 PGRST203）
  if (res.error && String(res.error.message || "").toLowerCase().includes("could not choose")) {
    const legacyArgs = {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
    };
    res = await supabase.rpc("place_order", legacyArgs);
  }

  if (res.error) throw res.error;
  return res.data as string; // order id
}

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
