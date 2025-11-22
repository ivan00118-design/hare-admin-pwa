// src/services/orders.ts
import { supabase } from "../supabaseClient";

/** --------- 型別 --------- */
export type UIStatus = "all" | "active" | "voided";

export type PlaceOrderItem = {
  name: string;
  sku?: string | null;
  qty: number;
  price: number; // 與 DB 單位一致
  category?: "HandDrip" | "drinks";
  grams?: number;
  sub_key?: "espresso" | "singleOrigin";
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null; // ISO
  ship_status?: "PENDING" | "CLOSED" | null; // 存在 delivery_info.ship_status
};

export type PlaceOrderOptions = {
  deliveryFee?: number;
  deliveryInfo?: DeliveryInfo | null;
  status?: "ACTIVE" | "VOIDED";
};

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;
  channel?: "ALL" | "IN_STORE" | "DELIVERY"; // 雙 schema 相容
  page?: number;
  pageSize?: number;
}

/** --------- 小工具 --------- */
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

/** --------- Shipping List（完全 DB 化） --------- */
export type ShipStatus = "PENDING" | "CLOSED";

export type ShippingRow = {
  id: string;
  created_at: string;
  status: string;
  payment_method: string | null;
  total: number;
  channel?: "DELIVERY" | "IN_STORE" | null;
  is_delivery?: boolean | null;
  delivery_json: any;
  ship_status: ShipStatus | null;
  customer_name: string | null;
  items_count: number;
};

/** 從 orders 直接產生出貨清單（相容 channel/is_delivery 與 delivery/delivery_info） */
export async function listShipping(status: ShipStatus, limit = 200): Promise<ShippingRow[]> {
  // 用 "*" 避免欄位差異造成 select 失敗
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const all = (data ?? []) as any[];

  const rows = all
    .map((r) => {
      const delivery_json = r.delivery_info ?? r.delivery ?? null;
      const channel = r.channel ?? null;
      const is_delivery = typeof r.is_delivery === "boolean" ? r.is_delivery : null;
      const consideredDelivery =
        channel === "DELIVERY" ||
        is_delivery === true ||
        (delivery_json != null && typeof delivery_json === "object");

      if (!consideredDelivery) return null;

      const ship = (delivery_json?.ship_status ?? null) as ShipStatus | null;
      const customer_name =
        (delivery_json?.customer_name ?? delivery_json?.recipient ?? null) as string | null;

      return {
        id: r.id as string,
        created_at: r.created_at as string,
        status: r.status as string,
        payment_method: r.payment_method ?? null,
        total: Number(r.total ?? 0),
        channel,
        is_delivery,
        delivery_json,
        ship_status: (ship ?? "PENDING") as ShipStatus,
        customer_name,
        items_count: 0,
      } as ShippingRow;
    })
    .filter(Boolean) as ShippingRow[];

  const filtered = rows.filter((r) => (r.ship_status ?? "PENDING") === status);

  // 取 items_count
  const ids = filtered.map((r) => r.id);
  if (ids.length > 0) {
    const its = await supabase
      .from("order_items")
      .select("order_id")
      .in("order_id", ids);
    if (!its.error) {
      const cnt = new Map<string, number>();
      for (const row of its.data ?? []) {
        cnt.set(row.order_id, (cnt.get(row.order_id) ?? 0) + 1);
      }
      for (const r of filtered) r.items_count = cnt.get(r.id) ?? 0;
    }
  }

  return filtered;
}

/** 設定出貨狀態：先 RPC，失敗則 fallback 寫回 delivery_info JSON */
export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus): Promise<void> {
  try {
    const rpc = await supabase.rpc("set_delivery_ship_status", {
      p_order_id: orderId,
      p_ship_status: shipStatus,
    });
    if (!rpc.error) return;
  } catch {
    /* ignore */
  }

  const sel = await supabase
    .from("orders")
    .select("delivery_info, delivery")
    .eq("id", orderId)
    .maybeSingle();
  if (sel.error) throw sel.error;

  const src = (sel.data?.delivery_info ?? sel.data?.delivery ?? {}) as Record<string, any>;
  const next = { ...src, ship_status: shipStatus };

  const upd = await supabase
    .from("orders")
    .update({ delivery_info: next })
    .eq("id", orderId);
  if (upd.error) throw upd.error;
}

