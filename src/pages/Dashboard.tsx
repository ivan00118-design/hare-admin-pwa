// src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchOrders } from "../services/orders";

const WHATSAPP_PHONE = import.meta?.env?.VITE_WHATSAPP_PHONE || "85366396803";

const fmtMoney = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const dateKey = (dLike: string | Date) => {
  const d = dLike instanceof Date ? dLike : new Date(dLike);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const todayKey = () => dateKey(new Date());

export default function Dashboard() {
  const [picked, setPicked] = useState(todayKey());

  // 從 Supabase 載入資料（抓「選取日的前3天 ~ 選取日」且只取未作廢）
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const base = new Date(picked);
    if (Number.isNaN(base.getTime())) return;

    const from = new Date(base);
    from.setDate(base.getDate() - 3); // 最近 4 天視窗

    const to = new Date(base); // 當天

    setLoading(true);
    fetchOrders({
      from,
      to,
      status: "active", // 只取未作廢
      page: 0,
      pageSize: 1000, // 視需求調整
    })
      .then((res) => setRows(res.rows || []))
      .finally(() => setLoading(false));
  }, [picked]);

  // 本頁使用的有效訂單（fetchOrders 已過濾 active；這裡保險再排除一次）
  const validOrders = useMemo(() => rows.filter((o: any) => !o?.voided), [rows]);
  const ordersOfDay = useMemo(
    () => validOrders.filter((o: any) => dateKey(o.createdAt) === picked),
    [validOrders, picked]
  );

  // 外送訂單判斷：之後若你在 DB 增加欄位（如 orders.is_delivery 或 delivery json），這裡即會生效
  const isDeliveryOrder = (o: any) =>
    typeof o?.isDelivery === "boolean"
      ? o.isDelivery
      : (o?.channel === "DELIVERY");

  // 拆分營收 + 計數
  const byType = useMemo(() => {
    let orderRevenue = 0, deliveryRevenue = 0;
    let orderCount = 0, deliveryCount = 0;

    for (const o of ordersOfDay as any[]) {
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

  // Payment Breakdown（當日）
  const paymentTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of ordersOfDay as any[]) {
      const k = o?.paymentMethod || "—";
      map.set(k, (map.get(k) || 0) + (Number(o?.total) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [ordersOfDay]);

  // Coffee Beans Sold（by type）
  const beanStats = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number; variants: Map<number, number> }>();
    for (const o of ordersOfDay as any[]) {
      for (const it of (o.items || []) as any[]) {
        if (it.category !== "HandDrip") continue;
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

  // 最近 4 天（日營收/筆數）- 基於 validOrders（已是四天視窗）
  const last4 = useMemo(() => {
    const base = new Date(picked);
    if (Number.isNaN(base.getTime())) return [];
    const days: string[] = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      days.push(dateKey(d));
    }
    const group = new Map<string, { revenue: number; count: number }>();
    for (const o of validOrders as any[]) {
      const k = dateKey(o.createdAt);
      if (!days.includes(k)) continue;
      group.set(k, {
        revenue: (group.get(k)?.revenue || 0) + (Number(o.total) || 0),
        count: (group.get(k)?.count || 0) + 1
      });
    }
    return days.map((k) => ({ day: k, revenue: group.get(k)?.revenue || 0, count: group.get(k)?.count || 0 }));
  }, [validOrders, picked]);

  const buildShiftSummary = () => {
    const lines: string[] = [];
    lines.push(`Shift Summary — ${picked}`);
    lines.push(`Orders (All): ${byType.dayCount} · AOV $ ${fmtMoney(dayAOV)}`);
    lines.push(`Order Only: ${byType.orderCount} · Revenue $ ${fmtMoney(byType.orderRevenue)} · AOV $ ${fmtMoney(orderAOV)}`);
    lines.push(`Delivery Only: ${byType.deliveryCount} · Revenue $ ${fmtMoney(byType.deliveryRevenue)} · AOV $ ${fmtMoney(deliveryAOV)}`);
    lines.push(`Total Revenue: $ ${fmtMoney(byType.dayRevenue)}`);
    lines.push(``);
    lines.push(`Payment Breakdown:`);
    if (paymentTotals.length === 0) lines.push(`  - (none)`);
    else for (const [method, amt] of paymentTotals) lines.push(`  - ${method}: $ ${fmtMoney(amt)}`);
    lines.push(``);
    lines.push(`Coffee Beans Sold (by type):`);
    if (beanStats.length === 0) lines.push(`  - (none)`);
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
