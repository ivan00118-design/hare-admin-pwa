// src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchOrders } from "../services/orders";

const WHATSAPP_PHONE = import.meta?.env?.VITE_WHATSAPP_PHONE || "";

// ---- utils -------------------------------------------------
const fmtMoney = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const toDayKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const todayKey = () => toDayKey(new Date());

/**
 * 將 fetchOrders() 的單筆訂單時間做「日期鍵」抽取。
 * 支援：
 *  - Date 物件
 *  - ISO: 2025-11-23T...
 *  - 斜線格式: 2025/11/23 13:20:00（含「上午/下午」「AM/PM」）
 *  - 欄位名 createdAt 或 created_at
 */
function orderDayKey(o: any): string {
  const raw = o?.createdAt ?? o?.created_at;
  if (!raw) return "";

  if (raw instanceof Date) return toDayKey(raw);

  const s = String(raw);

  // ISO 2025-11-23T...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // YYYY/MM/DD ...
  const slash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const y = slash[1];
    const m = slash[2].padStart(2, "0");
    const d = slash[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 最後手段：嘗試直接 new Date()
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toDayKey(d);

  // 仍失敗就放棄（避免把整頁卡死）
  return "";
}

/** Delivery 判定：先看布林 isDelivery，否則看 channel === 'DELIVERY' */
function isDeliveryOrder(o: any): boolean {
  if (typeof o?.isDelivery === "boolean") return o.isDelivery;
  return (o?.channel || "") === "DELIVERY";
}

// ------------------------------------------------------------

export default function Dashboard() {
  const [picked, setPicked] = useState(todayKey());

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 設定查詢視窗：從 picked-3 天 00:00 到 picked+1 天 00:00（半開：含起不含迄）
    const base = new Date(picked);
    if (Number.isNaN(base.getTime())) return;

    const from = new Date(base);
    from.setDate(base.getDate() - 3);
    from.setHours(0, 0, 0, 0);

    const to = new Date(base);
    to.setDate(base.getDate() + 1);
    to.setHours(0, 0, 0, 0);

    setLoading(true);
    fetchOrders({
      from,
      to,
      status: "active", // 只取未作廢
      page: 0,
      pageSize: 1000,
    })
      .then((res) => setRows(Array.isArray(res?.rows) ? res.rows : []))
      .finally(() => setLoading(false));
  }, [picked]);

  // 保險：再次排除 voided
  const validOrders = useMemo(() => rows.filter((o: any) => !o?.voided), [rows]);

  // 僅取當天（用健壯的日期鍵）
  const ordersOfDay = useMemo(
    () => validOrders.filter((o) => orderDayKey(o) === picked),
    [validOrders, picked]
  );

  // ---- 拆分營收 + 計數 -------------------------------------
  const byType = useMemo(() => {
    let orderRevenue = 0, deliveryRevenue = 0;
    let orderCount = 0, deliveryCount = 0;

    for (const o of ordersOfDay) {
      const amt = Number(o?.total) || 0;
      if (isDeliveryOrder(o)) {
        deliveryRevenue += amt;
        deliveryCount += 1;
      } else {
        orderRevenue += amt;
        orderCount += 1;
      }
    }
    return {
      orderRevenue, deliveryRevenue,
      orderCount, deliveryCount,
      dayRevenue: orderRevenue + deliveryRevenue,
      dayCount: orderCount + deliveryCount,
    };
  }, [ordersOfDay]);

  // AOV（All / Order / Delivery）
  const dayAOV = byType.dayCount ? byType.dayRevenue / byType.dayCount : 0;
  const orderAOV = byType.orderCount ? byType.orderRevenue / byType.orderCount : 0;
  const deliveryAOV = byType.deliveryCount ? byType.deliveryRevenue / byType.deliveryCount : 0;

  // ---- Payment Breakdown（當日） ----------------------------
  const paymentTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of ordersOfDay) {
      const k = o?.paymentMethod || "—";
      map.set(k, (map.get(k) || 0) + (Number(o?.total) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [ordersOfDay]);

  // ---- Coffee Beans Sold（by type） -------------------------
  const beanStats = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number; variants: Map<number, number> }>();
    for (const o of ordersOfDay) {
      for (const it of (o.items || []) as any[]) {
        if (it?.category !== "HandDrip") continue;
        const name = (it.name || "").trim();
        if (!map.has(name)) map.set(name, { qty: 0, revenue: 0, variants: new Map() });
        const rec = map.get(name)!;
        const q = Number(it.qty) || 0;
        const price = Number(it.price) || 0;
        rec.qty += q;
        rec.revenue += q * price;
        const g = Number(it.grams) || 0;
        rec.variants.set(g, (rec.variants.get(g) || 0) + q);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [ordersOfDay]);

  // ---- 最近 4 天（日營收/筆數） -----------------------------
  const last4 = useMemo(() => {
    const base = new Date(picked);
    if (Number.isNaN(base.getTime())) return [];
    const days: string[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      days.push(toDayKey(d));
    }
    const group = new Map<string, { revenue: number; count: number }>();
    for (const o of validOrders) {
      const k = orderDayKey(o);
      if (!days.includes(k)) continue;
      group.set(k, {
        revenue: (group.get(k)?.revenue || 0) + (Number(o.total) || 0),
        count: (group.get(k)?.count || 0) + 1,
      });
    }
    return days.map((k) => ({ day: k, revenue: group.get(k)?.revenue || 0, count: group.get(k)?.count || 0 }));
  }, [validOrders, picked]);

  // ---- 交班訊息 --------------------------------------------
  const buildShiftSummary = () => {
    const lines: string[] = [];
    lines.push(`Shift Summary — ${picked}`);
    lines.push(`Orders (All): ${byType.dayCount} · AOV $ ${fmtMoney(dayAOV)}`);
    lines.push(`Order Only: ${byType.orderCount} · Revenue $ ${fmtMoney(byType.orderRevenue)} · AOV $ ${fmtMoney(orderAOV)}`);
    lines.push(`Delivery Only: ${byType.deliveryCount} · Revenue $ ${fmtMoney(byType.deliveryRevenue)} · AOV $ ${fmtMoney(deliveryAOV)}`);
    lines.push(`Total Revenue: $ ${fmtMoney(byType.dayRevenue)}`);
    lines.push("");
    lines.push("Payment Breakdown:");
    if (paymentTotals.length === 0) lines.push("  - (none)");
    else for (const [method, amt] of paymentTotals) lines.push(`  - ${method}: $ ${fmtMoney(amt)}`);
    lines.push("");
    lines.push("Coffee Beans Sold (by type):");
    if (beanStats.length === 0) lines.push("  - (none)");
    else {
      for (const [name, rec] of beanStats) {
        const variants = Array.from(rec.variants.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([g, q]) => (g ? `${g}g × ${q}` : `— × ${q}`))
          .join(", ");
        lines.push(`  - ${name}: Qty ${rec.qty} ${variants ? `(${variants}) ` : ""}— $ ${fmtMoney(rec.revenue)}`);
      }
    }
    return lines.join("\n");
  };

  const sendToWhatsApp = async () => {
    const text = buildShiftSummary();
    try { await navigator.clipboard.writeText(text); } catch {}
    const to = String(WHATSAPP_PHONE || "").replace(/[^\d]/g, "");
    const url = to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // ---- UI ---------------------------------------------------
  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Date</label>
          <input
            type="date"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="h-10 border rounded px-3"
          />
          <PosButton
            variant="confirm"
            className="!bg-white !text-black !border !border-gray-300 shadow hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
            style={{ colorScheme: "light" }}
            onClick={sendToWhatsApp}
            title="Roll Shift & Send to WhatsApp"
          >
            🧾 Roll Shift
          </PosButton>
        </div>
      </div>

      {/* KPI：Order / Delivery 拆分 + 各自 Count/AOV */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Order Revenue</div>
          <div className="mt-1 text-2xl font-extrabold text-[#111]">$ {fmtMoney(byType.orderRevenue)}</div>
          <div className="mt-1 text-xs text-gray-500">
            {picked} · {byType.orderCount} orders · AOV $ {fmtMoney(orderAOV)}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Delivery Revenue</div>
          <div className="mt-1 text-2xl font-extrabold text-[#dc2626]">$ {fmtMoney(byType.deliveryRevenue)}</div>
          <div className="mt-1 text-xs text-gray-500">
            {picked} · {byType.deliveryCount} deliveries · AOV $ {fmtMoney(deliveryAOV)}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Total Orders</div>
          <div className="mt-1 text-2xl font-extrabold">{byType.dayCount}</div>
          <div className="mt-1 text-xs text-gray-500">Valid only (excluded voided)</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Avg. Order Value (All)</div>
          <div className="mt-1 text-2xl font-extrabold">$ {fmtMoney(dayAOV)}</div>
          <div className="mt-1 text-xs text-gray-500">Revenue / Order</div>
        </div>
      </div>

      {/* Payment Breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow mb-6">
        <h2 className="text-lg font-extrabold mb-3">Payment Breakdown</h2>
        {paymentTotals.length === 0 ? (
          <p className="text-gray-500">{loading ? "Loading..." : "No payments."}</p>
        ) : (
          <ul className="space-y-2">
            {paymentTotals.map(([method, amt]) => (
              <li key={method} className="flex items-center justify-between text-sm">
                <span>{method}</span>
                <b>MOP$ {fmtMoney(amt)}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Coffee Beans Sold (by type) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
        <h2 className="text-lg font-extrabold mb-3">Coffee Beans Sold (by type)</h2>
        {beanStats.length === 0 ? (
          <p className="text-gray-500">{loading ? "Loading..." : "No records."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black text-white uppercase text-xs font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Bean</th>
                  <th className="px-3 py-2 text-left">Variants</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {beanStats.map(([name, rec]) => {
                  const variants = Array.from(rec.variants.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([g, q]) => (g ? `${g}g × ${q}` : `— × ${q}`))
                    .join(", ");
                  return (
                    <tr key={name} className="border-t">
                      <td className="px-3 py-2">{name}</td>
                      <td className="px-3 py-2 text-gray-600">{variants || "—"}</td>
                      <td className="px-3 py-2 text-right">{rec.qty}</td>
                      <td className="px-3 py-2 text-right font-bold text-[#dc2626]">MOP$ {fmtMoney(rec.revenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 最近 4 天 */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4 shadow">
        <h2 className="text-lg font-extrabold mb-3">Last 4 days</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white uppercase text-xs font-bold">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {last4.map((d) => (
                <tr key={d.day} className="border-t">
                  <td className="px-3 py-2">{d.day}</td>
                  <td className="px-3 py-2 text-right">MOP$ {fmtMoney(d.revenue)}</td>
                  <td className="px-3 py-2 text-right">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
