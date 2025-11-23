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
  scheduled_at?: string | null;
  ship_status?: "PENDING" | "CLOSED" | null;
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

// ---------- 小工具 ----------
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString(); }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x.toISOString(); }

// ---------- 查詢訂單（雙路徑 + 關聯 items） ----------
export async function fetchOrders({
  from, to, status = "all", channel = "ALL", page = 0, pageSize = 100,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {

  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // 先嘗試新版欄位（channel/delivery_info），錯了再走舊版（is_delivery/delivery）
  const runChannel = async () => {
    let q = supabase.from("orders").select(`
      id, created_at, status, payment_method,
      total, delivery_fee, channel, delivery_info,
      is_delivery, delivery,
      void_reason, voided_at
    `, { count: "exact" }).order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel === "IN_STORE") q = q.eq("channel", "IN_STORE");
    if (channel === "DELIVERY") q = q.eq("channel", "DELIVERY");
    return q.range(fromIdx, toIdx);
  };

  const runLegacy = async () => {
    let q = supabase.from("orders").select(`
      id, created_at, status, payment_method,
      total, delivery_fee, is_delivery, delivery,
      void_reason, voided_at
    `, { count: "exact" }).order("created_at", { ascending: false });

    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel === "IN_STORE") q = q.eq("is_delivery", false);
    if (channel === "DELIVERY") q = q.eq("is_delivery", true);
    return q.range(fromIdx, toIdx);
  };

  let res: any;
  try {
    res = await runChannel();
    if (res.error) throw res.error;
  } catch {
    res = await runLegacy();
    if (res.error) throw res.error;
  }

  // 整理成 UI rows（最重要：isDelivery 的兼容判斷）
  const baseRows = (res.data ?? []).map((r: any) => {
    const deliveryFlag =
      (typeof r.is_delivery !== "undefined" ? !!r.is_delivery : false) ||
      (r.channel ? r.channel === "DELIVERY" : false) ||
      (!!r.delivery_info) ||
      (!!r.delivery) ||
      ((Number(r.delivery_fee) || 0) > 0);

    return {
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery: deliveryFlag,
      delivery: typeof r.delivery !== "undefined" ? r.delivery : (r.delivery_info ?? null),
      items: [] as any[],
      channel: r.channel ?? (deliveryFlag ? "DELIVERY" : "IN_STORE"), // 提供 Dashboard 顯示用
    };
  });

  // 一次抓回 order_items 並關聯
  const ids = baseRows.map((r: any) => r.id);
  if (ids.length > 0) {
    const its = await supabase
      .from("order_items")
      .select("order_id,name,category,sub_key,grams,qty,price,sku")
      .in("order_id", ids);

    if (!its.error) {
      const byOrder = new Map<string, any[]>();
      for (const it of (its.data ?? []) as any[]) {
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
  }

  const totalAmount = baseRows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
  return { rows: baseRows, count: res.count ?? 0, totalAmount };
}

// ---------- 下單（建議仍呼叫你現有的 place_order；這裡保留 wrapper） ----------
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: { deliveryFee?: number; deliveryInfo?: DeliveryInfo | null; status?: "ACTIVE" | "VOIDED" } = {}
) {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    // 不直接寫 channel 以避免「cannot insert a non-DEFAULT value into column 'channel'」
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},  // 有值即可被視為外送（v_shipping_list_compat 也會抓到）
    p_fail_when_insufficient: false,
  });
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
  return placeOrder(items, paymentMethod, status, {
    deliveryInfo: info,
    deliveryFee,
  });
}

// ---------- Shipping List（完全 DB 化） ----------
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
  const { error } = await supabase.rpc("set_delivery_ship_status", {
    p_order_id: orderId,
    p_ship_status: shipStatus,
  });
  if (error) throw error;
}

// ---------- 作廢 ----------
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}
