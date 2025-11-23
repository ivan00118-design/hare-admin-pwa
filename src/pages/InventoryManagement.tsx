import React from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchInventoryRows } from "../services/inventory";

/** 與 v_inventory 對齊的列型別 */
type Row = {
  sku: string;
  name: string;
  category: "drinks" | "HandDrip";
  sub_key: "espresso" | "singleOrigin" | null;
  grams: number | null;
  usage_per_cup: number | null;
  price: number | null;
  stock_kg: number | null;
};

/** 數字格式化（最多兩位小數，去尾零） */
const fmt = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};
const nz = (n: number | null | undefined) => Number(n) || 0;

export default function InventoryManagement() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [updatedAt, setUpdatedAt] = React.useState<string>("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = (await fetchInventoryRows()) as Row[] | null | undefined;
      setRows(Array.isArray(data) ? data : []);
      setUpdatedAt(new Date().toLocaleString());
    } catch (e) {
      console.error("[Inventory] refresh failed:", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // ===== KPI（彙總）=====
  const totalKg = rows.reduce((s, r) => s + nz(r.stock_kg), 0);
  const drinksKg = rows
    .filter((r) => r.category === "drinks")
    .reduce((s, r) => s + nz(r.stock_kg), 0);
  const beansKg = rows
    .filter((r) => r.category === "HandDrip")
    .reduce((s, r) => s + nz(r.stock_kg), 0);
  const espressoKg = rows
    .filter((r) => r.sub_key === "espresso")
    .reduce((s, r) => s + nz(r.stock_kg), 0);
  const singleOriginKg = rows
    .filter((r) => r.sub_key === "singleOrigin")
    .reduce((s, r) => s + nz(r.stock_kg), 0);

  // ===== 區塊明細 =====
  const espressoRows = rows.filter((r) => r.category === "drinks" && r.sub_key === "espresso");
  const singleRows = rows.filter((r) => r.category === "drinks" && r.sub_key === "singleOrigin");
  const beanRows = rows.filter((r) => r.category === "HandDrip");

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
            title="Reload inventory from DB"
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
