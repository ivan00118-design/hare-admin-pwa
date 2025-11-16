import React, { useState } from "react";
import { useAppState, type DrinkSubKey, type DrinkProduct } from "../context/AppState";
/* @ts-ignore */ import PosButton from "../../components/PosButton.jsx";

export default function InventoryPage() {
  const { inventory, setInventory } = useAppState();

  // 安全地取出 drinks 陣列
  const drinks: Record<DrinkSubKey, DrinkProduct[]> = {
    espresso: Array.isArray(inventory?.store?.drinks?.espresso) ? inventory.store.drinks.espresso : [],
    singleOrigin: Array.isArray(inventory?.store?.drinks?.singleOrigin) ? inventory.store.drinks.singleOrigin : [],
  };

  const [editMode, setEditMode] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    stock: 0,
    price: 0,
    usagePerCup: 0.02,
  });

  const handleChange = (
    subKey: DrinkSubKey,
    id: string,
    field: keyof DrinkProduct | "usagePerCup",
    value: string
  ) => {
    setInventory((prev) => {
      const next = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      const v = field === "name" ? value : parseFloat(value) || 0;
      const list = Array.isArray(next.store?.drinks?.[subKey]) ? next.store.drinks[subKey] : [];
      next.store.drinks[subKey] = list.map((item: DrinkProduct) => (item.id === id ? { ...item, [field]: v as any } : item));
      return next;
    });
  };

  const handleAdd = (subKey: DrinkSubKey) => {
    if (!(newProduct.name || "").trim()) return alert("請輸入商品名稱");
    setInventory((prev) => {
      const next = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      const list = Array.isArray(next.store?.drinks?.[subKey]) ? next.store.drinks[subKey] : [];
      // 避免重複名稱
      const nameKey = newProduct.name.trim().toLowerCase();
      if (list.some((p: any) => (p?.name || "").trim().toLowerCase() === nameKey)) return prev;

      list.push({
        id: crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        name: newProduct.name.trim(),
        stock: Number(newProduct.stock) || 0,
        price: Number(newProduct.price) || 0,
        usagePerCup: Number(newProduct.usagePerCup) || 0.02,
        unit: "kg",
      } as DrinkProduct);

      next.store.drinks[subKey] = list;
      return next;
    });
    setNewProduct({ name: "", stock: 0, price: 0, usagePerCup: 0.02 });
  };

  const handleDelete = (subKey: DrinkSubKey, id: string) => {
    setInventory((prev) => {
      const next = typeof structuredClone === "function" ? structuredClone(prev) : JSON.parse(JSON.stringify(prev));
      const list = Array.isArray(next.store?.drinks?.[subKey]) ? next.store.drinks[subKey] : [];
      next.store.drinks[subKey] = list.filter((p: any) => p.id !== id);
      return next;
    });
  };

  const fmtKg = (n: number) => (Number(n).toFixed(2));

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-extrabold text-black">Inventory Management</h1>
        <PosButton variant={editMode ? "black" : "red"} onClick={() => setEditMode(!editMode)}>
          {editMode ? "💾 Save" : "✏️ Edit Mode"}
        </PosButton>
      </div>

      {(["espresso", "singleOrigin"] as DrinkSubKey[]).map((subKey) => (
        <div key={subKey} className="bg-white rounded-xl shadow-xl p-4 mb-6 border border-gray-200">
          <h2 className="text-lg font-extrabold text-black mb-3">
            {subKey === "espresso" ? "Espresso" : "Single Origin"}
          </h2>

          <table className="min-w-full text-sm text-gray-900 border border-gray-200">
            <thead className="bg-black text-white uppercase text-xs font-bold">
              <tr>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-center">Stock (kg)</th>
                <th className="px-4 py-3 text-center">Price</th>
                <th className="px-4 py-3 text-center">Usage / cup</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(drinks[subKey]) ? drinks[subKey] : []).map((item) => (
                <tr key={item.id} className="border-t border-gray-200 hover:bg-red-50">
                  <td className="px-4 py-3 font-semibold">
                    {editMode ? (
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => handleChange(subKey, item.id, "name", e.target.value)}
                        className="w-40 border border-[#dc2626] rounded p-1"
                      />
                    ) : (
                      item.name
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editMode ? (
                      <input
                        type="number"
                        step="0.01"
                        value={item.stock}
                        onChange={(e) => handleChange(subKey, item.id, "stock", e.target.value)}
                        className="w-24 border border-[#dc2626] rounded text-center"
                      />
                    ) : (
                      fmtKg(item.stock)
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editMode ? (
                      <input
                        type="number"
                        step="1"
                        value={item.price}
                        onChange={(e) => handleChange(subKey, item.id, "price", e.target.value)}
                        className="w-20 border border-[#dc2626] rounded text-center"
                      />
                    ) : (
                      `MOP$ ${item.price}`
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editMode ? (
                      <input
                        type="number"
                        step="0.001"
                        value={item.usagePerCup ?? 0.02}
                        onChange={(e) => handleChange(subKey, item.id, "usagePerCup", e.target.value)}
                        className="w-24 border border-[#dc2626] rounded text-center"
                      />
                    ) : (
                      `${((item.usagePerCup ?? 0.02) * 1000).toFixed(0)} g`
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editMode && (
                      <PosButton variant="black" onClick={() => handleDelete(subKey, item.id)}>
                        🗑 Delete
                      </PosButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 新增商品列 */}
          {editMode && (
            <div className="mt-4 border-t border-gray-200 pt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Name"
                value={newProduct.name}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
                className="border border-[#dc2626] rounded p-1 w-40"
              />
              <input
                type="number"
                placeholder="Stock"
                value={newProduct.stock}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, stock: parseFloat(e.target.value) || 0 }))}
                className="border border-[#dc2626] rounded p-1 w-24"
              />
              <input
                type="number"
                placeholder="Price"
                value={newProduct.price}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                className="border border-[#dc2626] rounded p-1 w-20"
              />
              <input
                type="number"
                step="0.001"
                placeholder="Usage (kg)"
                value={newProduct.usagePerCup}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, usagePerCup: parseFloat(e.target.value) || 0 }))}
                className="border border-[#dc2626] rounded p-1 w-28"
              />
              <PosButton variant="red" onClick={() => handleAdd(subKey)}>➕ Add</PosButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
