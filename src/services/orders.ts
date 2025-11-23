// src/services/orders.ts
import { supabase } from "../supabaseClient";

/** Domain types */
export type Category = "drinks" | "HandDrip";
export type DrinkSubKey = "espresso" | "singleOrigin";
export type ShipStatus = "PENDING" | "CLOSED";

export type PlaceOrderItem = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key?: "espresso" | "singleOrigin";
  grams?: number;   // beans 用
  qty: number;
  price: number;
};

export type ShippingRow = {
  id: string;
  created_at: string;
  total: number;
  customer_name: string | null;
  ship_status: ShipStatus;
  note: string | null;
};

type FetchOrdersOpts = {
  from?: Date | string;
  to?: Date | string;
  status?: "all" | "active" | "voided";
  page?: number;
  pageSize?: number;
};

/** -------------- helpers -------------- */
const iso = (d?: Date | string | null) =>
  !d ? undefined : (d instanceof Date ? d : new Date(d)).toISOString();

function sum(items: PlaceOrderItem[]) {
  return items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0);
}

/**
 * 依據 items 扣/回存：讀取對應 products 瞭解 usage_per_cup / grams，再更新 stock_kg
 * op: "DEDUCT" 表示出貨扣庫存；"ADD" 表示退貨補庫存
 */
async function updateStockByItems(
  items: PlaceOrderItem[],
  op: "DEDUCT" | "ADD"
): Promise<void> {
  const skus = Array.from(new Set(items.map((i) => i.sku)));
  if (skus.length === 0) return;

  const { data: prods, error } = await supabase
    .from("products")
    .select("sku, category, usage_per_cup, grams, stock_kg")
    .in("sku", skus);

  if (error) throw error;

  // 整理各 SKU 需要變動的公斤數
  const deltaKg = new Map<string, number>();
  for (const it of items) {
    const p = prods?.find((x) => x.sku === it.sku);
    const cat: Category = (it.category || p?.category || "HandDrip") as Category;
    let d = 0;
    if (cat === "drinks") {
      const usage = Number(p?.usage_per_cup ?? 0);
      d = usage * Number(it.qty || 0);
    } else {
      const g = Number(it.grams ?? p?.grams ?? 0);
      d = (g * Number(it.qty || 0)) / 1000;
    }
    deltaKg.set(it.sku, (deltaKg.get(it.sku) || 0) + d);
  }

  // 逐 SKU 更新（簡化處理；需要交易可改用 SQL RPC）
  for (const [sku, kg] of deltaKg) {
    const row = prods?.find((x) => x.sku === sku);
    const current = Number(row?.stock_kg ?? 0);
    const next = op === "DEDUCT" ? Math.max(0, current - kg) : current + kg;
    const { error: uerr } = await supabase
      .from("products")
      .update({ stock_kg: next })
      .eq("sku", sku);
    if (uerr) throw uerr;
  }
}

/** -------------- queries / commands -------------- */

/** 讀取訂單（含 order_items）並映射回 UI 需要的結構 */
export async function fetchOrders(opts: FetchOrdersOpts = {}) {
  const page = Number(opts.page || 0);
  const size = Math.max(1, Number(opts.pageSize || 100));

  let q = supabase
    .from("orders")
    .select(
      "id, created_at, status, payment_method, total, channel, is_delivery, delivery_fee, delivery_info, voided, order_items(name, sku, qty, price, category, grams, sub_key)"
    )
    .order("created_at", { ascending: true });

  if (opts.from) q = q.gte("created_at", iso(opts.from)!);
  if (opts.to) q = q.lte("created_at", iso(opts.to)!);

  if (opts.status === "active") {
    // voided = false or null
    q = q.or("voided.is.false,voided.is.null");
  } else if (opts.status === "voided") {
    q = q.eq("voided", true);
  }

  q = q.range(page * size, page * size + size - 1);

  const { data, error } = await q;
  if (error) throw error;

  const rows =
    (data || []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      paymentMethod: r.payment_method,
      total: Number(r.total || 0),
      // 僅以 channel 判定交付型態（避免誤判）
      channel: r.channel as "IN_STORE" | "DELIVERY" | null,
      isDelivery: (r.channel as string) === "DELIVERY",
      deliveryFee: Number(r.delivery_fee || 0),
      delivery: r.delivery_info || null,
      items:
        (r.order_items || []).map((it: any) => ({
          name: it.name,
          sku: it.sku,
          qty: Number(it.qty || 0),
          price: Number(it.price || 0),
          category: it.category as Category,
          grams: it.grams ?? null,
          sub_key: it.sub_key ?? null,
        })) || [],
      voided: !!r.voided,
    })) || [];

  return { rows, page, pageSize: size };
}

