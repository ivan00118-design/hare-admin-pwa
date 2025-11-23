// src/pages/InventoryManagement.tsx
import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchStockTotals, type StockTotals } from "../services/inventory";

const fmtKg = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function InventoryManagement() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [totals, setTotals] = useState<StockTotals | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const t = await fetchStockTotals();
      // 直接設成完整的 StockTotals（包含 espressoKg / singleOriginKg）
      setTotals(t);
      setRefreshedAt(new Date().toLocaleString());
    } catch (e: any) {
      console.error("[InventoryManagement] fetchStockTotals failed:", e);
      setErr(e?.message ?? "Failed to load stock totals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cards = useMemo(() => {
    const z = totals || {
      totalKg: 0,
      drinksKg: 0,
      beansKg: 0,
      espressoKg: 0,
      singleOriginKg: 0,
    };
    return [
      {
        title: "Total Stock (kg)",
        value: z.totalKg,
        highlight: true,
        note: "",
      },
      {
        title: "Drinks (kg)",
        value: z.drinksKg,
        note: `Espresso ${fmtKg(z.espressoKg)} · Single Origin ${fmtKg(z.singleOriginKg)}`,
      },
      {
        title: "Coffee Beans (kg)",
        value: z.beansKg,
        note: "",
      },
    ];
  }, [totals]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      <div className="flex items-end gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">Inventory Management</h1>
        <div className="ml-auto flex items-center gap-2">
          {refreshedAt ? (
            <span className="text-xs text-gray-500">Updated: {refreshedAt}</span>
          ) : null}
          <PosButton
            variant="confirm"
            className="!bg-white !text-black !border !border-gray-300 shadow hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
            style={{ colorScheme: "light" }}
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </PosButton>
        </div>
      </div>

      {err ? (
        <div className="mb-4 p-3 rounded border border-red-300 bg-red-50 text-red-700 text-sm">
          {err}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div
            key={c.title}
            className={`bg-white border border-gray-200 rounded-xl p-4 shadow ${
              c.highlight ? "ring-2 ring-red-200" : ""
            }`}
          >
            <div className="text-sm text-gray-500">{c.title}</div>
            <div className={`mt-1 text-2xl font-extrabold ${c.highlight ? "text-[#dc2626]" : "text-[#111]"}`}>
              {fmtKg(c.value)}
            </div>
            {c.note ? <div className="mt-1 text-xs text-gray-500">{c.note}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
