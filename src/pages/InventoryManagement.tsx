// src/pages/InventoryManagement.tsx
import React from "react";
import PosButton from "../components/PosButton.jsx";
import {
  fetchInventoryRows,
  setStockKg,
  upsertProduct,
  type InventoryRow,
} from "../services/inventory";

type Row = InventoryRow;

const fmt = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const genSku = () =>
  (crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));

export default function InventoryManagement() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [updatedAt, setUpdatedAt] = React.useState<string>("");

  // Add form
  const [adding, setAdding] = React.useState(false);
  const [addForm, setAddForm] = React.useState<{
    category: "drinks" | "HandDrip";
    name: string;
    price: number;
    sub_key: "espresso" | "singleOrigin"; // drinks
    usage_per_cup: number;                 // drinks
    grams: number;                         // beans
  }>({
    category: "drinks",
    name: "",
    price: 0,
    sub_key: "espresso",
    usage_per_cup: 0.02,
    grams: 250,
  });

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchInventoryRows();
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
  const drinksKg = rows
    .filter((r) => r.category === "drinks")
    .reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const beansKg = rows
    .filter((r) => r.category === "HandDrip")
    .reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const espressoKg = rows
    .filter((r) => r.sub_key === "espresso")
    .reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);
  const singleOriginKg = rows
    .filter((r) => r.sub_key === "singleOrigin")
    .reduce((s, r) => s + (Number(r.stock_kg) || 0), 0);

  // 明細分組
  const espressoRows = rows.filter((r) => r.category === "drinks" && r.sub_key === "espresso");
  const singleRows = rows.filter((r) => r.category === "drinks" && r.sub_key === "singleOrigin");
  const beanRows = rows.filter((r) => r.category === "HandDrip");

  // 編輯庫存（onBlur 觸發）
  const onChangeStock = async (sku: string, next: string) => {
    const val = parseFloat(next);
    if (!Number.isFinite(val) || val < 0) {
      alert("請輸入有效數值（>= 0）");
      return;
    }
    try {
      await setStockKg(sku, val);
      // 本地同步
      setRows((prev) => prev.map((r) => (r.sku === sku ? { ...r, stock_kg: val } : r)));
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "更新庫存失敗");
    }
  };

  // 新增商品（走 RPC upsert_product_unified）
  const onAddProduct = async () => {
    const name = (addForm.name || "").trim();
    if (!name) return alert("請輸入商品名稱");
    const price = Number(addForm.price) || 0;

    try {
      setAdding(true);
      if (addForm.category === "drinks") {
        const sku = `${genSku()}-${addForm.sub_key}`;
        await upsertProduct({
          sku,
          name,
          category: "drinks",
          sub_key: addForm.sub_key,
          usage_per_cup: Number(addForm.usage_per_cup) || 0.02,
          price,
        });
      } else {
        const g = Number(addForm.grams) || 0;
        if (!g) return alert("請選擇克數");
        const sku = `${genSku()}-${g}g`;
        await upsertProduct({
          sku,
          name,
          category: "HandDrip",
          grams: g,
          price,
        });
      }
      await refresh();
      setAddForm({
        category: "drinks",
        name: "",
        price: 0,
        sub_key: "espresso",
        usage_per_cup: 0.02,
        grams: 250,
      });
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "新增商品失敗");
    } finally {
      setAdding(false);
    }
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

      {/* 新增商品（RPC） */}
      <div className="bg-white border rounded-xl p-4 shadow mb-6">
        <h2 className="text-lg font-extrabold mb-3">Add New Product (RPC)</h2>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-1">
            <label className="block text-xs text-gray-600 mb-1">Category</label>
            <select
              className="h-10 border rounded px-2 w-full"
              value={addForm.category}
              onChange={(e) =>
                setAddForm((p) => ({ ...p, category: e.target.value as "drinks" | "HandDrip" }))
              }
            >
              <option value="drinks">drinks</option>
              <option value="HandDrip">HandDrip</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Name</label>
            <input
              className="h-10 border rounded px-2 w-full"
              placeholder="Product name"
              value={addForm.name}
              onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          <div className="md:col-span-1">
            <label className="block text-xs text-gray-600 mb-1">Price</label>
            <input
              className="h-10 border rounded px-2 w-full"
              type="number"
              step="1"
              value={addForm.price}
              onChange={(e) => setAddForm((p) => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
            />
          </div>

          {addForm.category === "drinks" ? (
            <>
              <div className="md:col-span-1">
                <label className="block text-xs text-gray-600 mb-1">Sub Key</label>
                <select
                  className="h-10 border rounded px-2 w-full"
                  value={addForm.sub_key}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, sub_key: e.target.value as "espresso" | "singleOrigin" }))
                  }
                >
                  <option value="espresso">espresso</option>
                  <option value="singleOrigin">singleOrigin</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs text-gray-600 mb-1">Usage (kg/cup)</label>
                <input
                  className="h-10 border rounded px-2 w-full"
                  type="number"
                  step="0.001"
                  value={addForm.usage_per_cup}
                  onChange={(e) => setAddForm((p) => ({ ...p, usage_per_cup: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-1">
              <label className="block text-xs text-gray-600 mb-1">Grams</label>
              <select
                className="h-10 border rounded px-2 w-full"
                value={addForm.grams}
                onChange={(e) => setAddForm((p) => ({ ...p, grams: parseInt(e.target.value, 10) }))}
              >
                {[100, 250, 500, 1000].map((g) => (
                  <option key={g} value={g}>
                    {g}g
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="md:col-span-1">
            <PosButton
              variant="red"
              className="w-full h-10"
              onClick={onAddProduct}
              disabled={adding}
              title="Create via RPC"
            >
              ＋ Add
            </PosButton>
          </div>
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
                      <input
                        className="h-9 w-28 border rounded px-2 text-right"
                        type="number"
                        step="0.001"
                        defaultValue={Number(r.stock_kg || 0)}
                        onBlur={(e) => onChangeStock(r.sku, e.target.value)}
                      />
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
                      <input
                        className="h-9 w-28 border rounded px-2 text-right"
                        type="number"
                        step="0.001"
                        defaultValue={Number(r.stock_kg || 0)}
                        onBlur={(e) => onChangeStock(r.sku, e.target.value)}
                      />
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
                      <input
                        className="h-9 w-28 border rounded px-2 text-right"
                        type="number"
                        step="0.001"
                        defaultValue={Number(r.stock_kg || 0)}
                        onBlur={(e) => onChangeStock(r.sku, e.target.value)}
                      />
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
