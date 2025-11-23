// src/pages/Delivery.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useAppState, type UIItem } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";
import {
  placeDelivery,
  listShipping,
  setOrderShipStatus,
  type ShippingRow,
  type ShipStatus,
} from "../services/orders";
import {
  loadDeliveryShortcuts,
  saveDeliveryShortcuts,
  newId,
  type DeliveryShortcut,
} from "../services/deliveryShortcuts";

import iconSimplePay from "../assets/payments/SimplePay.jpg";
import iconCash from "../assets/payments/Cash.png";
import iconMacauPass from "../assets/payments/MacauPass.png";

type TabKey = "HandDrip" | "delivery";

type BeanCartItem = UIItem & {
  category: "HandDrip";
  subKey?: null;
  grams: number;
  qty: number;
};
type CartItem = BeanCartItem;

export type DeliveryInfo = {
  customer_name?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  scheduled_at?: string | null;
  ship_status?: ShipStatus | null;
};

const fmt = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};
const fmtTime = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
};

export default function Delivery() {
  const { inventory } = useAppState();

  const [activeTab, setActiveTab] = useState<TabKey>("HandDrip");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [saving, setSaving] = useState(false);

  const [delivery, setDelivery] = useState<DeliveryInfo>({
    customer_name: "",
    note: "",
    scheduled_at: null,
    ship_status: "PENDING",
  });
  const [deliveryFee, setDeliveryFee] = useState<number>(0);

  const [scEdit, setScEdit] = useState(false);
  const [scSaving, setScSaving] = useState(false);
  const [scLoading, setScLoading] = useState(true);
  const [shortcuts, setShortcuts] = useState<DeliveryShortcut[]>([]);

  const [shipTab, setShipTab] = useState<ShipStatus>("PENDING");
  const [shipLoading, setShipLoading] = useState(true);
  const [shipRows, setShipRows] = useState<ShippingRow[]>([]);

  const PAYMENT_OPTIONS: Array<{ key: string; label: string; icon?: string | null }> = [
    { key: "SimplePay", label: "SimplePay", icon: iconSimplePay },
    { key: "Cash", label: "Cash", icon: iconCash },
    { key: "MacauPass", label: "MacauPass", icon: iconMacauPass },
    { key: "QR", label: "QR", icon: null },
  ];

  // 只取 Coffee Beans
  const products: any[] = inventory?.store?.HandDrip || [];
  const beanGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const it of products) {
      const key = (it.name || "").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries()).map(([name, arr]) => [
      name,
      (arr as any[])
        .filter((x) => Number.isFinite(Number((x as any).grams)))
        .sort((a: any, b: any) => (a.grams || 0) - (b.grams || 0)),
    ]) as Array<[string, any[]]>;
  }, [products]);

  // Shortcuts – load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setScLoading(true);
      try {
        const list = await loadDeliveryShortcuts();
        if (mounted) setShortcuts(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error("[loadDeliveryShortcuts] failed:", e);
      } finally {
        if (mounted) setScLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Shipping list – load
  const loadShip = React.useCallback(async (status: ShipStatus) => {
    setShipLoading(true);
    try {
      const rows = await listShipping(status, 400);
      setShipRows(rows || []);
    } catch (e) {
      console.error("[listShipping] failed:", e);
    } finally {
      setShipLoading(false);
    }
  }, []);
  useEffect(() => {
    loadShip(shipTab);
  }, [shipTab, loadShip]);

  // Shortcuts – actions
  const onUseShortcut = (s: DeliveryShortcut) => {
    setDelivery((d) => ({
      ...d,
      customer_name: (s as any).label ?? d.customer_name ?? "",
      note: (s as any).note ?? d.note ?? "",
    }));
    setDeliveryFee(Number((s as any).fee || 0));
    const defPay = (s as any).defaultPayment || (s as any).default_payment || "";
    if (defPay) setPaymentMethod(defPay);
  };
  const onAddShortcut = () => {
    setShortcuts((prev) => [
      ...prev,
      { id: newId(), label: "", fee: 0, note: "", defaultPayment: null, sort_order: null as any },
    ]);
  };
  const onRemoveShortcut = (id: string) => {
    if (!window.confirm("確定要刪除此快捷？")) return;
    setShortcuts((prev) => prev.filter((x) => x.id !== id));
  };
  const onPatchShortcut = (id: string, patch: Partial<DeliveryShortcut>) => {
    setShortcuts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const onSaveShortcuts = async () => {
    setScSaving(true);
    try {
      const cleaned = shortcuts
        .map((s) => ({ ...s, label: String((s as any).label || "").trim() }))
        .filter((s) => (s as any).label.length > 0);
      await saveDeliveryShortcuts(cleaned);
      setShortcuts(cleaned as DeliveryShortcut[]);
      setScEdit(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "儲存失敗");
    } finally {
      setScSaving(false);
    }
  };

  // Cart
  const addToCart = (item: any, qty: number, grams: number | null = null) => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) return;
    const g = Number(grams ?? item.grams ?? 0);

    setCart((prev) => {
      const key = `HandDrip||${item.id}|${g}`;
      const existed = prev.find((p) => `HandDrip||${p.id}|${(p as any).grams || 0}` === key);
      if (existed) {
        return prev.map((p) =>
          `HandDrip||${p.id}|${(p as any).grams || 0}` === key ? { ...p, qty: p.qty + q } : p
        );
      }
      const patch: CartItem = { ...(item as UIItem), category: "HandDrip", grams: g, qty: q, subKey: null };
      return [...prev, patch];
    });
  };
  const changeCartQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((p) => {
          const k = `HandDrip||${p.id}|${(p as any).grams || 0}`;
          if (k !== key) return p;
          const next = p.qty + delta;
          if (next <= 0) return null as unknown as CartItem;
          return { ...p, qty: next };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const itemsTotal = cart.reduce((s, i) => s + i.qty * (i.price || 30), 0);
  const grandTotal = itemsTotal + (Number(deliveryFee) || 0);

  // Confirm – place delivery & keep ship_status=PENDING
  const handleConfirmDelivery = async () => {
    if (!paymentMethod) return alert("請先選擇支付方式");
    if (cart.length === 0) return alert("請先加入商品");

    const payload = cart.map((it) => ({
      name: it.name,
      sku: `${it.id}-${(it as any).grams}g`,
      qty: it.qty,
      price: it.price || 30,
      category: "HandDrip" as const,
      grams: Number((it as any).grams) || undefined,
    }));

    setSaving(true);
    try {
      const orderId = await placeDelivery(
        payload,
        paymentMethod,
        {
          customer_name: delivery.customer_name ?? "",
          note: delivery.note ?? "",
          scheduled_at: delivery.scheduled_at ?? null,
          ship_status: "PENDING",
        },
        Number(deliveryFee) || 0,
        "ACTIVE"
      );

      try {
        await setOrderShipStatus(orderId, "PENDING");
      } catch {}

      alert(`✅ Delivery Created（#${orderId}）`);
      setCart([]);
      setPaymentMethod("");
      setDelivery({ customer_name: "", note: "", scheduled_at: null, ship_status: "PENDING" });
      setDeliveryFee(0);
      loadShip(shipTab);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Create delivery failed");
    } finally {
      setSaving(false);
    }
  };

  const filteredShipments = shipRows.sort((a, b) =>
    (a.created_at || "") < (b.created_at || "") ? 1 : -1
  );

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      {/* Tabs */}
      <div className="flex gap-3 mb-6">
        <PosButton variant="tab" selected={activeTab === "HandDrip"} onClick={() => setActiveTab("HandDrip")}>
          Coffee Beans
        </PosButton>
        <PosButton variant="tab" selected={activeTab === "delivery"} onClick={() => setActiveTab("delivery")}>
          Delivery
        </PosButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left */}
        <div className="lg:col-span-5 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-extrabold">
                {activeTab === "HandDrip" ? "Coffee Beans Menu" : "Delivery Shortcuts"}
              </h2>
              {activeTab === "delivery" && (
                <div className="flex items-center gap-2">
                  {!scEdit ? (
                    <PosButton variant="black" className="px-3 py-1" disabled={scLoading} onClick={() => setScEdit(true)}>
                      Edit
                    </PosButton>
                  ) : (
                    <>
                      <PosButton variant="red" className="px-3 py-1" disabled={scSaving} onClick={onSaveShortcuts}>
                        Save
                      </PosButton>
                      <PosButton variant="black" className="px-3 py-1" disabled={scSaving} onClick={() => setScEdit(false)}>
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
              <div className="rounded-lg border border-gray-200 p-4 flex-1">
                {scLoading ? (
                  <div className="text-sm text-gray-500">Loading…</div>
                ) : !scEdit ? (
                  shortcuts.length === 0 ? (
                    <div className="text-sm text-gray-500">尚未建立任何快捷；點右上角 Edit 新增。</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {shortcuts.map((s) => (
                        <PosButton
                          key={s.id}
                          variant="red"
                          className="px-3 py-2"
                          onClick={() => onUseShortcut(s)}
                          title={`Set recipient=${(s as any).label} · fee=${(s as any).fee}${
                            (s as any).defaultPayment ? " · pay=" + (s as any).defaultPayment : ""
                          }`}
                        >
                          {(s as any).label}
                          <span className="ml-2 text-xs opacity-70">MOP$ {fmt((s as any).fee || 0)}</span>
                          {(s as any).defaultPayment ? (
                            <span className="ml-1 text-[10px] opacity-60">[{(s as any).defaultPayment}]</span>
                          ) : null}
                        </PosButton>
                      ))}
                    </div>
                  )
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
                                value={(s as any).label ?? ""}
                                onChange={(e) => onPatchShortcut(s.id, { label: e.target.value } as any)}
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <input
                                className="h-9 w-full border rounded px-2"
                                placeholder="Note (optional)"
                                value={(s as any).note ?? ""}
                                onChange={(e) => onPatchShortcut(s.id, { note: e.target.value } as any)}
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <input
                                className="h-9 w-24 border rounded px-2"
                                type="number"
                                step="1"
                                min="0"
                                value={Number.isFinite(Number((s as any).fee)) ? (s as any).fee : 0}
                                onChange={(e) =>
                                  onPatchShortcut(s.id, { fee: parseInt(e.target.value || "0", 10) } as any)
                                }
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <select
                                className="h-9 border rounded px-2"
                                value={(s as any).defaultPayment ?? ""}
                                onChange={(e) =>
                                  onPatchShortcut(s.id, {
                                    defaultPayment: ((e.target.value || "") as any) || null,
                                  } as any)
                                }
                              >
                                <option value="">—</option>
                                <option value="SimplePay">SimplePay</option>
                                <option value="Cash">Cash</option>
                                <option value="MacauPass">MacauPass</option>
                                <option value="QR">QR</option>
                              </select>
                            </td>
                            <td className="py-1">
                              <PosButton variant="black" className="px-3 py-1" onClick={() => onRemoveShortcut(s.id)}>
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

        {/* Right */}
        <div className="lg:col-span-7 min-w-0">
          <div className="bg-white shadow-xl rounded-xl p-4 border border-gray-200 h-full min-h-[420px] flex flex-col gap-4">
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
                        {opt.icon ? (
                          <img src={opt.icon} alt={opt.label} className="h-6 object-contain pointer-events-none" />
                        ) : (
                          <span className="font-semibold">{opt.label}</span>
                        )}
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

      {/* Shipping List */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-extrabold">Shipping List</h2>
          <div className="flex gap-2">
            <PosButton variant="tab" selected={shipTab === "PENDING"} onClick={() => setShipTab("PENDING")}>
              Pending
            </PosButton>
            <PosButton variant="tab" selected={shipTab === "CLOSED"} onClick={() => setShipTab("CLOSED")}>
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
              ) : filteredShipments.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-400" colSpan={6}>
                    No records.
                  </td>
                </tr>
              ) : (
                filteredShipments.map((s) => {
                  const shortId = (s.id || "").slice(-6);
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="px-4 py-3">{fmtTime(s.created_at)}</td>
                      <td className="px-4 py-3 font-mono">{shortId}</td>
                      <td className="px-4 py-3">{s.customer_name || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-right font-extrabold text-[#dc2626]">MOP$ {fmt(s.total)}</td>
                      <td className="px-4 py-3 text-center">
                        {s.ship_status === "PENDING" ? (
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
                        {s.ship_status === "PENDING" ? (
                          <div className="inline-flex gap-2">
                            <PosButton
                              variant="red"
                              className="px-3 py-1"
                              onClick={async () => { await setOrderShipStatus(s.id, "CLOSED"); loadShip(shipTab); }}
                            >
                              Close
                            </PosButton>
                          </div>
                        ) : (
                          <div className="inline-flex gap-2">
                            <PosButton
                              variant="black"
                              className="px-3 py-1"
                              onClick={async () => { await setOrderShipStatus(s.id, "PENDING"); loadShip(shipTab); }}
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
