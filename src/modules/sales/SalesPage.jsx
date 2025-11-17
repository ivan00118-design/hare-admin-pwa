// modules/sales/SalesPage.jsx
import React, { useMemo, useRef, useState } from "react";
import { useAppState } from "../../context/AppState";
import PosButton from "../../components/PosButton.jsx";

// 可判別聯合的購物車項目（以 JS 寫法實作概念：drinks 需要 usagePerCup；HandDrip 需要 grams）
export default function SalesPage() {
  const { inventory, setInventory, createOrder } = useAppState();

  const drinks = inventory?.store?.drinks || { espresso: [], singleOrigin: [] };
  const beans = Array.isArray(inventory?.store?.HandDrip) ? inventory.store.HandDrip : [];

  const [activeTab, setActiveTab] = useState("drinks"); // drinks | HandDrip
  const [drinkSubTab, setDrinkSubTab] = useState("espresso"); // espresso | singleOrigin
  const [cart, setCart] = useState([]); // {category, subKey?, grams?, usagePerCup?, qty, price, id, name, deductKg?}
  const [paymentMethod, setPaymentMethod] = useState("");

  const fmt = (n) => {
    const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };

  const products = activeTab === "drinks" ? (drinks[drinkSubTab] || []) : beans;

  // 將豆子依名稱分組，按規格(grams)排序
  const beanGroups = useMemo(() => {
    if (activeTab === "drinks") return [];
    const map = new Map();
    for (const it of products) {
      const k = (it.name || "").trim();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    return Array.from(map.entries()).map(([name, variants]) => [
      name,
      (variants || [])
        .filter((v) => Number.isFinite(Number(v.grams)))
        .sort((a, b) => (a.grams || 0) - (b.grams || 0)),
    ]);
  }, [activeTab, products]);

  const addGuardRef = useRef(new Set());

  const addToCart = (item, qty, grams = null) => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    const isDrink = activeTab === "drinks";
    const g = isDrink ? 0 : Number(grams ?? item.grams ?? 0);
    const usage = isDrink ? Number(item.usagePerCup ?? 0.02) : 0;
    const deductKg = isDrink ? parsed * usage : (g * parsed) / 1000;

    setCart((prev) => {
      const key = `${isDrink ? "drinks" : "HandDrip"}|${isDrink ? drinkSubTab : ""}|${item.id}|${g}`;
      const existed = prev.find((p) => `${p.category}|${p.subKey || ""}|${p.id}|${p.grams || 0}` === key);
      if (existed) {
        return prev.map((p) =>
          `${p.category}|${p.subKey || ""}|${p.id}|${p.grams || 0}` === key
            ? { ...p, qty: p.qty + parsed, deductKg: (p.deductKg || 0) + deductKg }
            : p
        );
      }

      const patch = isDrink
        ? {
            ...item,
            category: "drinks",
            subKey: drinkSubTab,
            usagePerCup: usage, // drinks 一定要有 usagePerCup
            grams: null,        // drinks 沒有 grams
            qty: parsed,
            deductKg
          }
        : {
            ...item,
            category: "HandDrip",
            subKey: null,       // beans 沒子分類
            grams: g,           // beans 一定要有 grams
            qty: parsed,
            deductKg
          };

      return [...prev, patch];
    });
  };

  const totalAmount = cart.reduce((s, i) => s + i.qty * (i.price || 30), 0);

  const changeCartQty = (key, delta) => {
    setCart((prev) =>
      prev
        .map((p) => {
          const k = `${p.category}|${p.subKey || ""}|${p.id}|${p.grams || 0}`;
          if (k !== key) return p;
          const newQty = p.qty + delta;
          if (newQty <= 0) return null;

          const per = p.category === "drinks" ? p.usagePerCup : (p.grams / 1000);
          return { ...p, qty: newQty, deductKg: per * newQty };
        })
        .filter(Boolean)
    );
  };

  const handleCheckout = async () => {
    if (!paymentMethod) return alert("請先選擇支付方式（SimplePay / Cash / MacauPass）");
    const id = await createOrder(cart, totalAmount, { paymentMethod });
    if (!id) return;
    alert(`✅ Order Completed（付款方式：${paymentMethod}）`);
    setCart([]);
    setPaymentMethod("");
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Tabs */}
      <div className="flex gap-3 mb-6">
        <PosButton variant="tab" selected={activeTab === "HandDrip"} onClick={() => setActiveTab("HandDrip")}>Coffee Beans</PosButton>
        <PosButton variant="tab" selected={activeTab === "drinks" && drinkSubTab === "espresso"} onClick={() => { setActiveTab("drinks"); setDrinkSubTab("espresso"); }}>Espresso</PosButton>
        <PosButton variant="tab" selected={activeTab === "drinks" && drinkSubTab === "singleOrigin"} onClick={() => { setActiveTab("drinks"); setDrinkSubTab("singleOrigin"); }}>Single Origin</PosButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側清單 */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <h2 className="text-xl font-extrabold text-black mb-3">
              {activeTab === "drinks"
                ? drinkSubTab === "espresso" ? "Espresso Menu" : "Single Origin Menu"
                : "Coffee Beans Menu"}
            </h2>

            {/* 點選加入購物車 */}
            <div className="rounded-lg border border-gray-200 flex-1 overflow-x-auto">
              <table className="w-full text-sm text-gray-900">
                <thead className="bg-black text-white uppercase text-xs font-bold">
                  <tr>
                    <th className="px-4 py-3 text-left">Product</th>
                    {activeTab !== "drinks" && <th className="px-4 py-3 text-right">Pack</th>}
                  </tr>
                </thead>
                <tbody>
                  {activeTab === "drinks"
                    ? (products || []).map((item) => (
                        <tr key={item.id} className="border-t border-gray-200 hover:bg-red-50 cursor-pointer" onClick={() => addToCart(item, 1)}>
                          <td className="px-4 py-3">
                            <div className="font-semibold break-words">{item.name}</div>
                            <div className="text-xs text-gray-500 mt-1">{fmt(item.price)}</div>
                          </td>
                        </tr>
                      ))
                    : beanGroups.map(([name, variants]) => (
                        <tr key={name} className="border-t border-gray-200">
                          <td className="px-4 py-3 align-top">
                            <div className="font-semibold break-words">{name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2 justify-end">
                              {variants.map((v) => (
                                <PosButton
                                  key={`${name}-${v.grams}`}
                                  variant="red"
                                  className="px-2 py-1 text-xs"
                                  onClick={() => addToCart(v, 1, v.grams)}
                                  title={`${v.grams}g • ${fmt(v.price)}`}
                                >
                                  {v.grams}g • {fmt(v.price)}
                                </PosButton>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 右側訂單摘要 */}
        <div className="lg:col-span-7 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <h2 className="text-xl font-extrabold text-black mb-3">Order Summary</h2>

            {cart.length === 0 ? (
              <p className="text-gray-400 text-center py-6 flex-1">No items added.</p>
            ) : (
              <div className="rounded-lg border border-gray-200">
                <table className="w-full table-fixed text-sm text-gray-900">
                  <colgroup>
                    <col style={{ width: "60%" }} />
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "20%" }} />
                  </colgroup>
                  <thead className="bg-black text-white uppercase text-xs font-bold">
                    <tr>
                      <th className="px-4 py-3 text-left">Product</th>
                      <th className="px-4 py-3 text-center">Qty</th>
                      <th className="px-4 py-3 text-center">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => {
                      const key = `${item.category}|${item.subKey || ""}|${item.id}|${item.grams || 0}`;
                      return (
                        <tr key={key} className="border-t border-gray-200 hover:bg-red-50">
                          <td className="px-4 py-3 font-semibold">
                            {item.name}
                            {item.category === "drinks" && item.subKey
                              ? ` (${item.subKey === "espresso" ? "Espresso" : "Single Origin"})`
                              : item.grams ? ` (${item.grams}g)` : ""}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="inline-flex items-center gap-2 justify-center">
                              <PosButton variant="black" className="px-2 py-1 text-xs" onClick={() => changeCartQty(key, -1)}>−</PosButton>
                              <span className="inline-block min-w-[2rem] text-center">{item.qty}</span>
                              <PosButton variant="red" className="px-2 py-1 text-xs" onClick={() => changeCartQty(key, +1)}>＋</PosButton>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-[#dc2626] font-extrabold whitespace-nowrap">
                            $ {fmt(item.qty * (item.price || 30))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 付款方式 + 結帳 */}
            <div className="mt-6 border-top pt-4">
              <div className="mb-3">
                <div className="mb-2 text-sm font-semibold text-gray-700">Payment</div>
                <div className="flex flex-wrap gap-3">
                  {["SimplePay", "Cash", "MacauPass"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPaymentMethod(k)}
                      aria-pressed={paymentMethod === k}
                      className={[
                        "h-10 px-3 rounded-lg bg-white border shadow-sm",
                        paymentMethod === k ? "border-red-500 ring-2 ring-red-500" : "border-neutral-300 hover:border-neutral-400"
                      ].join(" ")}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-gray-900 font-semibold">
                  Total: <span className="text-[#dc2626] font-extrabold text-lg">$ {fmt(totalAmount)}</span>
                </p>
                <PosButton
                  variant="confirm"
                  className="!bg-white !text-black !border !border-gray-300 shadow-md hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
                  onClick={handleCheckout}
                  disabled={cart.length === 0 || !paymentMethod}
                  title={paymentMethod ? `Pay by ${paymentMethod}` : "Please choose payment first"}
                >
                  ✅ Confirm Order
                </PosButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
