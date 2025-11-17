import React, { useMemo, useState } from "react";
import { useAppState } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";

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
  const { orders = [] } = useAppState();
  const [picked, setPicked] = useState(todayKey());

  // 僅統計有效訂單
  const validOrders = useMemo(() => orders.filter((o) => !o.voided), [orders]);
  const ordersOfDay = useMemo(() => validOrders.filter((o) => dateKey(o.createdAt) === picked), [validOrders, picked]);

  const dayRevenue = ordersOfDay.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const dayCount = ordersOfDay.length;
  const dayAOV = dayCount ? dayRevenue / dayCount : 0;

  // 付款彙總（當天）
  const paymentStats = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const o of ordersOfDay) {
      const k = (o.paymentMethod || "—").trim();
      const rec = map.get(k) || { amount: 0, count: 0 };
      rec.amount += Number(o.total) || 0;
      rec.count += 1;
      map.set(k, rec);
    }
    const pairs = Array.from(map.entries())
      .map(([method, v]) => ({ method, amount: v.amount, count: v.count, aov: v.count ? v.amount / v.count : 0 }))
      .sort((a, b) => b.amount - a.amount);
    const totalAmount = pairs.reduce((s, x) => s + x.amount, 0);
    return {
      rows: pairs.map((x) => ({ ...x, share: totalAmount ? x.amount / totalAmount : 0 })),
      totalAmount,
      totalCount: pairs.reduce((s, x) => s + x.count, 0)
    };
  }, [ordersOfDay]);

  // 豆子（HandDrip）銷售：保留你原本的彙總，以後若要顯示可直接使用
  const beanStats = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number; variants: Map<number, number> }>();
    for (const o of ordersOfDay) {
      for (const it of o.items || []) {
        if (it.category !== "HandDrip") continue;
        const name = (it.name || "").trim();
        if (!map.has(name)) map.set(name, { qty: 0, revenue: 0, variants: new Map() });
        const rec = map.get(name)!;
        const q = Number((it as any).qty) || 0;
        const price = Number((it as any).price) || 0;
        rec.qty += q;
        rec.revenue += q * price;
        const g = Number(it.grams) || 0;
        rec.variants.set(g, (rec.variants.get(g) || 0) + q);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [ordersOfDay]);

  const lastNDays = (n = 4) => {
    const days: string[] = [];
    const base = new Date(picked);
    if (Number.isNaN(base.getTime())) return [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      days.push(dateKey(d));
    }
    const group = new Map<string, { revenue: number; count: number }>();
    for (const o of validOrders) {
      const k = dateKey(o.createdAt);
      if (!days.includes(k)) continue;
      group.set(k, {
        revenue: (group.get(k)?.revenue || 0) + (Number(o.total) || 0),
        count: (group.get(k)?.count || 0) + 1
      });
    }
    return days.map((k) => ({ day: k, revenue: group.get(k)?.revenue || 0, count: group.get(k)?.count || 0 }));
  };
  const last4 = useMemo(() => lastNDays(4), [validOrders, picked]);

  const buildShiftSummary = () => {
    const lines: string[] = [];
    lines.push(`Shift Summary — ${picked}`);
    lines.push(`Orders: ${dayCount}`);
    lines.push(`Daily Revenue: $ ${fmtMoney(dayRevenue)}`);
    lines.push(`Avg. Order Value: $ ${fmtMoney(dayAOV)}`);
    lines.push(``);
    lines.push(`Payment Breakdown:`);
    if (paymentStats.rows.length === 0) lines.push(`  - (none)`);
    else
      for (const r of paymentStats.rows)
        lines.push(`  - ${r.method}: $ ${fmtMoney(r.amount)} • ${Math.round(r.share * 100)}% • ${r.count} orders (AOV ${fmtMoney(r.aov)})`);
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
      {/* 頂部工具列 */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Date</label>
          <input type="date" value={picked} onChange={(e) => setPicked(e.target.value)} className="h-10 border rounded px-3" />
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

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Daily Revenue</div>
          <div className="mt-1 text-2xl font-extrabold text-[#dc2626]">$ {fmtMoney(dayRevenue)}</div>
          <div className="mt-1 text-xs text-gray-500">{picked}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Orders</div>
          <div className="mt-1 text-2xl font-extrabold">{dayCount}</div>
          <div className="mt-1 text-xs text-gray-500">Valid only (excluded voided)</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Avg. Order Value</div>
          <div className="mt-1 text-2xl font-extrabold">$ {fmtMoney(dayAOV)}</div>
          <div className="mt-1 text-xs text-gray-500">Revenue / Order</div>
        </div>
      </div>

      {/* Payment Breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow mb-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-extrabold text-black">Payment Breakdown</h2>
          <span className="text-xs text-gray-500">({picked})</span>
          <div className="ml-auto text-sm text-gray-600">
            <span className="mr-4">Count: <b>{paymentStats.totalCount}</b></span>
            <span>Total: <b>$ {fmtMoney(paymentStats.totalAmount)}</b></span>
          </div>
        </div>

        {paymentStats.rows.length === 0 ? (
          <p className="text-gray-400">No payments.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-900">
              <thead className="bg-black text-white uppercase text-xs font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Method</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-center">Orders</th>
                  <th className="px-3 py-2 text-center">AOV</th>
                  <th className="px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {paymentStats.rows.map((r) => (
                  <tr key={r.method} className="border-t border-gray-200 align-middle">
                    <td className="px-3 py-2 font-semibold">{r.method}</td>
                    <td className="px-3 py-2 text-right text-[#dc2626] font-extrabold">$ {fmtMoney(r.amount)}</td>
                    <td className="px-3 py-2 text-center">{r.count}</td>
                    <td className="px-3 py-2 text-center">$ {fmtMoney(r.aov)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded">
                          <div
                            className="h-2 bg-[#dc2626] rounded"
                            style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }}
                            title={`${Math.round(r.share * 100)}%`}
                          />
                        </div>
                        <div className="w-12 text-right tabular-nums">{Math.round(r.share * 100)}%</div>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right text-[#dc2626]">$ {fmtMoney(paymentStats.totalAmount)}</td>
                  <td className="px-3 py-2 text-center">{paymentStats.totalCount}</td>
                  <td className="px-3 py-2 text-center">
                    $ {fmtMoney(paymentStats.totalCount ? paymentStats.totalAmount / paymentStats.totalCount : 0)}
                  </td>
                  <td className="px-3 py-2">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 你可在這裡繼續加：豆子銷售、最近 4 天趨勢等卡片（保留你原有資料計算） */}
      {/* beanStats / last4 已就緒，如需 UI 我可以再補一張表或小圖表 */}
    </div>
  );
}
