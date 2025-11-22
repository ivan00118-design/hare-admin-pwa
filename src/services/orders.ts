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
  // 供 Shipping List 用
  ship_status?: "PENDING" | "CLOSED" | null;
};

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;                               // "all" | "active" | "voided"
  channel?: "ALL" | "IN_STORE" | "DELIVERY";       // 可選
  page?: number;
  pageSize?: number;
}

export type FetchOrdersResult = {
  rows: Array<{
    id: string;
    createdAt: string;
    paymentMethod?: string | null;
    total: number;
    deliveryFee?: number;
    voided?: boolean;
    voidReason?: string | null;
    voidedAt?: string | null;
    isDelivery?: boolean;
    channel?: "IN_STORE" | "DELIVERY" | null;
    delivery?: any | null;
    items: Array<{
      name: string;
      category?: string | null;
      subKey?: "espresso" | "singleOrigin" | null;
      grams?: number | null;
      qty: number;
      price: number;
      sku?: string | null;
    }>;
  }>;
  count: number;
  totalAmount: number;
};

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
function nonEmptyObject(obj: any) {
  return obj && typeof obj === "object" && Object.keys(obj).length > 0;
}

// ---------- 查詢訂單（雙路徑：新版 channel/delivery_info 與舊版 is_delivery/delivery） ----------
export async function fetchOrders({
  from, to, status = "all",
  channel = "ALL",
  page = 0, pageSize = 20,
}: FetchParams): Promise<FetchOrdersResult> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // --- A) 新版（有 channel / delivery_info）
  const runNew = () => {
    let q = supabase
      .from("orders")
      .select(`
        id, created_at, status, payment_method, total, delivery_fee,
        channel, delivery_info,
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

  // --- B) 舊版（is_delivery / delivery）
  const runLegacy = () => {
    let q = supabase
      .from("orders")
      .select(`
        id, created_at, status, payment_method, total, delivery_fee,
        is_delivery, delivery,
        void_reason, voided_at,
        order_items ( name, category, sub_key, grams, qty, price, sku )
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    // 舊版沒有 channel 欄位，channel 過濾略過
    return q.range(fromIdx, toIdx);
  };

  // 先走新版，若 400/不存在欄位則回退舊版
  try {
    const resp = await runNew();
    if (resp.error) throw resp.error;
    const rows = (resp.data ?? []).map((r: any) => {
      const looksLikeDelivery =
        (r.channel && r.channel === "DELIVERY") ||
        nonEmptyObject(r.delivery_info) ||
        Number(r.delivery_fee ?? 0) > 0;

      return {
        id: r.id,
        createdAt: r.created_at,
        paymentMethod: r.payment_method,
        total: Number(r.total) || 0,
        deliveryFee: Number(r.delivery_fee ?? 0),
        voided: r.status === "VOIDED",
        voidReason: r.void_reason ?? null,
        voidedAt: r.voided_at ?? null,
        isDelivery: looksLikeDelivery,
        channel: (r.channel ?? null) as any,
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
      };
    });

    const totalAmount = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { rows, count: resp.count ?? 0, totalAmount };

  } catch {
    const resp = await runLegacy();
    if (resp.error) throw resp.error;
    const rows = (resp.data ?? []).map((r: any) => {
      const looksLikeDelivery =
        r.is_delivery === true ||
        nonEmptyObject(r.delivery) ||
        Number(r.delivery_fee ?? 0) > 0;

      return {
        id: r.id,
        createdAt: r.created_at,
        paymentMethod: r.payment_method,
        total: Number(r.total) || 0,
        deliveryFee: Number(r.delivery_fee ?? 0),
        voided: r.status === "VOIDED",
        voidReason: r.void_reason ?? null,
        voidedAt: r.voided_at ?? null,
        isDelivery: looksLikeDelivery,
        channel: null as any,
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
      };
    });

    const totalAmount = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { rows, count: resp.count ?? 0, totalAmount };
  }
}

// ---------- 下單（Delivery 單只要傳 deliveryInfo；門市單請傳 null） ----------
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: { deliveryFee?: number; deliveryInfo?: DeliveryInfo | null; status?: "ACTIVE" | "VOIDED" } = {}
) {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  // 僅在「有 deliveryInfo」時才傳入（避免用 {} 造成被視為 Delivery）
  const info = opts.deliveryInfo
    ? { ...opts.deliveryInfo, ship_status: opts.deliveryInfo.ship_status ?? "PENDING" }
    : null;

  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: info,              // ⬅ 門市請是 null；Delivery 才是 JSON
    // 解除函式 overloading 歧義（若 DB 有此參數）
    p_fail_when_insufficient: false,
  });
  if (error) throw error;
  return data as string;
}

// 小幫手：Delivery 包裝
export async function placeDelivery(
  items: PlaceOrderItem[],
  paymentMethod: string,
  info: DeliveryInfo,
  deliveryFee = 0,
  status: "ACTIVE" | "VOIDED" = "ACTIVE"
) {
  return placeOrder(items, paymentMethod, status, {
    deliveryInfo: { ...info, ship_status: info.ship_status ?? "PENDING" },
    deliveryFee,
  });
}

// ---------- 作廢 ----------
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const res = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (res.error) throw res.error;
}

// （預留）若需回補庫存可在此實作
export async function restockByOrder(_orderId: string) { return; }
