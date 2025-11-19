import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchOrders, voidOrderDB, restockByOrder } from "../services/orders";

const fmtMoney = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const fmtTime = (iso?: string | null) => {
  try {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso || "";
  }
};

export default function History() {
  // 🔁 改成從 DB 來的資料
  const [rows, setRows] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(false);

  // 篩選 UI（沿用你的欄位）
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "voided">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalGross = useMemo(
    () => totalAmount, // 從 DB 彙總，不再用前端 reduce
    [totalAmount]
  );

  async function load() {
    setLoading(true);
    try {
      const res = await fetchOrders({
        from: fromDate ? new Date(fromDate) : null,
        to: toDate ? new Date(toDate) : null,
        status,
        page: 0,
        pageSize: 200, // 依需求調整
      });
      setRows(res.rows);
      setCount(res.count);
      setTotalAmount(res.totalAmount);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, status]);

  const askVoid = async (order: any) => {
    const reason = window.prompt("作廢原因（可留空）：", "") || "";
    const restock = window.confirm("是否回補庫存？\n按「確定」= 回補；按「取消」= 不回補");
    try {
      await voidOrderDB(order.id, { reason });
      if (restock) {
        await restockByOrder(order.id); // 你若尚未實作，這行可先註解
      }
      await load(); // 重新載入
    } catch (e: any) {
      alert(e.message ?? "Void failed");
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-2xl font-extrabold mb-4">History</h1>

      <div className="bg-white border border-gray-200 rounded-xl shadow p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border rounded px-3 h-10" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border rounded px-3 h-10" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="border rounded px-3 h-10">
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="voided">Voided</option>
            </select>
          </div>
          <PosButton variant="tab" onClick={() => { setFromDate(""); setToDate(""); setStatus("all"); }}>
            Clear
          </PosButton>

          <div className="ml-auto text-sm text-gray-600">
            <span className="mr-4">Count: <b>{count}</b></span>
            <span>Total: <b>MOP$ {fmtMoney(totalGross)}</b></span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm text-gray-900">
          <thead className="bg-black text-white uppercase text-xs font-bold">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Order ID</th>
              <th className="px-4 py-3 text-left">Payment</th>
              <th className="px-4 py-3 text-left">Items</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No records.</td></tr>
            ) : rows.map((o) => {
              const isOpen = expandedId === o.id;
              const shortId = (o.id || "").slice(-6);
              return (
                <React.Fragment key={o.id}>
                  <tr className="border-t border-gray-200 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{fmtTime(o.createdAt)}</div>
                      {o.voided ? (
                        <span className="inline-block mt-1 text-[11px] px-2 py-[2px] rounded bg-red-100 text-red-700">VOIDED</span>
                      ) : (
                        <span className="inline-block mt-1 text-[11px] px-2 py-[2px] rounded bg-emerald-100 text-emerald-700">ACTIVE</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><div className="font-mono">{shortId}</div></td>
                    <td className="px-4 py-3">{o.paymentMethod || <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="underline underline-offset-2 decoration-gray-400 hover:text-black"
                        onClick={() => setExpandedId(isOpen ? null : o.id)}
                        title="Toggle details"
                      >
                        {isOpen ? "Hide" : "Show"} details ({Array.isArray(o.items) ? o.items.length : 0})
                      </button>
                      {isOpen && Array.isArray(o.items) && (
                        <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2">
                          <ul className="list-disc pl-4">
                            {o.items.map((it: any, idx: number) => (
                              <li key={idx} className="mb-1">
                                <span className="font-medium">{it.name}</span>
                                {it.category === "drinks" && it.subKey
                                  ? ` (${it.subKey === "espresso" ? "Espresso" : "Single Origin"})`
                                  : it.grams
                                  ? ` (${it.grams}g)`
                                  : ""} · Qty: {it.qty} · Price: {fmtMoney(it.price)}
                                {" · "}Subtotal: {fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0))}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-extrabold text-[#dc2626]">MOP$ {fmtMoney(o.total)}</td>
                    <td className="px-4 py-3 text-center">
                      {o.voided ? <span className="text-gray-400">—</span> : (
                        <PosButton variant="black" onClick={() => askVoid(o)} title="Void this order">Void</PosButton>
                      )}
                    </td>
                  </tr>
                  {o.voided && o.voidReason && (
                    <tr className="border-t border-gray-100">
                      <td colSpan={6} className="px-4 py-2 text-xs text-gray-500">
                        Void reason: {o.voidReason} {o.voidedAt ? `（${fmtTime(o.voidedAt)}）` : ""}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
