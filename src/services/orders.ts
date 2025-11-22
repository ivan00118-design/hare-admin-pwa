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
  grams?: number;                         // 豆子品項才有
  sub_key?: "espresso" | "singleOrigin";  // 飲品才有
};

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;           // ISO 字串（可選）
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

// 依 SKU/欄位補全品項資訊（讓 Dashboard 的 beans/drinks 統計永遠有資料）
function normalizeItem(it: any) {
  const sku: string | null = it?.sku ?? null;

  let grams: number | null =
    typeof it?.grams === "number" ? it.grams : null;
  let subKey: "espresso" | "singleOrigin" | null =
    it?.sub_key ?? null;

  if (!grams && typeof sku === "string") {
    const m = sku.match(/-(\d+)g$/i);
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
    qty: Number(it.qty) || 0,
    price: Number(it.price) || 0,
    sku,
  };
}

// ---------- 查詢訂單（穩健版：orders 與 order_items 分開撈；回傳 totalAmount） ----------
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

  // 補齊/規格化明細的 helper（從 sku 推回 grams / subKey，並填好 category）
  const normalizeItem = (it: any) => {
    const sku: string | null = it?.sku ?? null;
    let grams: number | null =
      typeof it?.grams === "number" ? it.grams : null;
    let subKey: "espresso" | "singleOrigin" | null = it?.sub_key ?? null;

    if (!grams && typeof sku === "string") {
      const m = sku.match(/-(\d+)g$/i);
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
      order_id: it.order_id,
    };
  };

  // 先試「新版」欄位（有 channel / delivery_info）
  const selectNew = `
    id, created_at, status, payment_method,
    total, delivery_fee, channel, delivery_info,
    void_reason, voided_at
  `;
  const buildNew = () => {
    let q = supabase.from("orders").select(selectNew, { count: "exact" })
      .order("created_at", { ascending: false });
    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    if (channel !== "ALL") q = q.eq("channel", channel);
    return q;
  };

  // 失敗就回退「舊版」（沒有 channel / delivery_info）
  const selectLegacy = `
    id, created_at, status, payment_method,
    total, delivery_fee, is_delivery, delivery,
    void_reason, voided_at
  `;
  const buildLegacy = () => {
    let q = supabase.from("orders").select(selectLegacy, { count: "exact" })
      .order("created_at", { ascending: false });
    if (fromISO) q = q.gte("created_at", fromISO);
    if (toISO)   q = q.lte("created_at", toISO);
    if (status !== "all") q = q.eq("status", status.toUpperCase());
    // 舊版沒有 channel，不做 channel 篩選
    return q;
  };

  let res, mode: "new" | "legacy" = "new";
  try {
    res = await buildNew().range(fromIdx, toIdx);
    if (res.error) throw res.error;
  } catch {
    res = await buildLegacy().range(fromIdx, toIdx);
    if (res.error) throw res.error;
    mode = "legacy";
  }

  const orders = (res.data ?? []) as any[];
  const orderIds = orders.map(o => o.id);

  // 第二段：把所有 order_items 一次撈回並分組
  const itemsByOrder = new Map<string, any[]>();
  if (orderIds.length > 0) {
    const { data: items, error: itErr } = await supabase
      .from("order_items")
      .select("order_id, name, category, sub_key, grams, qty, price, sku")
      .in("order_id", orderIds);

    if (!itErr && Array.isArray(items)) {
      for (const raw of items) {
        const it = normalizeItem(raw);
        const arr = itemsByOrder.get(it.order_id) || [];
        arr.push(it);
        itemsByOrder.set(it.order_id, arr);
      }
    } else {
      console.warn("[fetchOrders] order_items fetch failed:", itErr);
    }
  }

  const rows = orders.map((o) => {
    const isDelivery =
      mode === "new" ? (o.channel ? o.channel === "DELIVERY" : false)
                     : !!o.is_delivery;
    return {
      id: o.id,
      createdAt: o.created_at,
      paymentMethod: o.payment_method,
      total: Number(o.total) || 0,
      deliveryFee: o.delivery_fee ?? 0,
      voided: o.status === "VOIDED",
      voidReason: o.void_reason ?? null,
      voidedAt: o.voided_at ?? null,
      isDelivery,
      delivery: mode === "new" ? (isDelivery ? o.delivery_info ?? null : null)
                               : (isDelivery ? o.delivery ?? null : null),
      items: itemsByOrder.get(o.id) || [],
    };
  });

  const totalAmount = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  return { rows, count: res.count ?? 0, totalAmount };
}


// ---------- 下單（支援通路/運費/配送資訊；相容多版本 RPC） ----------
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

  // 先嘗試新版（帶 channel / delivery / fail_when_insufficient）
  const tryV2 = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: itemsTotal,
    p_status: opts.status ?? status,
    p_channel: opts.channel ?? "IN_STORE",
    p_delivery_fee: opts.deliveryFee ?? 0,
    p_delivery_info: opts.deliveryInfo ?? null, // 門市單送 null
    p_fail_when_insufficient: false,
  });

  if (!tryV2.error) {
    return tryV2.data as string;
  }

  // 若遇到重載歧義（PGRST203），fallback 舊版參數
  const ambiguous =
    String(tryV2.error.code || "").toUpperCase() === "PGRST203" ||
    /Could not choose the best candidate function/i.test(
      String(tryV2.error.message || "")
    );

  if (ambiguous) {
    const tryV1 = await supabase.rpc("place_order", {
      p_payment_method: paymentMethod,
      p_items: items,
      p_total: itemsTotal,
      p_status: opts.status ?? status,
    });
    if (tryV1.error) throw tryV1.error;
    return tryV1.data as string;
  }

  // 其他錯誤直接丟出
  throw tryV2.error;
}

// 小幫手：Delivery 包裝
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

// ---------- 作廢訂單（用 DB RPC） ----------
export async function voidOrderDB(
  orderId: string,
  opts?: { reason?: string; restock?: boolean }
) {
  const { error } = await supabase.rpc("void_order", {
    p_order_id: orderId,
    p_reason: opts?.reason ?? null,
    p_restock: !!opts?.restock,
  });
  if (error) throw error;
}

// （預留）若需回補庫存可在此實作（或以 DB 端觸發器/函式處理）
export async function restockByOrder(_orderId: string) {
  return;
}
