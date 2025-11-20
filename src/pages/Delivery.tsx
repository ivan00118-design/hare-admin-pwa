// src/pages/Delivery.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useAppState, type Category, type DrinkSubKey, type UIItem } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";
import { placeDelivery, type PlaceOrderItem, type DeliveryInfo } from "../services/orders";

import iconSimplePay from "../assets/payments/SimplePay.jpg";
import iconCash from "../assets/payments/Cash.png";
import iconMacauPass from "../assets/payments/MacauPass.png";

/** 預設收件人＋儲存鍵 */
const DEFAULT_RECIPIENTS = ["門市客戶", "公司", "家", "VIP A", "VIP B"] as const;
const LS_RECIPIENTS_KEY = "pos_delivery_recipient_presets_v1";

type DrinkCartItem = UIItem & {
  category: "drinks";
  subKey: DrinkSubKey;
  usagePerCup: number;
  grams?: null;
  qty: number;
};
type BeanCartItem = UIItem & {
  category: "HandDrip";
  subKey?: null;
  grams: number;
  qty: number;
};
type CartItem = DrinkCartItem | BeanCartItem;

const fmt = (n: number) => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function Delivery() {
  const { inventory } = useAppState();

  const [activeTab, setActiveTab] = useState<Category>("drinks");
  const [drinkSubTab, setDrinkSubTab] = useState<DrinkSubKey>("espresso");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [saving, setSaving] = useState(false);

  // 收件資料：只保留名稱／備註／時間
  const [delivery, setDelivery] = useState<DeliveryInfo>({
    customer_name: "",
    note: "",
    scheduled_at: null,
  });
  const [deliveryFee, setDeliveryFee] = useState<number>(0);

  // 可編輯的收件人按鈕（localStorage 持久化）
  const [recipientPresets, setRecipientPresets] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_RECIPIENTS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr.filter((s: any) => typeof s === "string") : [...DEFAULT_RECIPIENTS];
    } catch {
      return [...DEFAULT_RECIPIENTS];
    }
  });
  const [editRecipients, setEditRecipients] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LS_RECIPIENTS_KEY, JSON.stringify(recipientPresets));
    } catch {}
  }, [recipientPresets]);

  const addPreset = () => {
    const v = window.prompt("新增收件人名稱");
    if (!v) return;
    const name = v.trim();
    if (!name) return;
    if (recipientPresets.includes(name)) {
      alert("名稱已存在");
      return;
    }
    setRecipientPresets((prev) => [...prev, name]);
  };
  const renamePreset = (oldName: string) => {
    const v = window.prompt("重新命名", oldName);
    if (!v) return;
    const name = v.trim();
    if (!name) return;
    setRecipientPresets((prev) => prev.map((n) => (n === oldName ? name : n)));
    setDelivery((d) => (d.customer_name === oldName ? { ...d, customer_name: name } : d));
  };
  const removePreset = (name: string) => {
    if (!window.confirm(`刪除「${name}」？`)) return;
    setRecipientPresets((prev) => prev.filter((n) => n !== name));
    setDelivery((d) => (d.customer_name === name ? { ...d, customer_name: "" } : d));
  };
  const resetPresets = () => {
    if (!window.confirm("重設為系統預設按鈕？")) return;
    setRecipientPresets([...DEFAULT_RECIPIENTS]);
    setDelivery((d) => ({ ...d, customer_name: "" }));
  };

  const PAYMENT_OPTIONS = [
    { key: "SimplePay", label: "SimplePay", icon: iconSimplePay },
    { key: "Cash", label: "Cash", icon: iconCash },
    { key: "MacauPass", label: "MacauPass", icon: iconMacauPass },
  ] as const;

  const drinks = (inventory?.store?.drinks || { espresso: [], singleOrigin: [] }) as any;
  const products: any[] =
    activeTab === "drinks" ? ((drinks as any)[drinkSubTab] || []) : (inventory?.store?.HandDrip || []);

  const beanGroups = useMemo(() => {
    if (activeTab === "drinks") return [] as Array<[string, any[]]>;
    const map = new Map<string, any[]>();
    for (const it of products) {
      const key = (it.name || "").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).map(([name, variants]) => [
      name,
      (variants as any[])
        .filter((v) => Number.isFinite(Number((v as any).grams)))
        .sort((a: any, b: any) => (a.grams || 0) - (b.grams || 0)),
    ]) as Array<[string, any[]]>;
  }, [activeTab, products]);

  // 加入購物車（drinks 必帶 usagePerCup）
  const addToCart = (item: any, qty: number, grams: number | null = null) => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    const isDrink = activeTab === "drinks";
    const g = isDrink ? 0 : Number(grams ?? item.grams ?? 0);
    const usage = isDrink ? Number(item.usagePerCup ?? 0.02) : 0;

    setCart((prev: CartItem[]) => {
      const key = `${isDrink ? "drinks" : "HandDrip"}|${isDrink ? drinkSubTab : ""}|${item.id}|${g}`;
      const existed = prev.find(
        (p) => `${p.category}|${(p as any).subKey || ""}|${p.id}|${(p as any).grams || 0}` === key
      );
      if (existed) {
        return prev.map((p: CartItem) =>
          `${p.category}|${(p as any).subKey || ""}|${p.id}|${(p as any).grams || 0}` === key
            ? { ...p, qty: p.qty + parsed }
            : p
        );
      }

      const patch: CartItem = isDrink
        ? {
            ...(item as UIItem),
            category: "drinks",
            subKey: drinkSubTab,
            grams: null,
            qty: parsed,
            usagePerCup: usage,
          }
        : {
            ...(item as UIItem),
            category: "HandDrip",
            subKey: null,
            grams: g,
            qty: parsed,
          };

      return [...prev, patch];
    });
  };

  const changeCartQty = (key: string, delta: number) => {
    setCart((prev: CartItem[]) =>
      prev
        .map((p: CartItem) => {
          const k = `${p.category}|${(p as any).subKey || ""}|${p.id}|${(p as any).grams || 0}`;
          if (k !== key) return p;
          const newQty = p.qty + delta;
          if (newQty <= 0) return null as unknown as CartItem;
          return { ...p, qty: newQty };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const itemsTotal = cart.reduce((s, i) => s + i.qty * (i.price || 30), 0);
  const grandTotal = itemsTotal + (Number(deliveryFee) || 0);

  const handleConfirmDelivery = async () => {
    if (!paymentMethod) return alert("請先選擇支付方式");
    if (cart.length === 0) return alert("請先加入商品");
    if (!delivery.customer_name || !delivery.customer_name.trim()) {
      return alert("請先選擇/輸入收件人名稱");
    }

    const payload: PlaceOrderItem[] = cart.map((it) => {
      const isDrink = it.category === "drinks";
      return {
        name: it.name,
        sku: isDrink ? `${it.id}-${(it as any).subKey}` : `${it.id}-${(it as any).grams}g`,
        qty: it.qty,
        price: it.price || 30,
        category: isDrink ? "drinks" : "HandDrip",
        sub_key: isDrink ? (it as any).subKey : undefined,
        grams: isDrink ? undefined : Number((it as any).grams) || undefined,
      };
    });

    setSaving(true);
    try {
      const id = await placeDelivery(
        payload,
        paymentMethod,
        {
          customer_name: delivery.customer_name || "",
          note: delivery.note || "",
          scheduled_at: delivery.scheduled_at || null,
        },
        Number(deliveryFee) || 0,
        "ACTIVE"
      );
      alert(`✅ Delivery Created（#${id}）`);
      setCart([]);
      setPaymentMethod("");
      setDelivery({ customer_name: "", note: "", scheduled_at: null });
      setDeliveryFee(0);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Create delivery failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      {/* Tabs */}
      <div className="flex gap-3 mb-6">
        <PosButton variant="tab" selected={activeTab === "HandDrip"} onClick={() => setActiveTab("HandDrip")}>
          Coffee Beans
        </PosButton>
        <PosButton
          variant="tab"
          selected={activeTab === "drinks" && drinkSubTab === "espresso"}
          onClick={() => {
            setActiveTab("drinks");
            setDrinkSubTab("espresso");
          }}
        >
          Espresso
        </PosButton>
        <PosButton
          variant="tab"
          selected={activeTab === "drinks" && drinkSubTab === "singleOrigin"}
          onClick={() => {
            setActiveTab("drinks");
            setDrinkSubTab("singleOrigin");
          }}
        >
          Single Origin
        </PosButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 商品清單 */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <h2 className="text-xl font-extrabold mb-3">
              {activeTab === "drinks"
                ? drinkSubTab === "espresso"
                  ? "Espresso Menu"
                  : "Single Origin Menu"
                : "Coffee Beans Menu"}
            </h2>

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
                    ? (products as any[]).map((item: any) => (
                        <tr
                          key={item.id}
                          className="border-t hover:bg-red-50 cursor-pointer"
                          onClick={() => addToCart(item, 1)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold break-words">{item.name}</div>
                            <div className="text-xs text-gray-500 mt-1">{fmt(item.price)}</div>
                          </td>
                        </tr>
                      ))
                    : beanGroups.map(([name, variants]) => (
                        <tr key={name} className="border-t">
                          <td className="px-4 py-3 align-top">
                            <div className="font-semibold break-words">{name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2 justify-end">
                              {variants.map((v: any) => (
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

        {/* 右側：外送資料 + 結帳 */}
        <div className="lg:col-span-7 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col gap-4">
            {/* 收件資訊（可編輯預設按鈕；無 phone/address） */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-extrabold">Recipient</h3>
                <div className="flex items-center gap-2">
                  <PosButton variant="tab" selected={editRecipients} onClick={() => setEditRecipients((v) => !v)}>
                    {editRecipients ? "Done" : "Edit"}
                  </PosButton>
                  {editRecipients && (
                    <>
                      <PosButton variant="black" onClick={addPreset}>＋ Add</PosButton>
                      <PosButton variant="tab" onClick={resetPresets}>↺ Reset</PosButton>
                    </>
                  )}
                </div>
              </div>

              {/* 預設按鈕列 */}
              <div className="flex flex-wrap gap-2 mb-3">
                {recipientPresets.map((name) => {
                  const selected = delivery.customer_name === name;
                  return (
                    <div key={name} className="flex items-center gap-1">
                      <PosButton
                        variant="tab"
                        selected={selected}
                        onClick={() => setDelivery((d) => ({ ...d, customer_name: name }))}
                        aria-pressed={selected}
                      >
                        {name}
                      </PosButton>
                      {editRecipients && (
                        <>
                          <button
                            type="button"
                            className="h-7 px-2 border rounded text-xs text-gray-600 hover:bg-gray-50"
                            title="Rename"
                            onClick={() => renamePreset(name)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="h-7 px-2 border rounded text-xs text-gray-600 hover:bg-gray-50"
                            title="Delete"
                            onClick={() => removePreset(name)}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mb-3 text-sm text-gray-600">
                目前收件人：<b>{delivery.customer_name || "（未選擇）"}</b>
              </div>

              {/* 備註 / 預約時間 / 外送費 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="h-10 border rounded px-3 md:col-span-2"
                  placeholder="備註（可留空）"
                  value={delivery.note ?? ""}
                  onChange={(e) => setDelivery((d) => ({ ...d, note: e.target.value }))}
                />
                <input
                  className="h-10 border rounded px-3"
                  type="datetime-local"
                  value={delivery.scheduled_at ?? ""}
                  onChange={(e) => setDelivery((d) => ({ ...d, scheduled_at: e.target.value || null }))}
                />
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Delivery Fee</label>
                  <input
                    className="h-10 border rounded px-3 w-32"
                    type="number"
                    step="1"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(parseInt(e.target.value || "0", 10))}
                  />
                </div>
              </div>
            </div>

            {/* 訂單摘要 */}
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
                  {cart.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-gray-400" colSpan={3}>
                        No items added.
                      </td>
                    </tr>
                  ) : (
                    cart.map((item) => {
                      const key = `${item.category}|${(item as any).subKey || ""}|${item.id}|${(item as any).grams || 0}`;
                      return (
                        <tr key={key} className="border-t hover:bg-red-50">
                          <td className="px-4 py-3 font-semibold">
                            {item.name}
                            {item.category === "drinks" && (item as any).subKey
                              ? ` (${(item as any).subKey === "espresso" ? "Espresso" : "Single Origin"})`
                              : (item as any).grams
                              ? ` ${(item as any).grams}g`
                              : ""}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="inline-flex items-center gap-2 justify-center">
                              <PosButton variant="black" className="px-2 py-1 text-xs" onClick={() => changeCartQty(key, -1)}>
                                −
                              </PosButton>
                              <span className="inline-block min-w-[2rem] text-center">{item.qty}</span>
                              <PosButton variant="black" className="px-2 py-1 text-xs" onClick={() => changeCartQty(key, +1)}>
                                ＋
                              </PosButton>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-[#dc2626] font-extrabold whitespace-nowrap">
                            $ {fmt(item.qty * (item.price || 30))}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 付款 + 總計 */}
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-2 text-sm font-semibold text-gray-700">Payment</div>
                <div className="flex flex-wrap gap-3">
                  {PAYMENT_OPTIONS.map((opt) => {
                    const selected = paymentMethod === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPaymentMethod(opt.key)}
                        aria-pressed={selected}
                        className={[
                          "h-12 w-24 rounded-lg bg-white border flex items-center justify-center",
                          "shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                          selected ? "border-red-500 ring-2 ring-red-500" : "border-neutral-300 hover:border-neutral-400",
                        ].join(" ")}
                      >
                        <img src={opt.icon} alt={opt.label} className="h-6 object-contain pointer-events-none" />
                        <span className="sr-only">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-gray-900 font-semibold">
                  Items: <b>$ {fmt(itemsTotal)}</b>
                  <span className="mx-2">+</span> Delivery Fee: <b>$ {fmt(deliveryFee)}</b>
                  <span className="mx-2">=</span> Total:{" "}
                  <span className="text-[#dc2626] font-extrabold text-lg">$ {fmt(grandTotal)}</span>
                </div>
                <PosButton
                  variant="confirm"
                  className="!bg-white !text-black !border !border-gray-300 shadow-md hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
                  onClick={handleConfirmDelivery}
                  disabled={cart.length === 0 || !paymentMethod || saving}
                >
                  🚚 Confirm Delivery
                </PosButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
