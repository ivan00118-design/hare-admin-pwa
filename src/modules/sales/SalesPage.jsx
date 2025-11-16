import React from "react";
import { useInventory } from "../../context/InventoryContext.jsx";

export default function SalesPage() {
  const { inventory, sellItem } = useInventory();

  const handleSell = (catKey, id, qty) => {
    sellItem(catKey, id, qty); // ✅ 賣出後即時更新庫存
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold text-green-600 mb-4">
        🛒 Sales Simulation
      </h1>

      {Object.keys(inventory.store).map((catKey) => (
        <div key={catKey} className="mb-6">
          <h2 className="text-lg font-semibold mb-2">
            {catKey === "drinks" && " Drinks"}
            {catKey === "HandDrip" && " Hand Drip"}
          </h2>
          {inventory.store[catKey].map((item) => (
            <div
              key={item.id}
              className="flex justify-between items-center bg-white border p-3 rounded mb-2"
            >
              <span>
                {item.name} — <b>{item.stock.toFixed(1)} kg</b>
              </span>
              <div className="space-x-2">
                <button
                  className="px-2 py-1 bg-blue-500 text-white rounded"
                  onClick={() => handleSell(catKey, item.id, 0.5)}
                >
                  Sell 0.5
                </button>
                <button
                  className="px-2 py-1 bg-red-500 text-white rounded"
                  onClick={() => handleSell(catKey, item.id, 1)}
                >
                  Sell 1.0
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
