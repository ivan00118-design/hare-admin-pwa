// src/pages/Delivery.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAppState } from "../context/AppState";
import PosButton from "../components/PosButton.jsx";

type DeliveryStatus = "Pending" | "Preparing" | "OutForDelivery" | "Delivered" | "Cancelled";

const fmt = (n: number) => {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function Delivery() {
  const { orgId, orders = [], createOrder } = useAppState();
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [filter, setFilter] = useState<DeliveryStatus | "All">("All");
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setSessionReady(true);
    });
  const { data: sub } = supabase.auth.onAuthStateChange((_ev, sess) => {
    setHasSession(!!sess);
    setSessionReady(true);
  });
  return () => { sub?.subscription?.unsubscribe?.(); };
}, []);

  // 建立外送單（純外送，只有運費或自訂金額）
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [newFee, setNewFee] = useState<number>(0);
  const [newPay, setNewPay] = useState("Cash");

  const deliveries = useMemo(() => {
    const list = (orders as any[]).filter((o) => o?.channel === "delivery" || o?.delivery);
    return list
      .map((o) => ({
        ...o,
        delivery: o.delivery || { status: "Pending", name: "", phone: "", address: "", fee: 0 }
      }))
      .filter((o) => {
        const okStatus = filter === "All" ? true : o.delivery.status === filter;
        const okQ =
          !q ||
          (o.delivery.name || "").toLowerCase().includes(q.toLowerCase()) ||
          (o.delivery.phone || "").includes(q) ||
          (o.delivery.address || "").toLowerCase().includes(q.toLowerCase());
        return okStatus && okQ;
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [orders, filter, q]);

  const updateOrderDelivery = async (orderId: string, patch: Partial<{ status: DeliveryStatus; name: string; phone: string; address: string; fee: number }>) => {
    if (!orgId) return alert("尚未載入組織/門市資訊");
    if (!hasSession) return alert("請先登入再更新外送單");
    const nextOrders = (orders as any[]).map((o: any) =>
      o.id === orderId
        ? {
            ...o,
            channel: "delivery",
            delivery: { ...(o.delivery || {}), ...patch }
          }
        : o
    );
    setSavingId(orderId);
    const { error } = await supabase
      .from("app_state")
      .upsert({ org_id: orgId, key: "pos_orders", state: nextOrders }, { onConflict: "org_id,key" })
      .select("org_id,key");
    setSavingId(null);
    if (error) alert("更新失敗：" + error.message);
  };

  const createDeliveryOnly = async () => {
    if (!newName.trim() || !newAddr.trim()) {
      alert("請輸入收件人與地址");
      return;
    }
    if (!hasSession) {
      alert("請先登入再建立外送單");
      return;
    }
    const fee = Math.max(0, Number(newFee) || 0);

    // 以「運費」作為唯一品項（避免空購物車），不影響結構
    const feeItem: any = {
      id: "delivery-fee",
      name: "Delivery Fee",
      price: fee,
      grams: 0,
      stock: 0,
      unit: "kg",
      category: "HandDrip",
      subKey: null,
      qty: 1,
      deductKg: 0
    };

    const id = await createOrder([feeItem], fee, { paymentMethod: newPay });
    if (!id) return;

    await updateOrderDelivery(id, {
      status: "Pending",
      name: newName.trim(),
      phone: newPhone.trim(),
      address: newAddr.trim(),
      fee
    });

    setNewName(""); setNewPhone(""); setNewAddr(""); setNewFee(0); setNewPay("Cash");
    alert("✅ 已建立外送單");
  };

  const nextStatus = (s: DeliveryStatus): DeliveryStatus =>
    s === "Pending" ? "Preparing" : s === "Preparing" ? "OutForDelivery" : s === "OutForDelivery" ? "Delivered" : "Delivered";

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">Delivery</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Status</label>
          <select className="h-10 border rounded px-3" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option>All</option>
            <option>Pending</option>
            <option>Preparing</option>
            <option>OutForDelivery</option>
            <option>Delivered</option>
            <option>Cancelled</option>
          </select>
          <input className="h-10 border rounded px-3" placeholder="Search name / phone / address" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* 建立新外送單 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow p-4 mb-6">
        <h2 className="text-lg font-bold mb-3">Create Delivery</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">收件人</label>
            <input className="w-full border rounded px-3 h-10" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">電話</label>
            <input className="w-full border rounded px-3 h-10" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-gray-600 mb-1">地址</label>
            <textarea className="w-full border rounded px-3 py-2 min-h-[72px]" value={newAddr} onChange={(e) => setNewAddr(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">運費</label>
            <input type="number" min={0} step="1" className="w-full border rounded px-3 h-10" value={newFee} onChange={(e) => setNewFee(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">付款方式</label>
            <select className="w-full border rounded px-3 h-10" value={newPay} onChange={(e) => setNewPay(e.target.value)}>
              <option value="Cash">Cash</option>
              <option value="SimplePay">SimplePay</option>
              <option value="MacauPass">MacauPass</option>
            </select>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <PosButton variant="confirm" onClick={createDeliveryOnly}>➕ 建立外送單</PosButton>
          </div>
        </div>
      </div>

      {/* 清單 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm text-gray-900">
          <thead className="bg-black text-white uppercase text-xs font-bold">
            <tr>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Recipient</th>
              <th className="px-4 py-3 text-left">Address</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-right">Fee</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">No deliveries.</td>
              </tr>
            ) : deliveries.map((o: any) => (
              <tr key={o.id} className="border-t border-gray-200 align-top">
                <td className="px-4 py-3">{new Date(o.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{o.delivery.name || "—"}</div>
                </td>
                <td className="px-4 py-3 whitespace-pre-wrap">{o.delivery.address || "—"}</td>
                <td className="px-4 py-3">{o.delivery.phone || "—"}</td>
                <td className="px-4 py-3 text-right">MOP$ {fmt(o.delivery.fee || 0)}</td>
                <td className="px-4 py-3">
                  <span className="inline-block text-xs px-2 py-[2px] rounded bg-gray-100 border">
                    {o.delivery.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {o.delivery.status !== "Delivered" && o.delivery.status !== "Cancelled" ? (
                    <div className="inline-flex gap-2">
                      <PosButton variant="tab" disabled={savingId === o.id}
                        onClick={() => updateOrderDelivery(o.id, { status: nextStatus(o.delivery.status) })}>
                        Next
                      </PosButton>
                      <PosButton variant="black" disabled={savingId === o.id}
                        onClick={() => updateOrderDelivery(o.id, { status: "Cancelled" })}>
                        Cancel
                      </PosButton>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
