import React, { useEffect, useMemo, useState } from "react";
import { fetchOrders } from "../services/orders";
// 引入 Logo
import Logo from "../assets/logo.png";

// 取得環境變數
const WHATSAPP_PHONE = import.meta?.env?.VITE_WHATSAPP_PHONE || "";

// ---- Utils (保持不變) -------------------------------------------------
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
  if (typeof raw === 'number') return toDayKey(new Date(raw));
  const s = String(raw);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const y = slash[1];
    const m = slash[2].padStart(2, "0");
    const d = slash[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toDayKey(d);
  return "";
}

function isDeliveryOrder(o: any): boolean {
  if (typeof o?.isDelivery === "boolean") return o.isDelivery;
  return (o?.channel || "") === "DELIVERY";
}

function isCoffeeBean(item: any): boolean {
  const cat = (item.category || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  return (
    cat.includes("handdrip") || 
    cat.includes("bean") || 
    cat.includes("coffee") || 
    cat.includes("drip") ||
    name.includes("bean") || 
    name.includes("豆")
  );
}

// ------------------------------------------------------------
// 新版 UI 元件 (對應預覽圖設計)
// ------------------------------------------------------------

// 1. 數據卡片：加入顏色主題與圖示背景
const StatCard = ({ title, value, subValue, icon, theme = "blue" }: any) => {
  const themeStyles: any = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
    gray: "bg-gray-100 text-gray-600",
  };
  
  const activeTheme = themeStyles[theme] || themeStyles.gray;

  return (
    <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between h-32 active:scale-95 transition-all duration-200">
      <div className="flex justify-between items-start">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeTheme}`}>
          <span className="text-xl filter drop-shadow-sm">{icon}</span>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{title}</p>
        <h3 className="text-2xl font-extrabold text-gray-900 tracking-tight leading-none">{value}</h3>
        {subValue && <p className="text-[10px] text-gray-400 mt-1 font-medium truncate">{subValue}</p>}
      </div>
    </div>
  );
};

// 2. 列表項目：取代傳統表格列，更適合手機閱讀
const ListItem = ({ icon, title, subtitle, rightTop, rightBottom, iconBg = "bg-gray-100", textColor = "text-gray-900" }: any) => (
  <div className="flex items-center justify-between p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors border-b border-gray-50 last:border-0 cursor-default">
    <div className="flex items-center gap-3 overflow-hidden">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <p className="font-semibold text-gray-900 text-sm truncate">{title}</p>
        <p className="text-xs text-gray-500 truncate">{subtitle}</p>
      </div>
    </div>
    <div className="text-right shrink-0 ml-2">
      <p className={`font-bold text-sm ${textColor}`}>{rightTop}</p>
      <p className="text-xs text-gray-400">{rightBottom}</p>
    </div>
  </div>
);

// ------------------------------------------------------------
// 主頁面邏輯
// ------------------------------------------------------------
export default function Dashboard() {
  const [picked, setPicked] = useState(todayKey());
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const base = new Date(picked);
    if (Number.isNaN(base.getTime())) return;

    const from = new Date(base);
    from.setDate(base.getDate() - 7);
    from.setHours(0, 0, 0, 0);

    const to = new Date(base);
    to.setDate(base.getDate() + 2);
    to.setHours(0, 0, 0, 0);

    setLoading(true);
    fetchOrders({
      from,
      to,
      // 移除 status: "active"，確保能抓到 completed 或其他狀態的訂單
      page: 0,
      pageSize: 2000, 
    })
      .then((res) => setRows(Array.isArray(res?.rows) ? res.rows : []))
      .catch(err => {
        console.error("Dashboard fetch error:", err);
        setRows([]);
      })
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
    const map = new Map<string, { qty: number; revenue: number; category: string, variants: Map<string, number> }>();
    
    for (const o of ordersOfDay) {
      for (const it of (o.items || []) as any[]) {
        if (!isCoffeeBean(it)) continue;

        const name = (it.name || "Unknown").trim();
        const cat = it.category || "Uncategorized";
        const key = name;

        if (!map.has(key)) {
          map.set(key, { qty: 0, revenue: 0, category: cat, variants: new Map() });
        }
        
        const rec = map.get(key)!;
        const q = Number(it.qty) || 0;
        const price = Number(it.price) || 0;
        
        rec.qty += q;
        rec.revenue += q * price;

        const variantInfo = it.grams ? `${it.grams}g` : (it.variant || "");
        if (variantInfo) {
           rec.variants.set(variantInfo, (rec.variants.get(variantInfo) || 0) + q);
        }
      }
    }
    
    return Array.from(map.entries())
      .map(([k, v]) => ({ name: k, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
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
    lines.push("Coffee Beans Sold:");
    if (beanStats.length === 0) lines.push("  - (none)");
    else {
      for (const item of beanStats) {
        const variants = Array.from(item.variants.entries())
          .map(([v, q]) => `${v}×${q}`)
          .join(", ");
        lines.push(`  - ${item.name}: Qty ${item.qty} ${variants ? `(${variants}) ` : ""}— $ ${fmtMoney(item.revenue)}`);
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

  // ---- UI Layout ---------------------------------------------------
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      
      {/* Header Area */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-gray-100 p-2 flex items-center justify-center shrink-0">
            <img src={Logo} alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-none">Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1 font-medium tracking-wide">Business Overview</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm w-full md:w-auto">
          <input
            type="date"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="h-10 border-0 bg-transparent text-gray-700 font-bold focus:ring-0 text-sm px-3 cursor-pointer outline-none flex-1"
          />
          <div className="h-6 w-px bg-gray-200 mx-1"></div>
          <button
            onClick={sendToWhatsApp}
            className="h-10 px-4 bg-gray-900 text-white text-sm font-bold rounded-lg hover:bg-gray-800 active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap shadow-md shadow-gray-200"
          >
            <span>🧾</span>
            <span className="hidden sm:inline">Roll Shift</span>
          </button>
        </div>
      </header>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          title="Revenue" 
          value={`$${fmtMoney(byType.orderRevenue)}`} 
          subValue={`${byType.orderCount} Orders`}
          icon="💰"
          theme="emerald"
        />
        <StatCard 
          title="Delivery" 
          value={`$${fmtMoney(byType.deliveryRevenue)}`} 
          subValue={`${byType.deliveryCount} Trips`}
          icon="🛵"
          theme="rose"
        />
        <StatCard 
          title="Total Orders" 
          value={byType.dayCount} 
          subValue="Valid Only"
          icon="🧾"
          theme="blue"
        />
        <StatCard 
          title="Avg. Value" 
          value={`$${fmtMoney(dayAOV)}`} 
          subValue="Per Order"
          icon="📊"
          theme="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Breakdown Section */}
        <section className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-5 border-b border-gray-50 flex justify-between items-center">
            <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <span className="bg-blue-50 text-blue-600 w-8 h-8 rounded-lg flex items-center justify-center text-sm">💳</span> 
              Payments
            </h2>
          </div>
          <div className="flex-1">
            {paymentTotals.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">
                {loading ? "Loading..." : "No payment records."}
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {paymentTotals.map(([method, amt]) => (
                  <ListItem 
                    key={method}
                    icon={method.toLowerCase().includes('cash') ? '💵' : '📱'}
                    title={method}
                    subtitle="Payment Method"
                    rightTop={`$ ${fmtMoney(amt)}`}
                    rightBottom="Total"
                    iconBg="bg-blue-50 text-blue-600"
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Recent Trend Section */}
        <section className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-5 border-b border-gray-50 flex justify-between items-center">
            <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <span className="bg-amber-50 text-amber-600 w-8 h-8 rounded-lg flex items-center justify-center text-sm">📈</span> 
              Trend
            </h2>
            <span className="text-xs font-bold text-gray-400 uppercase">Last 4 Days</span>
          </div>
          <div className="flex-1">
            <div className="divide-y divide-gray-50">
              {last4.map((d) => (
                <ListItem 
                  key={d.day}
                  icon="📅"
                  title={d.day}
                  subtitle={`${d.count} Orders`}
                  rightTop={`$ ${fmtMoney(d.revenue)}`}
                  rightBottom={d.day === picked ? "Current" : "Past"}
                  iconBg={d.day === picked ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-400"}
                  textColor={d.day === picked ? "text-amber-600" : "text-gray-900"}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Coffee Beans Sold Section */}
      <section className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-50 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center text-xl">
              ☕
            </div>
            <div>
              <h2 className="font-bold text-lg text-gray-800">Coffee Beans</h2>
              <p className="text-xs text-gray-500">Beans & Drip Sales</p>
            </div>
          </div>
          <span className="text-xs font-bold bg-gray-100 text-gray-500 px-3 py-1 rounded-full">
            {beanStats.length} Items
          </span>
        </div>
        
        {beanStats.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-4xl mb-3 opacity-30">🫘</p>
            <p className="text-sm font-medium">{loading ? "Loading..." : "No coffee beans sold today."}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {beanStats.map((item, idx) => {
              const variants = Array.from(item.variants.entries())
                .map(([v, q]) => `${v}×${q}`)
                .join(", ");

              return (
                <ListItem 
                  key={`${item.name}-${idx}`}
                  icon="🫘"
                  title={item.name}
                  subtitle={variants || "Standard"}
                  rightTop={`$ ${fmtMoney(item.revenue)}`}
                  rightBottom={`Qty: ${item.qty}`}
                  iconBg="bg-orange-50 text-orange-600"
                />
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
