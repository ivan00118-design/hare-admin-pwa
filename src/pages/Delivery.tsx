import React, { useMemo, useState } from "react";
import { useAppState, type UIItem, type Category } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";
import { placeDelivery, type PlaceOrderItem, type DeliveryInfo } from "../services/orders";

import iconSimplePay from "../assets/payments/SimplePay.jpg";
import iconCash from "../assets/payments/Cash.png";
import iconMacauPass from "../assets/payments/MacauPass.png";

/** ====== 可自行客製 ====== */
const RECIPIENT_PRESETS = [
  "自提（Walk-in）",
  "OK便利店",
  "7-Eleven",
  "百老匯",
  "公司/辦公室",
  "其他常用"
]; // ← 依你的常見收件者調整即可

const FEE_PRESETS = [0, 10, 15, 20, 25, 30, 40, 50]; // ← 常用運費（MOP）

/** ====== 型別 ====== */
type TabKey = "HandDrip" | "delivery";

type BeanCartItem = UIItem & {
  category: "HandDrip";
  subKey?: null;
  grams: number;
  qty: number;
};

type CartItem = BeanCartItem;

/** ====== 工具 ====== */
const fmt = (n: number) => {
  const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function Delivery() {
  const { inventory } = useAppState();

  /** 只留下 Coffee Beans 與 Delivery 兩個分頁 */
  const [activeTab, setActiveTab] = useState<TabKey>("HandDrip");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [saving, setSaving] = useState(false);

  // 收件資料（已移除 phone / address）
  const [delivery, setDelivery] = useState<DeliveryInfo>({
    customer_name: "",
    note: "",
    scheduled_at: null,
  });
  const [deliveryFee, setDeliveryFee] = useState<number>(0);

  const PAYMENT_OPTIONS = [
    { key: "SimplePay", label: "SimplePay", icon: iconSimplePay },
    { key: "Cash", label: "Cash", icon: iconCash },
    { key: "MacauPass", label: "MacauPass", icon: iconMacauPass },
  ] as const;

  /** 只取 beans（HandDrip） */
  const products: any[] = inventory?.store?.HandDrip || [];

  /** Beans：依「同名」彙整各包裝（100/250/500/1000g）並依克數排序 */
  const beanGroups = useMemo(() => {
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
  }, [products]);

  /** Beans 加入購物車 */
  const addToCart = (item: any, qty: number, grams: number | null = null) => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    const g = Number(grams ?? item.grams ?? 0);

    setCart((prev: CartItem[]) => {
      const key = `HandDrip||${item.id}|${g}`;
      const existed = prev.find(
        (p) => `HandDrip||${p.id}|${(p as any).grams || 0}` === key
      );
      if (existed) {
        return prev.map((p: CartItem) =>
          `HandDrip||${p.id}|${(p as any).grams || 0}` === key
            ? { ...p, qty: p.qty + parsed }
            : p
        );
      }
      const patch: CartItem = {
        ...(item as UIItem),
        category: "HandDrip",
        subKey: null,
        grams: g,
        qty: parsed,
      };
      return [...prev, patch];
    });
  };

  /** 修改購物車數量 */
  const changeCartQty = (key: string, delta: number) => {
    setCart((prev: CartItem[]) =>
      prev
        .map((p: CartItem) => {
          const k = `HandDrip||${p.id}|${(p as any).grams || 0}`;
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

  /** 下單 */
  const handleConfirmDelivery = async () => {
    if (!paymentMethod) return alert("請先選擇支付方式");
    if (cart.length === 0) return alert("請先加入商品");

    const payload: PlaceOrderItem[] = cart.map((it) => ({
      name: it.name,
      sku: `${it.id}-${(it as any).grams}g`,
      qty: it.qty,
      price: it.price || 30,
      category: "HandDrip",
      grams: Number((it as any).grams) || undefined,
      // sub_key 不用傳（只有 drinks 才有）
    }));

    setSaving(true);
    try {
      const id = await placeDelivery(
        payload,
        paymentMethod,
        { customer_name: delivery.customer_name ?? "", note: delivery.note ?? "", scheduled_at: delivery.scheduled_at ?? null },
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
      {/* Tabs：只留 Coffee Beans + Delivery */}
      <div className="flex gap-3 mb-6">
        <PosButton
          variant="tab"
          selected={activeTab === "HandDrip"}
          onClick={() => setActiveTab("HandDrip")}
        >
          Coffee Beans
        </PosButton>
        <PosButton
          variant="tab"
          selected={activeTab === "delivery"}
          onClick={() => setActiveTab("delivery")}
        >
          Delivery
        </PosButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左側：商品清單 / Delivery 快速鍵 */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <h2 className="text-xl font-extrabold mb-3">
              {activeTab === "HandDrip" ? "Coffee Beans Menu" : "Delivery Shortcuts"}
            </h2>

            {activeTab === "HandDrip" ? (
              <div className="rounded-lg border border-gray-200 flex-1 overflow-x-auto">
                <table className="w-full text-sm text-gray-900">
                  <thead className="bg-black text-white uppercase text-xs font-bold">
                    <tr>
                      <th className="px-4 py-3 text-left">Product</th>
                      <th className="px-4 py-3 text-right">Pack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {beanGroups.map(([name, variants]) => (
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
                    {beanGroups.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-gray-400" colSpan={2}>
                          No products.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              // Delivery 分頁：點按按鈕快速填入收件者 / 運費
              <div className="rounded-lg border border-gray-200 p-4 flex-1">
                <div className="mb-5">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Recipient Presets</div>
                  <div className="flex flex-wrap gap-2">
                    {RECIPIENT_PRESETS.map((name) => (
                      <PosButton
                        key={name}
                        variant="red"
                        className="px-3 py-2"
                        onClick={() => setDelivery((d) => ({ ...d, customer_name: name }))}
                        title={`Set recipient = ${name}`}
                      >
                        {name}
                      </PosButton>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-gray-700 mb-2">Fee Presets (MOP)</div>
                  <div className="flex flex-wrap gap-2">
                    {FEE_PRESETS.map((v) => (
                      <PosButton
                        key={v}
                        variant="black"
                        className="px-3 py-2"
                        onClick={() => setDeliveryFee(v)}
                        title={`Set delivery fee = ${v}`}
                      >
                        {v}
                      </PosButton>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右側：外送資料 + 結帳 */}
        <div className="lg:col-span-7 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col gap-4">
            {/* 收件資訊（phone/address 已移除） */}
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="text-lg font-extrabold mb-3">Recipient</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="h-10 border rounded px-3 md:col-span-2"
                  placeholder="Name"
                  value={delivery.customer_name ?? ""}
                  onChange={(e) => setDelivery((d) => ({ ...d, customer_name: e.target.value }))}
                />
                <input
                  className="h-10 border rounded px-3 md:col-span-2"
                  placeholder="Note (optional)"
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
                      const key = `HandDrip||${item.id}|${(item as any).grams || 0}`;
                      return (
                        <tr key={key} className="border-t hover:bg-red-50">
                          <td className="px-4 py-3 font-semibold">
                            {item.name} {(item as any).grams ? ` ${(item as any).grams}g` : ""}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="inline-flex items-center gap-2 justify-center">
                              <PosButton
                                variant="black"
                                className="px-2 py-1 text-xs"
                                onClick={() => changeCartQty(key, -1)}
                              >
                                −
                              </PosButton>
                              <span className="inline-block min-w-[2rem] text-center">{item.qty}</span>
                              <PosButton
                                variant="black"
                                className="px-2 py-1 text-xs"
                                onClick={() => changeCartQty(key, +1)}
                              >
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
