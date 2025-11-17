// modules/inventory/InventoryPage.jsx
import React, { useMemo, useState } from "react";
import { useAppState } from "../../context/AppState";
import PosButton from "../../components/PosButton.jsx";

// 簡單金額顯示
const fmt = (n) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function InventoryPage() {
  const { inventory, setInventory, repairInventory } = useAppState();

  // 陣列防呆（確保為陣列）
  const espresso = useMemo(() => (Array.isArray(inventory?.store?.drinks?.espresso) ? inventory.store.drinks.espresso : []), [inventory]);
  const single   = useMemo(() => (Array.isArray(inventory?.store?.drinks?.singleOrigin) ? inventory.store.drinks.singleOrigin : []), [inventory]);
  const beans    = useMemo(() => (Array.isArray(inventory?.store?.HandDrip) ? inventory.store.HandDrip : []), [inventory]);

  const [tab, setTab] = useState("drinks:espresso"); // drinks:espresso | drinks:singleOrigin | HandDrip
  const [editMode, setEditMode] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", price: 0, usagePerCup: 0.02, grams: 250 });

  const products = useMemo(() => {
    if (tab === "drinks:espresso") return espresso;
    if (tab === "drinks:singleOrigin") return single;
    return beans;
  }, [tab, espresso, single, beans]);

  const handleEdit = (id, field, value) => {
    const v = field === "name" ? value : parseFloat(value) || 0;
    setInventory((prev) => {
      const next = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      if (tab.startsWith("drinks:")) {
        const k = tab.split(":")[1]; // espresso / singleOrigin
        next.store.drinks[k] = (Array.isArray(next.store.drinks[k]) ? next.store.drinks[k] : []).map((p) =>
          p.id === id ? { ...p, [field]: v } : p
        );
      } else {
        next.store.HandDrip = (Array.isArray(next.store.HandDrip) ? next.store.HandDrip : []).map((p) =>
          p.id === id ? { ...p, [field]: v } : p
        );
      }
      return next;
    });
  };

  const deleteOne = (id) => {
    setInventory((prev) => {
      const next = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      if (tab.startsWith("drinks:")) {
        const k = tab.split(":")[1];
        next.store.drinks[k] = (Array.isArray(next.store.drinks[k]) ? next.store.drinks[k] : []).filter((p) => p.id !== id);
      } else {
        next.store.HandDrip = (Array.isArray(next.store.HandDrip) ? next.store.HandDrip : []).filter((p) => p.id !== id);
      }
      return next;
    });
  };

  const addOne = () => {
    const name = (newItem.name || "").trim();
    if (!name) return alert("請輸入商品名稱");
    setInventory((prev) => {
      const next = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      const mkId = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));
      if (tab.startsWith("drinks:")) {
        const k = tab.split(":")[1];
        const list = Array.isArray(next.store.drinks[k]) ? next.store.drinks[k] : [];
        // 同名防重（大小寫無關）
        if (list.some((p) => (p.name || "").trim().toLowerCase() === name.toLowerCase())) return prev;
        list.push({
          id: mkId(),
          name,
          stock: 0,
          price: Number(newItem.price) || 0,
          unit: "kg",
          // 可判別聯合：飲品使用 usagePerCup
          usagePerCup: Number(newItem.usagePerCup) || 0.02
        });
        next.store.drinks[k] = list;
      } else {
        const list = Array.isArray(next.store.HandDrip) ? next.store.HandDrip : [];
        const grams = Number(newItem.grams || 0);
        // 同名+規格（克數）防重
        if (list.some((p) => (p.name || "").trim().toLowerCase() === name.toLowerCase() && Number(p.grams) === grams)) return prev;
        list.push({
          id: mkId(),
          name,
          stock: 0,
          price: Number(newItem.price) || 0,
          unit: "kg",
          // 可判別聯合：豆子使用 grams
          grams
        });
        next.store.HandDrip = list;
      }
      return next;
    });
    setNewItem({ name: "", price: 0, usagePerCup: 0.02, grams: 250 });
  };

  const isDrinks = tab.startsWith("drinks:");
  const gramsChoices = [100, 250, 500, 1000];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-2 mb-4">
        <PosButton variant="tab" selected={!isDrinks} onClick={() => setTab("HandDrip")}>Coffee Beans</PosButton>
        <PosButton variant="tab" selected={tab === "drinks:espresso"} onClick={() => setTab("drinks:espresso")}>Espresso</PosButton>
        <PosButton variant="tab" selected={tab === "drinks:singleOrigin"} onClick={() => setTab("drinks:singleOrigin")}>Single Origin</PosButton>
        <div className="ml-auto flex items-center gap-2">
          <PosButton variant="tab" selected={editMode} onClick={() => setEditMode(!editMode)}>✏️</PosButton>
          <PosButton variant="tab" onClick={repairInventory} title="移除重覆項目">🧹</PosButton>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm text-gray-900">
          <thead className="bg-black text-white uppercase text-xs font-bold">
            <tr>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-center">Price</th>
              <th className="px-4 py-3 text-center">{isDrinks ? "Usage (kg/cup)" : "Grams"}</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {(products || []).map((item) => (
              <tr key={item.id} className="border-t border-gray-200">
                <td className="px-4 py-3 font-semibold">{item.name}</td>
                <td className="px-4 py-3 text-center">
                  {editMode ? (
                    <input
                      type="number" step="1" value={item.price}
                      onChange={(e) => handleEdit(item.id, "price", e.target.value)}
                      className="w-24 border rounded text-center"
                    />
                  ) : `MOP$ ${fmt(item.price)}`}
                </td>
                <td className="px-4 py-3 text-center">
                  {isDrinks ? (
                    editMode ? (
                      <input
                        type="number" step="0.001" value={item.usagePerCup || 0.02}
                        onChange={(e) => handleEdit(item.id, "usagePerCup", e.target.value)}
                        className="w-28 border rounded text-center"
                      />
                    ) : `${((item.usagePerCup || 0.02) * 1000).toFixed(0)} g`
                  ) : (
                    editMode ? (
                      <input
                        type="number" step="1" value={item.grams || 0}
                        onChange={(e) => handleEdit(item.id, "grams", e.target.value)}
                        className="w-24 border rounded text-center"
                      />
                    ) : `${item.grams || 0} g`
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {editMode ? (
                    <PosButton variant="black" onClick={() => deleteOne(item.id)}>🗑 Delete</PosButton>
                  ) : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}

            {/* 新增列 */}
            {editMode && (
              <tr className="border-t bg-gray-50">
                <td className="px-4 py-3">
                  <input
                    type="text" placeholder="Name" value={newItem.name}
                    onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                    className="w-56 border rounded px-2 py-1"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number" step="1" placeholder="Price" value={newItem.price}
                    onChange={(e) => setNewItem((p) => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
                    className="w-24 border rounded text-center"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  {isDrinks ? (
                    <input
                      type="number" step="0.001" placeholder="Usage (kg)"
                      value={newItem.usagePerCup}
                      onChange={(e) => setNewItem((p) => ({ ...p, usagePerCup: parseFloat(e.target.value) || 0 }))}
                      className="w-28 border rounded text-center"
                    />
                  ) : (
                    <select
                      value={newItem.grams}
                      onChange={(e) => setNewItem((p) => ({ ...p, grams: parseInt(e.target.value, 10) }))}
                      className="w-28 border rounded text-center"
                    >
                      {gramsChoices.map((g) => <option key={g} value={g}>{g}g</option>)}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <PosButton variant="red" onClick={addOne}>➕ Add</PosButton>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
