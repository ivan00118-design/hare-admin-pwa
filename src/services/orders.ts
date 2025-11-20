// src/services/orders.ts
import { supabase } from "../supabaseClient";

// ---------- 型別 ----------
export type UIStatus = "all" | "active" | "voided";

export type PlaceOrderItem = {
  name: string;
  sku?: string | null;
  qty: number;
  price: number;                         // 與 DB 單位一致（元或分）
  category?: "HandDrip" | "drinks";
  grams?: number;                        // 豆子品項才有
  sub_key?: "espresso" | "singleOrigin";// 飲品才有
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;         // ISO 字串（可選）
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
  channel?: "ALL" | "IN_STORE" | "DELIVERY";       // ⬅ 可選：只抓某通路
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

// ---------- 查詢訂單（支援 channel 過濾，回傳 items_total / delivery_fee / channel） ----------
export async function fetchOrders({
  from, to, status = "all", channel = "ALL", page = 0, pageSize = 20,
}: FetchParams) {
  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;

  let q = supabase
    .from("orders")
    .select(`
      id, created_at, status, payment_method,
      items_total, delivery_fee, total, channel, delivery_info,
      void_reason, voided_at,
      order_items ( name, category, sub_key, grams, qty, price, sku )
    `, { count: "exact" })
    .order("created_at", { ascending: false });

  if (fromISO) q = q.gte("created_at", fromISO);
  if (toISO)   q = q.lte("created_at", toISO);
  if (status !== "all") q = q.eq("status", status.toUpperCase());
  if (channel !== "ALL") q = q.eq("channel", channel);

  const fromIdx = page * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  const { data, error, count } = await q.range(fromIdx, toIdx);
  if (error) throw error;

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    createdAt: r.created_at,
    paymentMethod: r.payment_method,
    itemsTotal: r.items_total,
    deliveryFee: r.delivery_fee,
    total: r.total,
    channel: r.channel as ("IN_STORE" | "DELIVERY"),
    deliveryInfo: r.delivery_info ?? {},
    voided: r.status === "VOIDED",
    voidReason: r.void_reason ?? null,
    voidedAt: r.voided_at ?? null,
    items: r.order_items ?? [],
  }));

  return { rows, count: count ?? 0 };
}

// ---------- 下單（支援通路/運費/配送資訊） ----------
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,                        // 商品合計
    p_status: opts.status ?? status,
    p_channel: opts.channel ?? "IN_STORE",      // IN_STORE / DELIVERY
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},
  });
  if (error) throw error;
  return data as string; // order id
}

// 小幫手：Delivery 包裝（讓頁面可以 import { placeDelivery }）
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

// ---------- 作廢訂單（保留你原本流程） ----------
export async function voidOrderDB(orderId: string, opts?: { reason?: string }) {
  const { error } = await supabase
    .from("orders")
    .update({
      status: "VOIDED",
      void_reason: opts?.reason ?? null,
      voided_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) throw error;
}

// （預留）若需回補庫存可在此實作
export async function restockByOrder(_orderId: string) {
  return;
}
