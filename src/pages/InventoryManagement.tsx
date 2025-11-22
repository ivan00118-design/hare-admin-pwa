// src/pages/InventoryManagement.tsx
import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchStockTotals } from "../services/inventory";
import { supabase } from "../supabaseClient";

const fmt = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function InventoryManagement() {
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<{
    totalKg: number;
    drinksKg: number;
    beansKg: number;
    espressoKg: number;
    singleOriginKg: number;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const t = await fetchStockTotals();
      setTotals(t);
    } catch (e) {
      console.error("[InventoryManagement] load totals failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    // 訂閱 Realtime：有庫存/訂單異動 → 重新拉取
    const ch = supabase
      .channel("inv_totals")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_inventory" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_ledger" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const cards = useMemo(() => {
    const t = totals || { totalKg: 0, drinksKg: 0, beansKg: 0, espressoKg: 0, singleOriginKg: 0 };
    return [
      {
        title: "Total Stock (kg)",
        value: t.totalKg,
        accent: "#111",
        help: "v_inventory → sum(stock_kg)",
      },
      {
        title: "Drinks Stock (kg)",
        value: t.drinksKg,
        accent: "#0ea5e9",
        help: "Espresso / Single Origin 合計",
      },
      {
        title: "Beans Stock (kg)",
        value: t.beansKg,
        accent: "#22c55e",
        help: "HandDrip（包裝豆）合計",
      },
      {
        title: "— Espresso (kg)",
        value: t.espressoKg,
        accent: "#6366f1",
        help: "Drinks 中 espresso",
      },
      {
        title: "— Single Origin (kg)",
        value: t.singleOriginKg,
        accent: "#f59e0b",
        help: "Drinks 中 single origin",
      },
    ];
  }, [totals]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">Inventory Management</h1>
        <div className="ml-auto">
          <PosButton
            variant="confirm"
            className="!bg-white !text-black !border !border-gray-300 shadow hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
            onClick={load}
            disabled={loading}
            title="Reload from DB"
          >
            ↻ Refresh
          </PosButton>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.title} className="bg-white border border-gray-200 rounded-xl p-4 shadow">
            <div className="text-sm text-gray-500">{c.title}</div>
            <div className="mt-1 text-2xl font-extrabold" style={{ color: c.accent }}>
              {loading && totals === null ? "…" : fmt(c.value)}
            </div>
            <div className="mt-1 text-xs text-gray-500">{c.help}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-sm text-gray-500">
        ※ 本頁面每次開啟或偵測到 DB 異動（product_inventory / stock_ledger / order_items）都會自動重新計算，
        不依賴前端暫存，因此不會再出現「刷新後歸 0」的情況。
      </div>
    </div>
  );
}