/** 一般門市下單 */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod = "Cash",
  status: "ACTIVE" | "VOID" = "ACTIVE"
): Promise<string> {
  if (!Array.isArray(items) || items.length === 0) throw new Error("items empty");

  const total = sum(items);

  const { data: ord, error } = await supabase
    .from("orders")
    .insert({
      payment_method: paymentMethod,
      total,
      channel: "IN_STORE",
      is_delivery: false,
      delivery_fee: 0,
      delivery_info: null,
      status,
      voided: false,
    })
    .select("id")
    .single();

  if (error) throw error;
  const orderId: string = ord!.id;

  const payload = items.map((it) => ({
    order_id: orderId,
    name: it.name,
    sku: it.sku,
    qty: it.qty,
    price: it.price,
    category: it.category,
    grams: it.grams ?? null,
    sub_key: it.sub_key ?? null,
  }));

  const { error: iErr } = await supabase.from("order_items").insert(payload);
  if (iErr) throw iErr;

  await updateStockByItems(items, "DEDUCT");

  return orderId;
}

/** Delivery 下單（含運費、出貨資訊） */
export async function placeDelivery(
  items: PlaceOrderItem[],
  paymentMethod = "Cash",
  deliveryInfo: Record<string, any> = {},
  deliveryFee = 0,
  status: "ACTIVE" | "VOID" = "ACTIVE"
): Promise<string> {
  if (!Array.isArray(items) || items.length === 0) throw new Error("items empty");

  const total = sum(items) + Number(deliveryFee || 0);

  const info = {
    ...deliveryInfo,
    ship_status: (deliveryInfo?.ship_status as ShipStatus) || "PENDING",
  };

  const { data: ord, error } = await supabase
    .from("orders")
    .insert({
      payment_method: paymentMethod,
      total,
      channel: "DELIVERY",
      is_delivery: true,
      delivery_fee: deliveryFee || 0,
      delivery_info: info,
      status,
      voided: false,
    })
    .select("id")
    .single();

  if (error) throw error;
  const orderId: string = ord!.id;

  const payload = items.map((it) => ({
    order_id: orderId,
    name: it.name,
    sku: it.sku,
    qty: it.qty,
    price: it.price,
    category: it.category,
    grams: it.grams ?? null,
    sub_key: it.sub_key ?? null,
  }));

  const { error: iErr } = await supabase.from("order_items").insert(payload);
  if (iErr) throw iErr;

  await updateStockByItems(items, "DEDUCT");

  return orderId;
}

/** Delivery 出貨清單（僅從 channel='DELIVERY' 篩出） */
export async function listShipping(
  status: ShipStatus = "PENDING",
  limit = 400
): Promise<ShippingRow[]> {
  let q = supabase
    .from("orders")
    .select("id, created_at, total, delivery_info")
    .eq("channel", "DELIVERY")
    .order("created_at", { ascending: false })
    .limit(limit);

  // 以 JSON contains 過濾 ship_status
  q = q.contains("delivery_info", { ship_status: status });

  const { data, error } = await q;
  if (error) throw error;

  return (data || []).map((r: any) => ({
    id: r.id,
    created_at: r.created_at,
    total: Number(r.total || 0),
    customer_name: r.delivery_info?.customer_name ?? null,
    ship_status: (r.delivery_info?.ship_status || "PENDING") as ShipStatus,
    note: r.delivery_info?.note ?? null,
  }));
}

/** 設定出貨狀態（直接更新 JSON，不呼叫 RPC，可避免 404） */
export async function setOrderShipStatus(orderId: string, shipStatus: ShipStatus) {
  if (!orderId) throw new Error("orderId required");

  const { data, error } = await supabase
    .from("orders")
    .select("delivery_info")
    .eq("id", orderId)
    .single();

  if (error) throw error;

  const info = { ...(data?.delivery_info || {}), ship_status: shipStatus };
  const { error: uerr } = await supabase
    .from("orders")
    .update({ delivery_info: info })
    .eq("id", orderId);

  if (uerr) throw uerr;
}

/** 將某張訂單的庫存「加回去」（作廢後用） */
export async function restockByOrder(orderId: string) {
  if (!orderId) return;
  const { data, error } = await supabase
    .from("order_items")
    .select("name, sku, qty, price, category, grams, sub_key")
    .eq("order_id", orderId);

  if (error) throw error;

  const items: PlaceOrderItem[] =
    (data || []).map((it: any) => ({
      name: it.name,
      sku: it.sku,
      qty: Number(it.qty || 0),
      price: Number(it.price || 0),
      category: it.category as Category,
      grams: it.grams ?? null,
      sub_key: it.sub_key ?? null,
    })) || [];

  if (items.length > 0) {
    await updateStockByItems(items, "ADD");
  }
}

/** 作廢訂單（選配：如需記錄原因） */
export async function voidOrderDB(orderId: string, opt?: { reason?: string }) {
  const { error } = await supabase
    .from("orders")
    .update({ voided: true, void_reason: opt?.reason || null, voided_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw error;
}
