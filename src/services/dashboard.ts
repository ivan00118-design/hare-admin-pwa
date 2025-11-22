// src/services/dashboard.ts
import { supabase } from "../supabaseClient";

/** ===== 時間工具 ===== **/
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
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** ===== 判斷是否為外送訂單（相容多種 schema） =====
 * 規則：
 * 1) channel === "DELIVERY"
 * 2) is_delivery === true
 * 3) delivery_info / delivery 為「非空物件」（若 DB 回字串 JSON 也會 parse 後判定）
 */
export function isDeliveryOrder(row: any): boolean {
  // 明確欄位優先
  if (row?.channel === "DELIVERY") return true;
  if (row?.is_delivery === true) return true;

  // 相容：delivery_info / delivery 可能是 object 或 string(JSON)
  const diRaw = row?.delivery_info ?? row?.delivery ?? null;
  let diObj: any = null;
  if (diRaw && typeof diRaw === "object") diObj = diRaw;
  else if (diRaw && typeof diRaw === "string") {
    try {
      const parsed = JSON.parse(diRaw);
      if (parsed && typeof parsed === "object") diObj = parsed;
    } catch {
      // ignore
    }
  }
  const hasNonEmptyJson =
    diObj && typeof diObj === "object" && Object.keys(diObj).length > 0;

  return !!hasNonEmptyJson;
}

/** ===== 型別：給頁面用的資料形狀 ===== **/
export type PaymentBreakdown = { method: string; amount: number; count: number };
export type BeanByTypeRow = {
  bean: string;          // Bean 名稱
  variantsLabel: string; // 例：'250g × 3 • 500g × 2'
  qty: number;
  revenue: number;
};
export type DailyRow = { date: string; revenue: number; orders: number };

export type DashboardResult = {
  range: { fromISO: string; toISO: string };
  // 概況
  orderRevenue: { amount: number; count: number; aov: number };
  deliveryRevenue: { amount: number; count: number; aov: number };
  totalOrders: number;
  aovAll: number;
  // 明細
  payments: PaymentBreakdown[];
  beansByType: BeanByTypeRow[];
  lastDays: DailyRow[];
};

export type FetchDashboardParams = {
  /** 若只給 date，會抓該日 00:00~23:59:59.999 */
  date?: Date | null;
  /** 自訂查詢區間（與 date 擇一） */
  from?: Date | null;
  to?: Date | null;
  /** 最後 N 天（含查詢日）統計，預設 4 */
  lastDays?: number;
};

