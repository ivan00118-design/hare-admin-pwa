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

// ---------- 查詢訂單（同時相容 channel 與 is_delivery；回傳 totalAmount） ----------
export async function fetchOrders({
  from,
  to,
  status = "all",
  channel = "ALL",                // 新版用法：IN_STORE / DELIVERY / ALL
  page = 0,
  pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {
  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // --- 1) 新版（有 channel / delivery_info / items_total 等欄位） ---
  const runChannel = () => {
    let q = supabase
      .from("orders")
      .select(
        `
        id, created_at, status, payment_method,
        items_total, delivery_fee, total, channel, delivery_info,
        void_reason, voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel !== "ALL") q = q.eq("channel", channel);

    return q.range(fromIdx, toIdx);
  };

  // --- 2) 舊版（is_delivery / delivery / delivery_fee） ---
  const runLegacy = () => {
    let q = supabase
      .from("orders")
      .select(
        `
        id,
        created_at,
        status,
        payment_method,
        total,
        is_delivery,
        delivery,
        delivery_fee,
        void_reason,
        voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    // 舊版沒有 channel 欄位，不處理 channel 篩選

    return q.range(fromIdx, toIdx);
  };

  // --- 嘗試新版，失敗時回退舊版 ---
  try {
    const ch = await runChannel();
    if (ch.error) throw ch.error;

    const rows =
      (ch.data ?? []).map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        paymentMethod: r.payment_method,
        total: Number(r.total) || 0,
        deliveryFee: r.delivery_fee ?? 0,
        voided: r.status === "VOIDED",
        voidReason: r.void_reason ?? null,
        voidedAt: r.voided_at ?? null,
        isDelivery: r.channel ? r.channel === "DELIVERY" : false,
        delivery: r.delivery_info ?? null,
        items: (r.order_items ?? []).map((it: any) => ({
          name: it.name,
          category: it.category ?? null,
          subKey: it.sub_key ?? null,
          grams: it.grams ?? null,
          qty: it.qty,
          price: it.price,
          sku: it.sku ?? null,
        })),
      })) as any[];

    const totalAmount = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { rows, count: ch.count ?? 0, totalAmount };
  } catch {
    const lg = await runLegacy();
    if (lg.error) throw lg.error;

    const rows =
      (lg.data ?? []).map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        paymentMethod: r.payment_method,
        total: Number(r.total) || 0,
        deliveryFee: r.delivery_fee ?? 0,
        voided: r.status === "VOIDED",
        voidReason: r.void_reason ?? null,
        voidedAt: r.voided_at ?? null,
        isDelivery: !!r.is_delivery,
        delivery: r.delivery ?? null,
        items: (r.order_items ?? []).map((it: any) => ({
          name: it.name,
          category: it.category ?? null,
          subKey: it.sub_key ?? null,
          grams: it.grams ?? null,
          qty: it.qty,
          price: it.price,
          sku: it.sku ?? null,
        })),
      })) as any[];

    const totalAmount = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { rows, count: lg.count ?? 0, totalAmount };
  }
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
    p_total: itemsTotal,                  // 商品合計
    p_status: opts.status ?? status,
    p_channel: opts.channel ?? "IN_STORE",// IN_STORE / DELIVERY
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},
    // 這一行用來打破函式重載的歧義（只有新版函式有這個參數）
    p_fail_when_insufficient: false,
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

// ---------- 作廢訂單（DB 端處理，必要時可回補庫存） ----------
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

// （預留）若需回補庫存可在此實作
export async function restockByOrder(_orderId: string) {
  return;
}
