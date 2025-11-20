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

// 內部小工具：套用日期與分頁
function applyCommonFilters(q: any, opts: { fromISO?: string; toISO?: string; page: number; pageSize: number }) {
  const { fromISO, toISO, page, pageSize } = opts;
  if (fromISO) q = q.gte("created_at", fromISO);
  if (toISO) q = q.lte("created_at", toISO);
  const fromIdx = page * pageSize;
  const toIdx = fromIdx + pageSize - 1;
  return q.order("created_at", { ascending: false }).range(fromIdx, toIdx);
}

/**
 * 從 Supabase 讀取訂單 + 明細，回傳：
 * - rows：轉成 History.tsx 需要的形狀
 * - count：符合條件的總筆數（與分頁無關）
 * - totalAmount：預設為「本頁合計」，若存在 RPC `orders_sum` 則回「整個篩選條件合計」
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

  // --- 嘗試：有 status 欄位的版本 ---
  try {
    let q1 = supabase
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
          price,
          sku
        )
      `,
        { count: "exact" }
      );
    q1 = applyCommonFilters(q1, { fromISO, toISO, page, pageSize });
    if (status !== "all") q1 = q1.eq("status", status.toUpperCase());

    const { data, error, count } = await q1;
    if (error) throw error;

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
          sku: it.sku ?? null,
        })),
      })) as any[];

    // 預設：本頁加總，避免 REST 聚合 400
    let totalAmount = rows.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);

    // 若有建立 RPC orders_sum，優先用它算「整個篩選條件」的總額（沒有就忽略）
    try {
      const { data: sumVal, error: sumErr } = await supabase.rpc("orders_sum", {
        p_from: fromISO ?? null,
        p_to: toISO ?? null,
        p_status: status !== "all" ? status.toUpperCase() : null,
      });
      if (!sumErr && typeof sumVal !== "undefined" && sumVal !== null) {
        totalAmount = Number(sumVal) || 0;
      }
    } catch {
      // 忽略 RPC 失敗，保留頁面合計
    }

    return { rows, count: count ?? 0, totalAmount };
  } catch {
    // 落回：只有 voided 布林欄位的版本
  }

  // --- 回退：voided 布林欄位 ---
  let q2 = supabase
    .from("orders")
    .select(
      `
      id,
      created_at,
      voided,
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
        price,
        sku
      )
    `,
      { count: "exact" }
    );
  q2 = applyCommonFilters(q2, { fromISO, toISO, page, pageSize });
  if (status !== "all") q2 = q2.eq("voided", status === "voided");

  const { data: d2, error: e2, count: c2 } = await q2;
  if (e2) throw e2;

  const rows2 =
    (d2 ?? []).map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      total: r.total,
      voided: !!r.voided,
      voidReason: r.void_reason ?? null,
      voidedAt: r.voided_at ?? null,
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

  // 預設：本頁合計
  let totalAmount2 = rows2.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);

  // 若有 RPC orders_sum_voided（只有 voided 設計時），則用它算整體總額
  try {
    const onlyVoided = status === "all" ? null : status === "voided" ? true : false;
    const { data: sumVal2, error: sumErr2 } = await supabase.rpc("orders_sum_voided", {
      p_from: fromISO ?? null,
      p_to: toISO ?? null,
      p_only_voided: onlyVoided,
    });
    if (!sumErr2 && typeof sumVal2 !== "undefined" && sumVal2 !== null) {
      totalAmount2 = Number(sumVal2) || 0;
    }
  } catch {
    // 忽略 RPC 失敗
  }

  return { rows: rows2, count: c2 ?? 0, totalAmount: totalAmount2 };
}

/** 作廢訂單（可附原因）——先嘗試更新 status，失敗再回退到 voided 布林 */
export async function voidOrderDB(orderId: string, opts?: { reason?: string }) {
  // 先嘗試 status 欄位
  const tryStatus = await supabase
    .from("orders")
    .update({
      status: "VOIDED",
      void_reason: opts?.reason ?? null,
      voided_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (!tryStatus.error) return;

  // 回退：voided 布林
  const { error } = await supabase
    .from("orders")
    .update({
      voided: true,
      void_reason: opts?.reason ?? null,
      voided_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) throw error;
}

/** （可選）如果你有庫存表，要做回補可以在這裡串接 */
export async function restockByOrder(_orderId: string) {
  // TODO: 依你的庫存結構實作（例如對 order_items 匯總 -> 更新 inventory 表）
  return;
}

// ----------------- 下單（RPC） -----------------
export type PlaceOrderItem = {
  name: string;
  sku?: string;
  qty: number;
  price: number;
  category?: string;
  grams?: number;
  sub_key?: string | null;
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
