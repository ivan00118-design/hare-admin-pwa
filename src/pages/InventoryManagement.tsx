// src/pages/InventoryManagement.tsx
import React from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchInventoryRows } from "../services/inventory";
import { updateStockKgBySku } from "../services/inventory";

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

const fmt = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function InventoryManagement() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [updatedAt, setUpdatedAt] = React.useState<string>("");
  const [editMode, setEditMode] = React.useState<boolean>(false);
  const [savingSku, setSavingSku] = React.useState<Record<string, boolean>>({});

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = (await fetchInventoryRows()) as Row[];
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

  // KPI
  const totalKg = rows.reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const drinksKg = rows.filter((r) => r.category === "drinks").reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const beansKg = rows.filter((r) => r.category === "HandDrip").reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const espressoKg = rows.filter((r) => r.sub_key === "espresso").reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const singleOriginKg = rows.filter((r) => r.sub_key === "singleOrigin").reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);

  // 區塊明細
  const espressoRows = rows.filter((r) => r.category === "drinks" && r.sub_key === "espresso");
  const singleRows = rows.filter((r) => r.category === "drinks" && r.sub_key === "singleOrigin");
  const beanRows = rows.filter((r) => r.category === "HandDrip");

  // --- 編輯庫存：樂觀更新 + 失敗回滾 ---
  const commitStock = async (sku: string, next: number) => {
    const nextVal = Number.isFinite(next) ? Number(next) : 0;

    setSavingSku((m) => ({ ...m, [sku]: true }));
    // 記下舊值
    const prevRows = rows;
    const old = prevRows.find((r) => r.sku === sku)?.stock_kg ?? 0;

    // 樂觀更新
    setRows((arr) => arr.map((r) => (r.sku === sku ? { ...r, stock_kg: nextVal } : r)));

    try {
      await updateStockKgBySku(sku, nextVal);
      // 成功就保持目前畫面
    } catch (e: any) {
      console.error("[updateStockKgBySku] failed:", e);
      alert(e?.message || "更新庫存失敗");
      // 回滾
      setRows((arr) => arr.map((r) => (r.sku === sku ? { ...r, stock_kg: old } : r)));
    } finally {
      setSavingSku((m) => ({ ...m, [sku]: false }));
    }
  };

  const StockCell = ({ r }: { r: Row }) => {
    const [val, setVal] = React.useState<string>(() => String(r.stock_kg ?? 0));

    React.useEffect(() => {
      // 外部 refresh 後同步顯示
      setVal(String(r.stock_kg ?? 0));
    }, [r.stock_kg]);

    const onCommit = () => {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        alert("請輸入有效的數字（>= 0）");
        setVal(String(r.stock_kg ?? 0));
        return;
      }
      if (num === Number(r.stock_kg || 0)) return; // 未改變
      commitStock(r.sku, num);
    };

    return (
      <div className="flex items-center justify-end gap-2">
        {editMode ? (
          <>
            <input
              className="h-9 w-28 border rounded px-2 text-right"
              type="number"
              step="0.01"
              min="0"
              value={val}
              disabled={!!savingSku[r.sku]}
              onChange={(e) => setVal(e.target.value)}
              onBlur={onCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  setVal(String(r.stock_kg ?? 0));
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="text-xs text-gray-500">kg</span>
          </>
        ) : (
          <span>{fmt(r.stock_kg)}</span>
        )}
      </div>
    );
  };

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
          <PosButton
            variant="tab"
            selected={editMode}
            onClick={() => setEditMode((v) => !v)}
            aria-pressed={editMode}
            title="切換編輯庫存模式"
          >
            ✏️
          </PosButton>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className={`bg-white border rounded-xl p-4 shadow ${totalKg === 0 ? "border-red-300" : "border-gray-200"}`}>
          <div className="text-sm text-gray-500">Total Stock (kg)</div>
          <div className={`mt-1 text-3xl font-extrabold ${totalKg === 0 ? "text-red-500" : "text-[#111]"}`}>{fmt(totalKg)}</div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Drinks (kg)</div>
          <div className="mt-1 text-2xl font-extrabold text-[#111]">{fmt(drinksKg)}</div>
          <div className="text-xs text-gray-500 mt-1">Espresso {fmt(espressoKg)} ・ Single Origin {fmt(singleOriginKg)}</div>
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
                    <td className="px-3 py-2 text-right">
                      <StockCell r={r} />
                    </td>
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
                    <td className="px-3 py-2 text-right">
                      <StockCell r={r} />
                    </td>
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
                    <td className="px-3 py-2 text-right">
                      <StockCell r={r} />
                    </td>
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
