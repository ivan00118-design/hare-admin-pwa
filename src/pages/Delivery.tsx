// src/pages/Delivery.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useAppState, type UIItem } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";
import {
  placeDelivery,
  listShipping,
  setOrderShipStatus,
  type PlaceOrderItem,
  type DeliveryInfo,
  type ShippingRow,
  type ShipStatus,
} from "../services/orders";

import iconSimplePay from "../assets/payments/SimplePay.jpg";
import iconCash from "../assets/payments/Cash.png";
import iconMacauPass from "../assets/payments/MacauPass.png";

import {
  loadDeliveryShortcuts,
  saveDeliveryShortcuts,
  newId,
  type DeliveryShortcut, // 你現有的型別可能是 { id, label, fee, ... }
} from "../services/deliveryShortcuts";

/** ====== 型別 ====== */
type TabKey = "HandDrip" | "delivery";

type BeanCartItem = UIItem & {
  category: "HandDrip";
  subKey?: null;
  grams: number;
  qty: number;
};
type CartItem = BeanCartItem;

/** 與現有 DeliveryShortcut 作相容的本地寬鬆型別（同時支援 name 與 label） */
type DeliveryShortcutCompat = DeliveryShortcut & {
  name?: string;
  label?: string; // 舊欄位
  note?: string | null;
  fee?: number;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | null;
};

/** ====== 小工具 ====== */
const fmt = (n: number) => {
  const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};
const fmtTime = (iso?: string | null) => {
  try {
    if (!iso) return "";
    return new Date(iso).toLocaleString();
  } catch {
    return iso || "";
  }
};

/** 讓 Shortcut 同時相容 name/label、note、fee、defaultPayment 的讀取 */
const scGetName = (s: DeliveryShortcutCompat) =>
  (typeof s.name === "string" ? s.name : (s as any).label) ?? "";
const scGetNote = (s: DeliveryShortcutCompat) =>
  (typeof s.note === "string" ? s.note : (s as any).desc) ?? "";
