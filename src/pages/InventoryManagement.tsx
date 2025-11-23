// src/pages/InventoryManagement.tsx
import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import {
  fetchInventoryRows,
  fetchStockTotals,
  type InventoryRow,
  type StockTotals,
} from "../services/inventory";

const fmt = (n: number) => {
  const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function InventoryManagement() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [totals, setTotals] = useState<StockTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const [rs, t] = await Promise.all([fetchInventoryRows(), fetchStockTotals()]);
      setRows(rs);
      setTotals(t);
      setUpdatedAt(new Date().toLocaleString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const drinks = useMemo(
    () =>
      rows
        .filter((r) => r.category === "drinks")
        .sort((a, b) =>
          a.sub_key === b.sub_key
            ? a.name.localeCompare(b.name) || (Number(a.grams || 0) - Number(b.grams || 0))
            : (a.sub_key || "").localeCompare(b.sub_key || "")
        ),
    [rows]
  );

  const beans = useMemo(
    () =>
      rows
        .filter((r) => r.category === "HandDrip")
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) ||
            (Number(a.grams || 0) - Number(b.grams || 0))
        ),
    [rows]
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-3xl font-extrabold">Inventory Management</h1>
        <div className="ml-auto text-sm text-gray-600">
          Updated: {updatedAt || "--"}
        </div>
        <PosButton variant="confirm" onClick={load} disabled={loading}>
          Refresh
        </PosButton>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-600">Total Stock (kg)</div>
          <div className={`mt-1 text-3xl font-extrabold ${Number(totals?.totalKg || 0) <= 0 ? "text-red-600" : "text-black"}`}>
            {fmt(totals?.totalKg || 0)}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-600">Drinks (kg)</div>
          <div className="mt-1 text-3xl font-extrabold">{fmt(totals?.drinksKg || 0)}</div>
          <div className="mt-1 text-xs text-gray-500">
            Espresso {fmt(totals?.espressoKg || 0)} · Single Origin {fmt(totals?.singleOriginKg || 0)}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-600">Coffee Beans (kg)</div>
          <div className="mt-1 text-3xl font-extrabold">{fmt(totals?.beansKg || 0)}</div>
        </div>
      </div>

      {/* Drinks 列表 */}
      <div className="bg-white border rounded-xl p-4 shadow mb-6">
        <h2 className="text-lg font-extrabold mb-3">Drinks</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white uppercase text-xs font-bold">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Usage / cup (kg)</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Stock (kg)</th>
              </tr>
            </thead>
            <tbody>
              {drinks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                    {loading ? "Loading…" : "No items."}
                  </td>
                </tr>
              ) : (
                drinks.map((r) => (
                  <tr key={r.sku} className="border-t">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">{r.sub_key === "singleOrigin" ? "Single Origin" : "Espresso"}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.usage_per_cup ?? 0)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.price)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(r.stock_kg)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Beans 列表 */}
      <div className="bg-white border rounded-xl p-4 shadow">
        <h2 className="text-lg font-extrabold mb-3">Coffee Beans</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white uppercase text-xs font-bold">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Pack</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Stock (kg)</th>
              </tr>
            </thead>
            <tbody>
              {beans.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                    {loading ? "Loading…" : "No items."}
                  </td>
                </tr>
              ) : (
                beans.map((r) => (
                  <tr key={r.sku} className="border-t">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">{r.grams ? `${r.grams}g` : "—"}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.price)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmt(r.stock_kg)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
