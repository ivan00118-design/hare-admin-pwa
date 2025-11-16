import React, { useState } from "react";

export default function SalesReport() {
  // 當前選擇的分頁 (drinks / beans)
  const [activeTab, setActiveTab] = useState("drinks");

  // 假資料：可日後改成從後端或 Context 拿
  const salesData = {
    drinks: [
      { id: 1, product: "Iced Latte", qty: 35, price: 35 },
      { id: 2, product: "Americano", qty: 42, price: 30 },
      { id: 3, product: "Cappuccino", qty: 25, price: 38 },
    ],
    beans: [
      { id: 4, product: "Colombian Beans 250g", qty: 15, price: 120 },
      { id: 5, product: "Ethiopian Beans 500g", qty: 8, price: 200 },
      { id: 6, product: "Kenya Beans 1kg", qty: 4, price: 350 },
    ],
  };

  // 計算銷售統計
  const currentData = salesData[activeTab];
  const totalQty = currentData.reduce((sum, i) => sum + i.qty, 0);
  const totalRevenue = currentData.reduce(
    (sum, i) => sum + i.qty * i.price,
    0
  );

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-blue-600 mb-6 flex items-center gap-3">
        📊 Sales Report
      </h1>

      {/* 分頁按鈕 */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setActiveTab("drinks")}
          className={`px-4 py-2 rounded-lg font-semibold transition ${
            activeTab === "drinks"
              ? "bg-blue-600 text-white shadow"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
           Drinks
        </button>
        <button
          onClick={() => setActiveTab("beans")}
          className={`px-4 py-2 rounded-lg font-semibold transition ${
            activeTab === "beans"
              ? "bg-blue-600 text-white shadow"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
           Coffee Beans
        </button>
      </div>

      {/* 統計卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white shadow rounded-xl p-4 text-center">
          <h3 className="text-gray-500 text-sm mb-1">Total Sold</h3>
          <p className="text-2xl font-bold text-blue-600">{totalQty}</p>
        </div>
        <div className="bg-white shadow rounded-xl p-4 text-center">
          <h3 className="text-gray-500 text-sm mb-1">Total Revenue</h3>
          <p className="text-2xl font-bold text-green-600">
            MOP$ {totalRevenue.toLocaleString()}
          </p>
        </div>
        <div className="bg-white shadow rounded-xl p-4 text-center">
          <h3 className="text-gray-500 text-sm mb-1">Average Unit Price</h3>
          <p className="text-2xl font-bold text-gray-700">
            MOP$ {(totalRevenue / totalQty).toFixed(2)}
          </p>
        </div>
      </div>

      {/* 銷售表格 */}
      <div className="bg-white shadow-md rounded-xl overflow-hidden">
        <table className="min-w-full text-sm text-gray-700">
          <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
            <tr>
              <th className="px-6 py-3 text-left">Product</th>
              <th className="px-6 py-3 text-center">Qty Sold</th>
              <th className="px-6 py-3 text-center">Unit Price (MOP$)</th>
              <th className="px-6 py-3 text-center">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {currentData.map((item) => (
              <tr key={item.id} className="border-t hover:bg-gray-50">
                <td className="px-6 py-3 font-medium">{item.product}</td>
                <td className="px-6 py-3 text-center">{item.qty}</td>
                <td className="px-6 py-3 text-center">{item.price}</td>
                <td className="px-6 py-3 text-center font-semibold text-green-600">
                  MOP$ {(item.qty * item.price).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
