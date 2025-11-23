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
  status?: UIStatus;                         // "all" | "active" | "voided"
  channel?: "ALL" | "IN_STORE" | "DELIVERY"; // 相容舊 is_delivery
  page?: number;
  pageSize?: number;
}

/* ========= 小工具 ========= */
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

/* ========= 訂單查詢：兩階段抓單 + items in(...) 關聯 ========= */
export async function fetchOrders({
  from, to, status = "all", channel = "ALL", page = 0, pageSize = 20,
}: FetchParams = {}): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // 依是否支援 channel / delivery_info 嘗試不同欄位集合
  const selectWith = (withChannel: boolean) =>
    withChannel
      ? `
        id, created_at, status, payment_method, total, delivery_fee,
        channel, delivery_info, is_delivery, delivery,
        void_reason, voided_at
      `
      : `
        id, created_at, status, payment_method, total, delivery_fee,
        is_delivery, delivery,
        void_reason, voided_at
      `;

  async function run(withChannel: boolean) {
    let q: any = supabase
      .from("orders")
      .select(selectWith(withChannel), { count: "exact" })
      .order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());

    if (withChannel) {
      if (channel === "IN_STORE")  q = q.eq("channel", "IN_STORE");
      if (channel === "DELIVERY")  q = q.eq("channel", "DELIVERY");
    } else {
      if (channel === "IN_STORE")  q = q.eq("is_delivery", false);
      if (channel === "DELIVERY")  q = q.eq("is_delivery", true);
    }
    return q.range(fromIdx, toIdx);
  }

  let ordRes: any = await run(true);
  if (ordRes.error) ordRes = await run(false); // 兼容舊 schema

  // 統一前端欄位
  const baseRows: any[] = (ordRes.data ?? []).map((r: any) => {
    const hasChannel = typeof r?.channel === "string";
    const legacyFlag = typeof r?.is_delivery === "boolean" ? !!r.is_delivery : undefined;
    const hasDeliveryJson = !!(r?.delivery_info ?? r?.delivery);
    const deliveryFee = Number(r?.delivery_fee) || 0;

    const isDelivery =
      hasChannel ? r.channel === "DELIVERY"
      : legacyFlag !== undefined ? legacyFlag
      : (hasDeliveryJson || deliveryFee > 0);

    return {
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: Number(r.total) || 0,
      deliveryFee,
      voided: String(r.status || "").toUpperCase() === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery,
      delivery: r.delivery_info ?? r.delivery ?? null,
      items: [] as any[],
    };
  });

  const ids = baseRows.map((x) => x.id);
  if (ids.length > 0) {
    const itsRes: any = await supabase
      .from("order_items")
      .select("order_id,name,category,sub_key,grams,qty,price,sku")
      .in("order_id", ids);

    if (!itsRes.error) {
      const byOrder = new Map<string, any[]>();
      for (const it of (itsRes.data ?? []) as any[]) {
        const k = String(it.order_id);
        if (!byOrder.has(k)) byOrder.set(k, []);
        byOrder.get(k)!.push({
          name: it.name,
          category: it.category ?? null,
          subKey: it.sub_key ?? null,
          grams: typeof it.grams === "number" ? it.grams : (it.grams ?? null),
          qty: Number(it.qty) || 0,
          price: Number(it.price) || 0,
          sku: it.sku ?? null,
        });
      }
      for (const r of baseRows) r.items = byOrder.get(String(r.id)) ?? [];
    }
  }

  const totalAmount = baseRows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
  return { rows: baseRows, count: ordRes.count ?? baseRows.length, totalAmount };
}

/* ========= 下單（通用版；以 delivery_info 判斷外送） ========= */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce((s: number, it) => s + Number(it.qty) * Number(it.price), 0);
  const payload: Record<string, any> = {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},        // 有值即視為外送
    // 預留解除 overloading 的參數（若 DB 端需要）
    p_fail_when_insufficient: false,
  };

  // 以單一 RPC 名稱 place_order 為準；若 DB 無此參數版，移除後重試
  try {
    const { data, error } = await supabase.rpc("place_order", payload);
    if (error) throw error;
    return data as string;
  } catch (_e) {
    const { data, error } = await supabase.rpc("place_order", {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
      p_delivery_fee: opts.deliveryFee ?? 0,
      p_delivery_info: opts.deliveryInfo ?? {},
    });
    if (error) throw error;
    return data as string;
  }
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

/* ========= 作廢 ========= */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const res = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (res.error) throw res.error;
}

/* ========= Shipping List（完全 DB 化） ========= */
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

export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus) {
  const rpc = await supabase.rpc("set_delivery_ship_status", {
    p_order_id: orderId,
    p_ship_status: shipStatus,
  });
  if (!rpc.error) return;

  // Fallback：直接在 orders.delivery_info 寫入 ship_status
  const sel = await supabase.from("orders").select("delivery_info").eq("id", orderId).maybeSingle();
  if (sel.error) throw sel.error;
  const prev = (sel.data as any)?.delivery_info ?? {};
  const next = { ...prev, ship_status: shipStatus };
  const upd = await supabase.from("orders").update({ delivery_info: next }).eq("id", orderId);
  if (upd.error) throw upd.error;
}
