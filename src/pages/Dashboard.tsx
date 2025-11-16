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

  const validOrders = useMemo(() => orders.filter((o) => !o.voided), [orders]);
  const ordersOfDay = useMemo(() => validOrders.filter((o) => dateKey(o.createdAt) === picked), [validOrders, picked]);

  const dayRevenue = ordersOfDay.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const dayCount = ordersOfDay.length;
  const dayAOV = dayCount ? dayRevenue / dayCount : 0;

  const paymentTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of ordersOfDay) {
      const k = o.paymentMethod || "—";
      map.set(k, (map.get(k) || 0) + (Number(o.total) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [ordersOfDay]);

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

      {/* KPI 與表格（同你舊版 Dashboard 結構） */}
      {/* ...（略，與你現有版面一致） */}
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

      {/* 付款彙總 / 豆子銷售 / 最近 4 天表格：排版延續你原本 Dashboard.jsx */}
      {/* 這裡省略 UI 細節（與舊版一致即可） */}
    </div>
  );
}
