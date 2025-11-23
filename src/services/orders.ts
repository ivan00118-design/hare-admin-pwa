// src/services/orders.ts
import { supabase } from "../supabaseClient";

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
  ship_status?: "PENDING" | "CLOSED" | null; // 出貨清單用
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
  status?: UIStatus;
  channel?: "ALL" | "IN_STORE" | "DELIVERY";
  page?: number;
  pageSize?: number;
}

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

/** 查單：新舊欄位相容，並統一產生 isDelivery（Dashboard 依此分流 Revenue）。 */
export async function fetchOrders({
  from, to, status = "all",
  channel = "ALL",
  page = 0, pageSize = 40,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // 先走新版（channel / delivery_info）
  const runChannel = async () => {
    let q = supabase
      .from("orders")
      .select(`
        id, created_at, status, payment_method,
        total, delivery_fee, channel, delivery_info,
        void_reason, voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel !== "ALL") q = q.eq("channel", channel);

    return q.range(fromIdx, toIdx);
  };

  // 再回退舊版（is_delivery / delivery）
  const runLegacy = async () => {
    let q = supabase
      .from("orders")
      .select(`
        id, created_at, status, payment_method,
        total, delivery_fee, is_delivery, delivery,
        void_reason, voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());

    return q.range(fromIdx, toIdx);
  };

  try {
    const ch = await runChannel();
    if (ch.error) throw ch.error;

    const rows: any[] = (ch.data ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      // 供 Dashboard 分類使用（你的拆分邏輯參考此欄位）。:contentReference[oaicite:1]{index=1}
      isDelivery: r.channel ? r.channel === "DELIVERY" : false,
      channel: r.channel ?? null,
      delivery: r.delivery_info ?? null,
      items: (r.order_items ?? []).map((it: any) => ({
        name: it.name,
        category: it.category ?? null,
        subKey: it.sub_key ?? null,
        grams: typeof it.grams === "number" ? it.grams : (it.grams ?? null),
        qty: it.qty,
        price: it.price,
        sku: it.sku ?? null,
      })),
    }));

    const totalAmount = rows.reduce((s: number, rr: any) => s + (Number(rr.total) || 0), 0);
    return { rows, count: ch.count ?? 0, totalAmount };
  } catch (_e) {
    const lg = await runLegacy();
    if (lg.error) throw lg.error;

    const rows: any[] = (lg.data ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery: !!r.is_delivery, // 舊欄位
      channel: !!r.is_delivery ? "DELIVERY" : "IN_STORE",
      delivery: r.delivery ?? null,
      items: (r.order_items ?? []).map((it: any) => ({
        name: it.name,
        category: it.category ?? null,
        subKey: it.sub_key ?? null,
        grams: typeof it.grams === "number" ? it.grams : (it.grams ?? null),
        qty: it.qty,
        price: it.price,
        sku: it.sku ?? null,
      })),
    }));

    const totalAmount = rows.reduce((s: number, rr: any) => s + (Number(rr.total) || 0), 0);
    return { rows, count: lg.count ?? 0, totalAmount };
  }
}

/** 下單（支援外送/運費/配送資訊；以 delivery_info 是否有值自動判別通路） */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: { deliveryFee?: number; deliveryInfo?: DeliveryInfo | null; status?: "ACTIVE" | "VOIDED" } = {}
) {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);
  const payload: Record<string, any> = {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {}, // 有值即視為外送
    // 防止 PostgREST 重載歧義
    p_fail_when_insufficient: false,
  };
  const { data, error } = await supabase.rpc("place_order", payload);
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

/** 出貨清單 Row 型別（對應 v_shipping_list_compat） */
export type ShipStatus = "PENDING" | "CLOSED";
export type ShippingRow = {
  id: string;
  created_at: string;
  status: string;
  payment_method: string | null;
  total: number;
  delivery_fee: number;
  channel: "DELIVERY" | "IN_STORE";
  delivery_json: any;
  ship_status: ShipStatus | null;
  customer_name: string | null;
  items_count: number;
};

/** 讀：出貨清單（完全 DB 化，直接查 view） */
export async function listShipping(status: ShipStatus, limit = 200): Promise<ShippingRow[]> {
  const { data, error } = await supabase
    .from("v_shipping_list_compat")
    .select("*")
    .eq("ship_status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ShippingRow[];
}

/** 寫：設定出貨狀態（RPC； fallback 已在 DB 端處理） */
export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus): Promise<void> {
  const { error } = await supabase.rpc("set_delivery_ship_status", {
    p_order_id: orderId,
    p_ship_status: shipStatus,
  });
  if (error) throw error;
}

/** 作廢（保留你原有流程） */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

export async function restockByOrder(_orderId: string) {
  return;
}
