import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton";
import { fetchOrders } from "../services/orders";

// 取得環境變數
const WHATSAPP_PHONE = import.meta?.env?.VITE_WHATSAPP_PHONE || "";

// ---- utils (保留原本邏輯) -------------------------------------------------
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

  // 最後手段
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toDayKey(d);
  return "";
}

function isDeliveryOrder(o: any): boolean {
  if (typeof o?.isDelivery === "boolean") return o.isDelivery;
  return (o?.channel || "") === "DELIVERY";
}

// ------------------------------------------------------------
// 新增的 UI 元件：統計卡片
// ------------------------------------------------------------
const StatCard = ({ title, value, subValue, icon, accentColor = "text-slate-900" }: any) => (
  <div className="bg-white p-5 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-slate-100 flex flex-col justify-between h-36 active:scale-[0.98] transition-transform duration-200">
    <div className="flex justify-between items-start">
      <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">{title}</span>
      <span className="text-2xl filter drop-shadow-sm">{icon}</span>
    </div>
    <div className="mt-auto">
      <h3 className={`text-2xl font-bold ${accentColor} tracking-tight`}>{value}</h3>
      {subValue && <p className="text-xs text-slate-400 mt-1 font-medium">{subValue}</p>}
    </div>
  </div>
);

export default function Dashboard() {
  const [picked, setPicked] = useState(todayKey());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
      status: "active",
      page: 0,
      pageSize: 1000,
    })
      .then((res) => setRows(Array.isArray(res?.rows) ? res.rows : []))
      .finally(() => setLoading(false));
  }, [picked]);

  const validOrders = useMemo(() => rows.filter((o: any) => !o?.voided), [rows]);

  const ordersOfDay = useMemo(
    () => validOrders.filter((o) => orderDayKey(o) === picked),
    [validOrders, picked]
  );

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

  const dayAOV = byType.dayCount ? byType.dayRevenue / byType.dayCount : 0;
  const orderAOV = byType.orderCount ? byType.orderRevenue / byType.orderCount : 0;
  const deliveryAOV = byType.deliveryCount ? byType.deliveryRevenue / byType.deliveryCount : 0;

  const paymentTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of ordersOfDay) {
      const k = o?.paymentMethod || "—";
      map.set(k, (map.get(k) || 0) + (Number(o?.total) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [ordersOfDay]);

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
    <div className="space-y-6">
      
      {/* 頂部標題與控制列 */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">Business Overview</p>
        </div>
        
        <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
          <input
            type="date"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="h-10 border-0 bg-transparent text-slate-700 font-semibold focus:ring-0 text-sm px-2 cursor-pointer"
          />
          <div className="h-6 w-px bg-slate-200 mx-1"></div>
          <button
            onClick={sendToWhatsApp}
            className="h-10 px-4 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 active:scale-95 transition-all flex items-center gap-2"
            title="Send Summary"
          >
            <span>🧾</span>
            <span className="hidden sm:inline">Roll Shift</span>
          </button>
        </div>
      </header>

      {/* 數據卡片區塊 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 訂單營收 */}
        <StatCard 
          title="Order Revenue" 
          value={`$ ${fmtMoney(byType.orderRevenue)}`} 
          subValue={`${byType.orderCount} orders · AOV $${fmtMoney(orderAOV)}`}
          icon="💰" 
        />
        
        {/* 外送營收 (強調色) */}
        <StatCard 
          title="Delivery Revenue" 
          value={`$ ${fmtMoney(byType.deliveryRevenue)}`} 
          subValue={`${byType.deliveryCount} deliveries · AOV $${fmtMoney(deliveryAOV)}`}
          icon="🛵"
          accentColor="text-rose-600"
        />

        {/* 總訂單數 */}
        <StatCard 
          title="Total Orders" 
          value={byType.dayCount} 
          subValue="Valid orders only"
          icon="🧾" 
        />

        {/* 總平均客單價 */}
        <StatCard 
          title="Avg. Order Value" 
          value={`$ ${fmtMoney(dayAOV)}`} 
          subValue="Combined revenue / count"
          icon="📊" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Breakdown */}
        <section className="bg-white rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden">
          <div className="p-5 border-b border-slate-50">
            <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
              <span>💳</span> Payment Breakdown
            </h2>
          </div>
          <div className="p-0">
            {paymentTotals.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No payment records yet.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {paymentTotals.map(([method, amt]) => (
                  <div key={method} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                    <span className="text-sm font-medium text-slate-700">{method}</span>
                    <span className="text-sm font-bold text-slate-900 bg-slate-100 px-2 py-1 rounded-md">
                      MOP$ {fmtMoney(amt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Last 4 Days Trend */}
        <section className="bg-white rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden">
          <div className="p-5 border-b border-slate-50">
            <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
              <span>📈</span> Recent Trend
            </h2>
          </div>
          <div className="divide-y divide-slate-50">
            {last4.map((d) => (
              <div key={d.day} className="p-4 flex items-center justify-between hover:bg-slate-50/50">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-800">{d.day}</span>
                  <span className="text-xs text-slate-400 font-medium">{d.count} Orders</span>
                </div>
                <span className={`text-sm font-bold ${d.day === picked ? 'text-blue-600' : 'text-slate-600'}`}>
                  MOP$ {fmtMoney(d.revenue)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Coffee Beans Report */}
      <section className="bg-white rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden">
        <div className="p-5 border-b border-slate-50 flex justify-between items-center">
          <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <span>☕</span> Coffee Beans Sold
          </h2>
          <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded-full uppercase tracking-wide">
            Hand Drip Only
          </span>
        </div>
        
        {beanStats.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-3xl mb-2">🫘</p>
            <p className="text-sm">No coffee bean sales recorded today.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Bean Name</th>
                  <th className="px-5 py-3 text-left">Variants</th>
                  <th className="px-5 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {beanStats.map(([name, rec]) => {
                  const variants = Array.from(rec.variants.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([g, q]) => (g ? `${g}g × ${q}` : `— × ${q}`))
                    .join(", ");
                  return (
                    <tr key={name} className="group hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 font-medium text-slate-900">{name}</td>
                      <td className="px-5 py-4 text-slate-500 font-mono text-xs">{variants || "—"}</td>
                      <td className="px-5 py-4 text-right font-bold text-slate-700">{rec.qty}</td>
                      <td className="px-5 py-4 text-right font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        MOP$ {fmtMoney(rec.revenue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