/** ===== 主函式：抓取 Dashboard 所需資料 ===== **/
export async function fetchDashboard(params: FetchDashboardParams = {}): Promise<DashboardResult> {
  const { date = new Date(), from, to, lastDays = 4 } = params || {};

  const fromISO = from ? startOfDay(from) : startOfDay(date!);
  const toISO   = to   ? endOfDay(to)     : endOfDay(date!);

  // 1) 取 orders（只抓 ACTIVE），用 "*" 避免欄位差異造成 select 失敗
  const ordRes = await supabase
    .from("orders")
    .select("*")
    .eq("status", "ACTIVE")
    .gte("created_at", fromISO)
    .lte("created_at", toISO);

  if (ordRes.error) throw ordRes.error;
  const orders = (ordRes.data ?? []) as any[];

  // 2) 分群：Delivery vs In-store
  const deliveryOrders: any[] = [];
  const storeOrders: any[] = [];
  for (const o of orders) {
    if (isDeliveryOrder(o)) deliveryOrders.push(o);
    else storeOrders.push(o);
  }

  const sum = (xs: any[], pick: (r: any) => number) =>
    xs.reduce((s: number, r: any) => s + (Number(pick(r) ?? 0) || 0), 0);

  const orderAmount    = sum(storeOrders,    (r) => r.total);
  const orderCount     = storeOrders.length;
  const deliveryAmount = sum(deliveryOrders, (r) => r.total);
  const deliveryCount  = deliveryOrders.length;

  const aovOrder    = orderCount    ? orderAmount    / orderCount    : 0;
  const aovDelivery = deliveryCount ? deliveryAmount / deliveryCount : 0;
  const totalOrders = orderCount + deliveryCount;
  const aovAll      = totalOrders   ? (orderAmount + deliveryAmount) / totalOrders : 0;

  // 3) Payment Breakdown（ACTIVE 全部訂單）
  const paymentsMap = new Map<string, { amount: number; count: number }>();
  for (const o of orders) {
    const k = o?.payment_method ?? "—";
    const cur = paymentsMap.get(k) ?? { amount: 0, count: 0 };
    cur.amount += Number(o?.total ?? 0);
    cur.count += 1;
    paymentsMap.set(k, cur);
  }
  const payments: PaymentBreakdown[] = Array.from(paymentsMap.entries()).map(
    ([method, v]) => ({ method, amount: v.amount, count: v.count })
  );

  // 4) Coffee Beans Sold (by type)
  const orderIds = orders.map((o) => o.id).filter(Boolean);
  let beansByType: BeanByTypeRow[] = [];
  if (orderIds.length > 0) {
    const itRes = await supabase
      .from("order_items")
      .select("order_id,name,category,grams,qty,price")
      .in("order_id", orderIds);

    if (itRes.error) throw itRes.error;
    const items = (itRes.data ?? []) as any[];

    const beans = items.filter((it) => (it?.category ?? "") === "HandDrip");

    // group: beanName -> grams -> { qty, revenue }
    const group = new Map<string, Map<number, { qty: number; revenue: number }>>();
    const beanSum = new Map<string, { qty: number; revenue: number }>();

    for (const it of beans) {
      const name = String(it?.name ?? "").trim();
      const grams = Number(it?.grams ?? 0);
      const qty = Number(it?.qty ?? 0);
      const price = Number(it?.price ?? 0);
      const revenue = qty * price;

      if (!group.has(name)) group.set(name, new Map<number, { qty: number; revenue: number }>());
      const byGram = group.get(name)!;

      const gRow = byGram.get(grams) ?? { qty: 0, revenue: 0 };
      gRow.qty += qty;
      gRow.revenue += revenue;
      byGram.set(grams, gRow);

      const bSum = beanSum.get(name) ?? { qty: 0, revenue: 0 };
      bSum.qty += qty;
      bSum.revenue += revenue;
      beanSum.set(name, bSum);
    }

    beansByType = Array.from(group.entries())
      .map(([bean, gramsMap]) => {
        const gramsEntries = Array.from(
          gramsMap.entries()
        ) as Array<[number, { qty: number; revenue: number }]>;

        const variants = gramsEntries
          .sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0))
          .map(([g, v]) => `${g}g × ${v.qty}`);

        const variantsLabel = variants.join(" • ");

        const s = beanSum.get(bean);
        const qty = s?.qty ?? 0;
        const revenue = s?.revenue ?? 0;

        return { bean, variantsLabel, qty, revenue } as BeanByTypeRow;
      })
      .filter((row) => (row?.qty ?? 0) > 0)
      .sort((a, b) => (b?.revenue ?? 0) - (a?.revenue ?? 0));
  }

  // 5) Last N days（含查詢日）：ACTIVE 全部訂單
  const days: DailyRow[] = [];
  if (lastDays > 0) {
    const anchor = new Date(date || new Date());
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - (lastDays - 1));

    const lastRes = await supabase
      .from("orders")
      .select("id, created_at, total")
      .eq("status", "ACTIVE")
      .gte("created_at", startOfDay(start))
      .lte("created_at", toISO);

    if (lastRes.error) throw lastRes.error;

    const bucket = new Map<string, { revenue: number; orders: number }>();
    for (let i = 0; i < lastDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      bucket.set(ymd(d), { revenue: 0, orders: 0 });
    }

    for (const r of (lastRes.data ?? []) as any[]) {
      const dt = new Date(r?.created_at ?? new Date());
      const key = ymd(dt);
      const cur = bucket.get(key);
      if (!cur) continue;
      cur.revenue += Number(r?.total ?? 0);
      cur.orders += 1;
      bucket.set(key, cur);
    }

    days.push(
      ...Array.from(bucket.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([dateKey, v]) => ({ date: dateKey, revenue: v.revenue, orders: v.orders }))
    );
  }

  return {
    range: { fromISO, toISO },
    orderRevenue:   { amount: orderAmount,   count: orderCount,   aov: aovOrder },
    deliveryRevenue:{ amount: deliveryAmount, count: deliveryCount, aov: aovDelivery },
    totalOrders,
    aovAll,
    payments,
    beansByType,
    lastDays: days,
  };
}
