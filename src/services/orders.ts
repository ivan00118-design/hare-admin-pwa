// src/services/orders.ts
import { supabase } from "../supabaseClient";

/** ========= 型別 ========= */

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
  /** 出貨清單用（可省略，DB 端會預設 PENDING） */
  ship_status?: "PENDING" | "CLOSED" | null;
};

export type PlaceOrderOptions = {
  /** 不再由前端直接傳 channel；由 deliveryInfo 是否有值在 DB 端判斷是否外送 */
  deliveryFee?: number;
  deliveryInfo?: DeliveryInfo | null;
  status?: "ACTIVE" | "VOIDED";
};

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;                        // "all" | "active" | "voided"
  channel?: "ALL" | "IN_STORE" | "DELIVERY";// 可選（同時相容 is_delivery）
  page?: number;
  pageSize?: number;
}

/** ========= 小工具 ========= */

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

/** ========= 出貨清單（完全 DB 化） ========= */

export type ShipStatus = "PENDING" | "CLOSED";
export type ShippingRow = {
  id: string;
  created_at: string;
  status: string;                // orders.status（ACTIVE / VOIDED）
  payment_method: string | null;
  total: number;
  channel: "DELIVERY" | "IN_STORE" | null;
  delivery_json: any;
  ship_status: ShipStatus | null;
  customer_name: string | null;
  items_count: number;
};

/** 讀取出貨清單（直接查 View v_shipping_list_compat；若你用的是 table delivery_shipments，也可改查該表） */
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

/** 設定單筆出貨狀態（先試 RPC set_delivery_ship_status；若沒有 RPC，回退為直接更新 orders.delivery_info->ship_status） */
export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus) {
  // 1) 先嘗試 RPC（建議）
  try {
    const rpc = await supabase.rpc("set_delivery_ship_status", {
      p_order_id: orderId,
      p_ship_status: shipStatus,
    });
    if (!rpc.error) return;
  } catch {
    // ignore，改用 fallback
  }

  // 2) Fallback：把 delivery_info 取出後回寫（保留其餘欄位）
  const sel = await supabase
    .from("orders")
    .select("delivery_info")
    .eq("id", orderId)
    .maybeSingle();

  if (sel.error) throw sel.error;

  const prev = (sel.data as any)?.delivery_info ?? {};
  const next = { ...prev, ship_status: shipStatus };

  const upd = await supabase
    .from("orders")
    .update({ delivery_info: next })
    .eq("id", orderId);

  if (upd.error) throw upd.error;
}

/** ========= 查詢訂單（orders + order_items 分段抓） =========
 * 相容兩種 schema：
 *  - 新：channel / delivery_info
 *  - 舊：is_delivery / delivery
 * 並回傳 totalAmount，History 可直接顯示。
 */
export async function fetchOrders({
  from, to, status = "all", channel = "ALL",
  page = 0, pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // --- 先以「舊欄位」為主（is_delivery / delivery），若 DB 沒有再回退「新欄位」（channel / delivery_info） ---
  const buildLegacy = () => {
    let q = supabase
      .from("orders")
      .select(`
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
      `, { count: "exact" })
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
      .select(`
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
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel === "IN_STORE") q = q.eq("channel", "IN_STORE");
    if (channel === "DELIVERY") q = q.eq("channel", "DELIVERY");

    return q.range(fromIdx, toIdx);
  };

  // 嘗試 legacy；若查詢錯誤（多半是欄位不存在），就改走 channel
  let ordRes = await buildLegacy();
  if (ordRes.error?.code === "42703" /* 未知欄位 */) {
    ordRes = await buildChannel();
  } else if (ordRes.error) {
    throw ordRes.error;
  }

  // 先把 orders 正規化
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

  // 以 order_id IN (...) 抓 order_items，解決 History 細項為 0 的問題
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

/** ========= 下單（由 DB 觸發器自動寫 Shipping List） =========
 * 只需把 deliveryInfo 帶進去（有值＝外送單），其餘交給 DB 的 place_order RPC + 觸發器處理。
 */
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
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    // 不再直接傳 channel，由 DB 依 delivery_info 判斷是否外送
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},
    // 這一行用來打破「函式重載歧義 (PGRST203)」
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
  // 外送單同樣走 placeOrder，但只傳 deliveryInfo / deliveryFee
  return placeOrder(items, paymentMethod, status, {
    deliveryInfo: info,
    deliveryFee,
  });
}

/** ========= 作廢（DB 端可同時處理回補庫存） ========= */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

export async function restockByOrder(_orderId: string) {
  // 如需回補庫存可在 DB 端 void_order 內處理；前端維持空殼
  return;
}
