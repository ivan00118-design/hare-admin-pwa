// src/pages/InventoryManagement.tsx
import React from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchInventoryRows } from "../services/inventory";

/** 與 v_inventory 對應的列型別 */
type Row = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number | null;
  stock_kg: number | null; // 可能為 null，前端以 0 安全處理
};

/** 顯示金額/數值：可接受 number | null | undefined，避免 TS 抱怨 */
const fmt = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function InventoryManagement() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [updatedAt, setUpdatedAt] = React.useState<string>("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = (await fetchInventoryRows()) as Row[]; // 來自 v_inventory
      setRows(Array.isArray(data) ? data : []);
      setUpdatedAt(new Date().toLocaleString());
    } catch (e) {
      console.error("[Inventory] refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // ---- KPI 彙總（useMemo 降低重算）----
  const { totalKg, drinksKg, beansKg, espressoKg, singleOriginKg } = React.useMemo(() => {
    const safe = (x: number | null | undefined) => Number(x) || 0;

    const _totalKg = rows.reduce((s, r) => s + safe(r.stock_kg), 0);
    const _drinksKg = rows
      .filter((r) => r.category === "drinks")
      .reduce((s, r) => s + safe(r.stock_kg), 0);
    const _beansKg = rows
      .filter((r) => r.category === "HandDrip")
      .reduce((s, r) => s + safe(r.stock_kg), 0);
    const _espressoKg = rows
      .filter((r) => r.sub_key === "espresso")
      .reduce((s, r) => s + safe(r.stock_kg), 0);
    const _singleOriginKg = rows
      .filter((r) => r.sub_key === "singleOrigin")
      .reduce((s, r) => s + safe(r.stock_kg), 0);

    return {
      totalKg: _totalKg,
      drinksKg: _drinksKg,
      beansKg: _beansKg,
      espressoKg: _espressoKg,
      singleOriginKg: _singleOriginKg,
    };
  }, [rows]);

  // ---- 區塊明細 ----
  const espressoRows = React.useMemo(
    () => rows.filter((r) => r.category === "drinks" && r.sub_key === "espresso"),
    [rows]
  );
  const singleRows = React.useMemo(
    () => rows.filter((r) => r.category === "drinks" && r.sub_key === "singleOrigin"),
    [rows]
  );
  const beanRows = React.useMemo(
    () => rows.filter((r) => r.category === "HandDrip"),
    [rows]
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-2xl font-extrabold">Inventory Management</h1>
        <div className="ml-auto flex items-center gap-3 text-sm text-gray-600">
          Updated: {updatedAt || "—"}
          <PosButton
            variant="confirm"
            className="!bg-white !text-black !border !border-gray-300"
            onClick={refresh}
            disabled={loading}
          >
            Refresh
          </PosButton>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Total Stock (kg)</div>
          <div className={`mt-1 text-3xl font-extrabold ${totalKg === 0 ? "text-red-500" : "text-[#111]"}`}>
            {fmt(totalKg)}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Drinks (kg)</div>
          <div className="mt-1 text-2xl font-extrabold text-[#111]">{fmt(drinksKg)}</div>
          <div className="text-xs text-gray-500 mt-1">
            Espresso {fmt(espressoKg)} ・ Single Origin {fmt(singleOriginKg)}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Coffee Beans (kg)</div>
          <div className="mt-1 text-2xl font-extrabold text-[#111]">{fmt(beansKg)}</div>
        </div>
      </div>

      {/* Drinks – Espresso */}
      <div className="bg-white border rounded-xl p-4 shadow mb-6">
        <h2 className="text-lg font-extrabold mb-3">Espresso (drinks)</h2>
        {espressoRows.length === 0 ? (
          <p className="text-gray-500">{loading ? "Loading…" : "No records."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black text-white uppercase text-xs font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Stock (kg)</th>
                </tr>
              </thead>
              <tbody>
                {espressoRows.map((r) => (
                  <tr key={r.sku} className="border-t">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.stock_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drinks – Single Origin */}
      <div className="bg-white border rounded-xl p-4 shadow mb-6">
        <h2 className="text-lg font-extrabold mb-3">Single Origin (drinks)</h2>
        {singleRows.length === 0 ? (
          <p className="text-gray-500">{loading ? "Loading…" : "No records."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black text-white uppercase text-xs font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Stock (kg)</th>
                </tr>
              </thead>
              <tbody>
                {singleRows.map((r) => (
                  <tr key={r.sku} className="border-t">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.stock_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Beans */}
      <div className="bg-white border rounded-xl p-4 shadow">
        <h2 className="text-lg font-extrabold mb-3">Coffee Beans</h2>
        {beanRows.length === 0 ? (
          <p className="text-gray-500">{loading ? "Loading…" : "No records."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black text-white uppercase text-xs font-bold">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Variant</th>
                  <th className="px-3 py-2 text-right">Stock (kg)</th>
                </tr>
              </thead>
              <tbody>
                {beanRows.map((r) => (
                  <tr key={r.sku} className="border-t">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-gray-600">{r.grams ? `${r.grams}g` : "—"}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.stock_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
