// src/services/orders.ts
import { supabase } from "../supabaseClient";

export type UIStatus = "all" | "active" | "voided";

export interface FetchParams {
  from?: Date | null;
  to?: Date | null;
  status?: UIStatus;
  page?: number;     // 0-based
  pageSize?: number; // default 20
}

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

/**
 * 從 Supabase 讀取訂單 + 明細（可選），並回傳
 * rows（已轉成 History.tsx 需要的 UI 形狀）、總筆數、總金額。
 */
export async function fetchOrders({
  from,
  to,
  status = "all",
  page = 0,
  pageSize = 20,
}: FetchParams) {
  const fromISO = from ? startOfDay(from) : undefined;
  const toISO = to ? endOfDay(to) : undefined;

  let q = supabase
    .from("orders")
    .select(
      `
      id,
      created_at,
      status,
      payment_method,
      total,
      void_reason,
      voided_at,
      order_items (
        name,
        category,
        sub_key,
        grams,
        qty,
        price
      )
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (fromISO) q = q.gte("created_at", fromISO);
  if (toISO) q = q.lte("created_at", toISO);
  if (status !== "all") {
    // DB 端用大寫 ACTIVE/VOIDED；UI 用小寫
    q = q.eq("status", status.toUpperCase());
  }

  const fromIdx = page * pageSize;
  const toIdx = fromIdx + pageSize - 1;
  const { data, error, count } = await q.range(fromIdx, toIdx);
  if (error) throw error;

  // 另做總金額彙總（避免把所有資料拉回本機再加總）
  let sumQ = supabase.from("orders").select("sum:total.sum()");
  if (fromISO) sumQ = sumQ.gte("created_at", fromISO);
  if (toISO) sumQ = sumQ.lte("created_at", toISO);
  if (status !== "all") sumQ = sumQ.eq("status", status.toUpperCase());
  const { data: sumRows, error: sumErr } = await sumQ;
  if (sumErr) throw sumErr;
  const totalAmount = (sumRows?.[0]?.sum as number) ?? 0;

  // 轉成 History.tsx 目前使用的欄位命名
  const rows =
    (data ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      voided: r.status === "VOIDED",
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
      items: (r.order_items ?? []).map((it: any) => ({
        name: it.name,
        category: it.category ?? null,
        subKey: it.sub_key ?? null,
        grams: it.grams ?? null,
        qty: it.qty,
        price: it.price,
      })),
    })) as any[];

  return { rows, count: count ?? 0, totalAmount };
}

/** 作廢訂單（可附原因） */
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

/** （可選）如果你有庫存表，要做回補可以在這裡串接 */
export async function restockByOrder(orderId: string) {
  // TODO: 依你的庫存結構實作（例如對 order_items 匯總 -> 更新 inventory 表）
  return;
}


export type PlaceOrderItem = {
  name: string;
  sku?: string;
  qty: number;
  price: number; // 單位要與 DB 相同（元或分）
};

/** 透過 RPC place_order 寫入主檔 + 明細；回傳新訂單 id */
export async function placeOrder(
  items: PlaceOrderItem[],
  paymentMethod: string,
  status: "ACTIVE" | "VOIDED" = "ACTIVE"
) {
  const total = items.reduce((s, it) => s + Number(it.qty) * Number(it.price), 0);

  const { data, error } = await supabase.rpc("place_order", {
    p_payment_method: paymentMethod,
    p_items: items,
    p_total: total,
    p_status: status,
  });

  if (error) throw error;
  return data as string;
}