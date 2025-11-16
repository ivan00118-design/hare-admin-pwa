// src/pages/OrdersPage.jsx
import React from "react";
import { useInventory } from "../context/InventoryContext.jsx";

function fmtMoney(n) {
  if (!Number.isFinite(Number(n))) return "0";
  const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export default function OrdersPage() {
  const { orders = [] } = useInventory(); // ← 改讀 InventoryContext 的 orders（與 History/Dashboard 一致）

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Orders</h1>

      {orders.length === 0 ? (
        <p className="text-gray-500">No orders yet.</p>
      ) : (
        <div className="rounded border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Items</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <ul className="list-disc pl-5 space-y-1">
                      {(o.items || []).map((it, i) => (
                        <li key={i}>
                          {it.name}
                          {it.category === "drinks" && it.subKey
                            ? ` (${it.subKey === "espresso" ? "Espresso" : "Single Origin"})`
                            : it.grams
                            ? ` (${it.grams}g)`
                            : ""} × {it.qty} @ {fmtMoney(it.price)}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-red-600">
                    $ {fmtMoney(o.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