/** --------- 查詢訂單（兩段查詢補齊 items；相容舊新 schema） --------- */
export async function fetchOrders({
  from,
  to,
  status = "all",
  channel = "ALL",
  page = 0,
  pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {
  const fromISO = from ? startOfDay(from) : undefined;
  const toISO = to ? endOfDay(to) : undefined;
  const fromIdx = page * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  let q = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (fromISO) q = q.gte("created_at", fromISO);
  if (toISO) q = q.lte("created_at", toISO);
  if (status !== "all") q = q.eq("status", status.toUpperCase());

  // 若有 channel 欄位則直接使用過濾；沒有就交由前端過濾
  if (channel === "IN_STORE") q = q.eq("channel", "IN_STORE");
  if (channel === "DELIVERY") q = q.eq("channel", "DELIVERY");

  const ordRes = await q.range(fromIdx, toIdx);
  if (ordRes.error) throw ordRes.error;

  const baseRows = (ordRes.data ?? []).map((r: any) => {
    const delivery_json = r.delivery_info ?? r.delivery ?? null;
    const isDelivery =
      r.channel ? r.channel === "DELIVERY" : typeof r.is_delivery === "boolean" ? !!r.is_delivery : !!delivery_json;

    return {
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery,
      delivery: delivery_json,
      items: [] as any[],
    };
  });

  const rowsByChannel =
    channel === "ALL"
      ? baseRows
      : baseRows.filter((r) => (channel === "DELIVERY" ? r.isDelivery : !r.isDelivery));

  const ids = rowsByChannel.map((r) => r.id);
  if (ids.length > 0) {
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
          grams: typeof it.grams === "number" ? it.grams : it.grams ?? null,
          qty: it.qty,
          price: it.price,
          sku: it.sku ?? null,
        });
      }
      for (const r of rowsByChannel) r.items = byOrder.get(r.id) ?? [];
    }
  }

  const totalAmount = rowsByChannel.reduce((s, r) => s + (Number(r.total) || 0), 0);
  return { rows: rowsByChannel, count: ordRes.count ?? 0, totalAmount };
}

/** --------- 下單：多版 RPC 相容（不主動寫入 channel；以 delivery_info 讓 DB 決定） --------- */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
): Promise<string> {
  const itemsTotal = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  const tryPayloads: Record<string, any>[] = [
    // 新版 payload
    {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
      p_delivery_fee: opts.deliveryFee ?? 0,
      p_delivery_info: opts.deliveryInfo ?? {},
      p_fail_when_insufficient: false,
    },
    // 沒有 p_fail_when_insufficient 的版本
    {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
      p_delivery_fee: opts.deliveryFee ?? 0,
      p_delivery_info: opts.deliveryInfo ?? {},
    },
    // 最小參數（非常舊版）
    {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
    },
  ];

  let lastErr: any = null;
  for (const payload of tryPayloads) {
    const { data, error } = await supabase.rpc("place_order", payload as any);
    if (!error && data) {
      // 若用最小參數成功，但這次真的有 delivery 欄位，補寫回 orders（不動 channel）
      if (payload.p_delivery_info) {
        await supabase
          .from("orders")
          .update({
            delivery_info: payload.p_delivery_info ?? null,
            delivery_fee: payload.p_delivery_fee ?? 0,
          })
          .eq("id", data as string);
      }
      return data as string;
    }
    lastErr = error;
    const msg = (error?.message ?? "") + " " + (error?.hint ?? "");
    if (!/PGRST203|could not choose the best candidate|function .* does not exist|column .* does not exist/i.test(msg)) {
      break;
    }
  }
  throw lastErr ?? new Error("place_order failed");
}

/** 便利函式：外送 */
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

/** --------- 作廢（若 DB 有回補庫存則在函式內處理） --------- */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const res = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (res.error) throw res.error;
}

/** （保留接口）若需回補庫存可在 DB 端處理；這裡不做事 */
export async function restockByOrder(_orderId: string) {
  return;
}
