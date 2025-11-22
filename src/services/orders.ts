import { supabase } from "../supabaseClient";

/** ===== 型別 ===== */
export type UIStatus = "all" | "active" | "voided";

export type PlaceOrderItem = {
  name: string;
  sku?: string | null;
  qty: number;
  price: number;                         // 與 DB 單位一致（元或分）
  category?: "HandDrip" | "drinks";      // 可選，後端若缺會以 sku/grams/sub_key 推回
  grams?: number;                        // 豆子品項才有
  sub_key?: "espresso" | "singleOrigin"; // 飲品才有
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;          // ISO 字串（可選）
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

/** ===== 小工具 ===== */
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

/** ===== 查詢訂單（相容新版 channel/legacy is_delivery；回傳 totalAmount） ===== */
export async function fetchOrders({
  from,
  to,
  status = "all",
  channel = "ALL", // IN_STORE / DELIVERY / ALL
  page = 0,
  pageSize = 20,
}: FetchParams): Promise<{ rows: any[]; count: number; totalAmount: number }> {
  const fromISO = from ? startOfDay(from) : undefined;
  const toISO   = to   ? endOfDay(to)   : undefined;
  const fromIdx = page * pageSize;
  const toIdx   = fromIdx + pageSize - 1;

  // 由 sku 推回 grams / subKey，並補齊 category（避免 null）
  const normalizeItem = (it: any) => {
    const sku: string | null = it?.sku ?? null;

    let grams: number | null =
      typeof it?.grams === "number" ? it.grams : null;
    let subKey: "espresso" | "singleOrigin" | null =
      it?.sub_key ?? null;

    if (grams == null && typeof sku === "string") {
      const m = sku.match(/-(\d{2,4})g$/i);
      if (m) grams = Number(m[1]);
    }
    if (!subKey && typeof sku === "string") {
      const m = sku.match(/-(espresso|singleOrigin)$/i);
      if (m) subKey = m[1] as any;
    }

    const category: "HandDrip" | "drinks" | null =
      it?.category ?? (grams != null ? "HandDrip" : subKey ? "drinks" : null);

    return {
      name: it.name,
      category,
      subKey,
      grams,
      qty: it.qty,
      price: it.price,
      sku,
    };
  };

  const mapRow = (r: any, mode: "channel" | "legacy") => {
    const isDelivery =
      mode === "channel" ? (r.channel ? r.channel === "DELIVERY" : false)
                         : !!r.is_delivery;

    // 只有外送才帶 delivery；門市固定為 null，避免以 !!o.delivery 誤判
    const delivery =
      isDelivery
        ? (mode === "channel" ? (r.delivery_info ?? {}) : (r.delivery ?? {}))
        : null;

    return {
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: Number(r.total) || 0,
      deliveryFee: r.delivery_fee ?? 0,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      isDelivery,
      delivery,
      items: Array.isArray(r.order_items) ? r.order_items.map(normalizeItem) : [],
    };
  };

  // 新版（有 channel / delivery_info），**不要選 items_total** 以避免 400
  const runChannel = async () => {
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
        voided_at,
        order_items (
          name,
          category,
          sub_key,
          grams,
          qty,
          price,
          sku
        )
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

  // 舊版（is_delivery / delivery）
  const runLegacy = async () => {
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
        order_items (
          name,
          category,
          sub_key,
          grams,
          qty,
          price,
          sku
        )
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

  // 先走新版，失敗就回退舊版
  try {
    const { data, error, count } = await runChannel();
    if (error) throw error;

    const rows = (data ?? []).map((r: any) => mapRow(r, "channel"));
    const totalAmount = rows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
    return { rows, count: count ?? 0, totalAmount };
  } catch {
    const { data, error, count } = await runLegacy();
    if (error) throw error;

    const rows = (data ?? []).map((r: any) => mapRow(r, "legacy"));
    const totalAmount = rows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0);
    return { rows, count: count ?? 0, totalAmount };
  }
}

/** ===== 下單（支援通路/運費/配送資訊；帶 fail 參數避免 RPC 過載歧義） ===== */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE",
  opts: PlaceOrderOptions = {}
) {
  const itemsTotal = items.reduce(
    (s: number, it: PlaceOrderItem) => s + Number(it.qty) * Number(it.price),
    0
  );

  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_channel: opts.channel ?? "IN_STORE",
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? {},
    // 只有新版函式才有此參數；帶上可打破 PostgREST 的函式過載歧義
    p_fail_when_insufficient: false,
  });
  if (error) throw error;
  return data as string; // order id
}

/** 小幫手：Delivery 包裝（頁面用 placeDelivery 即可） */
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

/** ===== 作廢訂單（DB RPC） ===== */
export async function voidOrderDB(orderId: string, opts?: { reason?: string; restock?: boolean }) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

/** （預留）若需回補庫存可在此實作 */
export async function restockByOrder(_orderId: string) {
  return;
}