const scGetFee = (s: DeliveryShortcutCompat) => {
  const v = (s as any).fee ?? (s as any).price ?? (s as any).feeMOP ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const scGetDefaultPayment = (s: DeliveryShortcutCompat) =>
  (s.defaultPayment ?? (s as any).payment ?? null) as "SimplePay" | "Cash" | "MacauPass" | null;

export default function Delivery() {
  const { inventory } = useAppState();

  /** 只留下 Coffee Beans 與 Delivery 兩個分頁 */
  const [activeTab, setActiveTab] = useState<TabKey>("HandDrip");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [saving, setSaving] = useState(false);

  // 收件資料（移除 phone / address；ship_status 在送單時一律填 PENDING）
  const [delivery, setDelivery] = useState<DeliveryInfo>({
    customer_name: "",
    note: "",
    scheduled_at: null,
  });
  const [deliveryFee, setDeliveryFee] = useState<number>(0);

  // Delivery Shortcuts（可編輯；相容 label/name）
  const [scLoading, setScLoading] = useState(true);
  const [scEdit, setScEdit] = useState(false);
  const [scSaving, setScSaving] = useState(false);
  const [shortcuts, setShortcuts] = useState<DeliveryShortcutCompat[]>([]);

  // 出貨清單（完全 DB 化）
  const [shipLoading, setShipLoading] = useState(true);
  const [shipments, setShipments] = useState<ShippingRow[]>([]);
  const [shipTab, setShipTab] = useState<"pending" | "closed">("pending");

  /** ====== 初始化：載入 Shortcuts ====== */
  useEffect(() => {
    (async () => {
      try {
        const list = await loadDeliveryShortcuts();
        // 直接當作相容型別使用
        setShortcuts(Array.isArray(list) ? (list as DeliveryShortcutCompat[]) : []);
      } catch (e) {
        console.error("[loadDeliveryShortcuts] failed:", e);
      } finally {
        setScLoading(false);
      }
    })();
  }, []);

  /** ====== Shipping List：依分頁（pending/closed）查 DB ====== */
  const reloadShipping = async (tab: "pending" | "closed" = shipTab) => {
    setShipLoading(true);
    try {
      const status: ShipStatus = tab === "pending" ? "PENDING" : "CLOSED";
      const rows = await listShipping(status, 200);
      setShipments(rows);
    } catch (e) {
      console.error("[listShipping] failed:", e);
      setShipments([]);
    } finally {
      setShipLoading(false);
    }
  };
  useEffect(() => { reloadShipping("pending"); /* 初始顯示 PENDING */ }, []);
  useEffect(() => { reloadShipping(shipTab); }, [shipTab]); // 切換分頁即重新查詢

  /** 使用 Shortcut：寫回收件人、note、fee、預設付款 */
  const onUseShortcut = (s: DeliveryShortcutCompat) => {
    setDelivery((d) => ({
      ...d,
      customer_name: scGetName(s) || d.customer_name || "",
      note: scGetNote(s) || d.note || "",
    }));
    setDeliveryFee(Number(scGetFee(s) || 0));
    const pay = scGetDefaultPayment(s);
    if (pay) setPaymentMethod(pay);
  };

  /** Shortcut 編輯：新增/刪除/修改/儲存/取消（相容 label/name） */
  const onAddShortcut = () => {
    setShortcuts((prev) => [
      ...prev,
      // 為了型別相容，新增時先用 label 存顯示名稱
      { id: newId(), label: "", fee: 0, note: "", defaultPayment: null } as any,
    ]);
  };
  const onRemoveShortcut = (id: string) => {
    if (!window.confirm("確定要刪除此快捷嗎？")) return;
    setShortcuts((prev) => prev.filter((x) => x.id !== id));
  };
  const onPatchShortcut = (id: string, patch: Record<string, any>) => {
    // 直接用寬鬆 patch，避免 TS 因為 'name' 不在 DeliveryShortcut 報錯
    setShortcuts((prev) => prev.map((x) => (x.id === id ? ({ ...x, ...patch } as any) : x)));
  };
  const onSaveShortcuts = async () => {
    setScSaving(true);
    try {
      // 清洗：統一輸出成 service 需要的欄位（以 label 優先；無 label 則寫 name）
      const cleaned = shortcuts
        .map((s) => {
          const label = scGetName(s).trim();
          if (!label) return null;
          return {
            id: String(s.id),
            label, // 以 label 為主（相容你的 service）
            fee: scGetFee(s),
            note: scGetNote(s) || "",
            defaultPayment: scGetDefaultPayment(s) ?? null,
          };
        })
        .filter(Boolean) as DeliveryShortcut[];

      await saveDeliveryShortcuts(cleaned);
      setShortcuts(cleaned as any); // 儲存後以同結構回填
      setScEdit(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "儲存失敗");
    } finally {
      setScSaving(false);
    }
  };
  const onCancelEdit = async () => {
    setScLoading(true);
    try {
      const list = await loadDeliveryShortcuts();
      setShortcuts(Array.isArray(list) ? (list as any) : []);
    } catch (e) {
      console.error(e);
    } finally {
      setScLoading(false);
      setScEdit(false);
    }
  };

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

  /** 下單（delivery_info.ship_status 一律 PENDING） */
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
    }));

    setSaving(true);
    try {
      const id = await placeDelivery(
        payload,
        paymentMethod,
        {
          customer_name: delivery.customer_name ?? "",
          note: delivery.note ?? "",
          scheduled_at: delivery.scheduled_at ?? null,
          ship_status: "PENDING", // 🔴 重要：讓 Shipping List 能即時顯示
        },
        Number(deliveryFee) || 0,
        "ACTIVE"
      );

      alert(`✅ Delivery Created（#${id}）`);

      // 重載 Shipping List（停留在目前分頁）
      await reloadShipping(shipTab);

      // 清空表單
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

  /** Shipping List 操作（關閉 / 重開） */
  const closeShipment = async (orderId: string) => {
    await setOrderShipStatus(orderId, "CLOSED");
    await reloadShipping(shipTab);
  };
  const reopenShipment = async (orderId: string) => {
    await setOrderShipStatus(orderId, "PENDING");
    await reloadShipping(shipTab);
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
        {/* 左側：商品清單 / Delivery Shortcuts（可編輯；已移除 Fee Presets 區塊） */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-extrabold">
                {activeTab === "HandDrip" ? "Coffee Beans Menu" : "Delivery Shortcuts"}
              </h2>

              {activeTab === "delivery" && (
                <div className="flex items-center gap-2">
                  {!scEdit ? (
                    <PosButton
                      variant="black"
                      className="px-3 py-1"
                      onClick={() => setScEdit(true)}
                      disabled={scLoading}
                      title="編輯 Delivery Shortcuts"
                    >
                      Edit
                    </PosButton>
                  ) : (
                    <>
                      <PosButton
                        variant="red"
                        className="px-3 py-1"
                        onClick={onSaveShortcuts}
                        disabled={scSaving}
                        title="儲存所有變更"
                      >
                        Save
                      </PosButton>
                      <PosButton
                        variant="black"
                        className="px-3 py-1"
                        onClick={onCancelEdit}
                        disabled={scSaving}
                        title="取消編輯"
                      >
                        Cancel
                      </PosButton>
                    </>
                  )}
                </div>
              )}
            </div>

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
              // Delivery 分頁：快捷鍵（可編輯；Fee Presets 已移除）
              <div className="rounded-lg border border-gray-200 p-4 flex-1">
                {scLoading ? (
                  <div className="text-gray-500 text-sm">Loading…</div>
                ) : !scEdit ? (
                  <>
                    {shortcuts.length === 0 ? (
                      <div className="text-gray-500 text-sm">
                        尚未建立任何快捷；點擊右上角 <b>Edit</b> 新增。
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {shortcuts.map((s) => {
                          const n = scGetName(s);
                          const fee = scGetFee(s);
                          const pay = scGetDefaultPayment(s);
                          return (
                            <PosButton
                              key={s.id}
                              variant="red"
                              className="px-3 py-2"
                              onClick={() => onUseShortcut(s)}
                              title={`Set recipient=${n} · fee=${fee}${pay ? " · pay=" + pay : ""}`}
                            >
                              {n || "(No name)"}
                              <span className="ml-2 text-xs opacity-70">MOP$ {fmt(fee)}</span>
                              {pay ? (
                                <span className="ml-1 text-[10px] opacity-60">[{pay}]</span>
                              ) : null}
                            </PosButton>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase text-gray-600">
                        <tr>
                          <th className="text-left py-1">Name</th>
                          <th className="text-left py-1">Note</th>
                          <th className="text-left py-1">Fee</th>
                          <th className="text-left py-1">Default Payment</th>
                          <th className="text-left py-1">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shortcuts.map((s) => (
                          <tr key={s.id} className="border-t">
                            <td className="py-1 pr-2">
                              <input
                                className="h-9 w-full border rounded px-2"
                                placeholder="Recipient name"
                                value={scGetName(s)}
                                onChange={(e) =>
                                  onPatchShortcut(s.id, { name: e.target.value, label: e.target.value })
                                }
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <input
                                className="h-9 w-full border rounded px-2"
                                placeholder="Note (optional)"
                                value={scGetNote(s)}
                                onChange={(e) => onPatchShortcut(s.id, { note: e.target.value })}
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <input
                                className="h-9 w-24 border rounded px-2"
                                type="number"
                                step="1"
                                min="0"
                                value={scGetFee(s)}
                                onChange={(e) =>
                                  onPatchShortcut(s.id, { fee: parseInt(e.target.value || "0", 10) })
                                }
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <select
                                className="h-9 border rounded px-2"
                                value={scGetDefaultPayment(s) ?? ""}
                                onChange={(e) =>
                                  onPatchShortcut(s.id, {
                                    defaultPayment: (e.target.value || "") as any || null,
                                  })
                                }
                              >
                                <option value="">—</option>
                                <option value="SimplePay">SimplePay</option>
                                <option value="Cash">Cash</option>
                                <option value="MacauPass">MacauPass</option>
                              </select>
                            </td>
                            <td className="py-1">
                              <PosButton
                                variant="black"
                                className="px-3 py-1"
                                onClick={() => onRemoveShortcut(s.id)}
                              >
                                Delete
                              </PosButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-3">
                      <PosButton variant="black" onClick={onAddShortcut}>
                        ＋ Add Shortcut
                      </PosButton>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右側：外送資料 + 結帳 */}
        <div className="lg:col-span-7 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col gap-4">
            {/* 收件資訊（phone / address 已移除） */}
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
                  onChange={(e) =>
                    setDelivery((d) => ({ ...d, scheduled_at: e.target.value || null }))
                  }
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
                              <span className="inline-block min-w-[2rem] text-center">
                                {item.qty}
                              </span>
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
                          selected
                            ? "border-red-500 ring-2 ring-red-500"
                            : "border-neutral-300 hover:border-neutral-400",
                        ].join(" ")}
                      >
                        <img
                          src={opt.icon}
                          alt={opt.label}
                          className="h-6 object-contain pointer-events-none"
                        />
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
                  <span className="text-[#dc2626] font-extrabold text-lg">
                    $ {fmt(grandTotal)}
                  </span>
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

      {/* 出貨清單（完全 DB 化） */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-extrabold">Shipping List</h2>
          <div className="flex gap-2">
            <PosButton
              variant="tab"
              selected={shipTab === "pending"}
              onClick={() => setShipTab("pending")}
            >
              Pending
            </PosButton>
            <PosButton
              variant="tab"
              selected={shipTab === "closed"}
              onClick={() => setShipTab("closed")}
            >
              Closed
            </PosButton>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm text-gray-900">
            <thead className="bg-black text-white uppercase text-xs font-bold">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Order</th>
                <th className="px-4 py-3 text-left">Recipient</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {shipLoading ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-400" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : shipments.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-400" colSpan={6}>
                    No records.
                  </td>
                </tr>
              ) : (
                shipments.map((s) => {
                  const shortId = (s.id || "").slice(-6);
                  const isPending = (s.ship_status ?? "PENDING") === "PENDING";
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="px-4 py-3">{fmtTime(s.created_at)}</td>
                      <td className="px-4 py-3 font-mono">{shortId}</td>
                      <td className="px-4 py-3">
                        {s.customer_name || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-extrabold text-[#dc2626]">
                        MOP$ {fmt(s.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isPending ? (
                          <span className="inline-block text-[11px] px-2 py-[2px] rounded bg-amber-100 text-amber-700">
                            PENDING
                          </span>
                        ) : (
                          <span className="inline-block text-[11px] px-2 py-[2px] rounded bg-emerald-100 text-emerald-700">
                            CLOSED
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isPending ? (
                          <div className="inline-flex gap-2">
                            <PosButton
                              variant="red"
                              className="px-3 py-1"
                              onClick={() => closeShipment(s.id)}
                            >
                              Close
                            </PosButton>
                          </div>
                        ) : (
                          <div className="inline-flex gap-2">
                            <PosButton
                              variant="black"
                              className="px-3 py-1"
                              onClick={() => reopenShipment(s.id)}
                            >
                              Reopen
                            </PosButton>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
