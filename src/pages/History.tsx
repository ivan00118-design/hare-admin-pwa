// src/pages/History.tsx
import React, { useEffect, useMemo, useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchOrders } from "../services/orders";
import { useAppState } from "../context/AppState";

/** 輸入是金額（MOP），四捨五入到 2 位小數並去掉多餘 0 */
const fmtMoney = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const fmtDateTime = (isoLike: string | Date) => {
  const d = isoLike instanceof Date ? isoLike : new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike ?? "");
  return d.toLocaleString();
};

/** 從 YYYY-MM-DD 轉成 Date（不校正時區） */
const dateInputToDate = (s?: string) => (s && s.length >= 10 ? new Date(`${s}T00:00:00`) : undefined);

/** 後端 rows 的最小欄位形狀（寬鬆） */
type OrderRow = {
  id: string;
  createdAt: string;
  total: number;
  paymentMethod?: string | null;
  channel?: "IN_STORE" | "DELIVERY" | null;
  isDelivery?: boolean;
  voided?: boolean;
  items?: Array<{ name: string; qty: number; price: number; grams?: number | null; category?: string }>;
};

type StatusFilter = "all" | "active" | "voided";

export default function History() {
  const { voidOrder } = useAppState();
  // 查詢條件
  const [status, setStatus] = useState<StatusFilter>("all");
  const [fromStr, setFromStr] = useState<string>(""); // YYYY-MM-DD（空字串代表未設定）
  const [toStr, setToStr] = useState<string>("");     // YYYY-MM-DD

  // 分頁
  const [page, setPage] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(50);

  // 載入結果
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  // UI 狀態
  const [voidingId, setVoidingId] = useState<string | null>(null);   // 哪一筆正在 void
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);

  // 觸發查詢
  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOrders({
        from: dateInputToDate(fromStr),
        to: dateInputToDate(toStr),
        status,         // "all" | "active" | "voided"
        page,           // 0-based
        pageSize,
      });
      // fetchOrders 只保證有 rows / page / pageSize；沒有 count
      setRows((res?.rows || []) as OrderRow[]);
    } catch (e) {
      console.error("[History] load failed:", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromStr, toStr, status, page, pageSize]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 沒有 count → 以 rows.length === pageSize 推測是否「可能」有下一頁
  const hasPrev = page > 0;
  const hasNext = rows.length === pageSize;

  // 以邏輯統一 Delivery 判斷（和 Dashboard 採用相同準則）
  const isDelivery = (o: OrderRow) =>
    typeof o.isDelivery === "boolean" ? o.isDelivery : o.channel === "DELIVERY";
  // 作廢 + 回補庫存
  const handleVoid = async (order: OrderRow) => {
    if (!order?.id || order.voided) return;

    const shortId = (order.id || "").slice(-6);
    const ok = window.confirm(`確定要作廢這張訂單 ${shortId} 嗎？`);
    if (!ok) return;

    const reasonInput = window.prompt("可輸入作廢原因（選填）：", "") || undefined;

    try {
      setVoidingId(order.id);
      // 帶 restock: true → 會呼叫 tryRestockByOrder，把庫存加回去
      await voidOrder(order.id, { restock: true, reason: reasonInput });
      await reload(); // 重新載 History 畫面
    } catch (e: any) {
      console.error("[History] void failed:", e);
      alert(e?.message ?? "作廢失敗，請稍後再試");
    } finally {
      setVoidingId(null);
    }
  };

  // 小計（僅本頁）
  const pageTotals = useMemo(() => {
    let orderRevenue = 0, deliveryRevenue = 0;
    let orderCount = 0, deliveryCount = 0;
    for (const o of rows) {
      if (o.voided) continue;
      const amt = Number(o.total) || 0;
      if (isDelivery(o)) {
        deliveryRevenue += amt;
        deliveryCount += 1;
      } else {
        orderRevenue += amt;
        orderCount += 1;
      }
    }
    return { orderRevenue, deliveryRevenue, orderCount, deliveryCount };
  }, [rows]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen" style={{ colorScheme: "light" }}>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <h1 className="text-2xl font-extrabold">History</h1>

        <div className="ml-auto flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs text-gray-600">From</label>
            <input
              type="date"
              value={fromStr}
              onChange={(e) => { setPage(0); setFromStr(e.target.value); }}
              className="h-10 border rounded px-3"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-600">To</label>
            <input
              type="date"
              value={toStr}
              onChange={(e) => { setPage(0); setToStr(e.target.value); }}
              className="h-10 border rounded px-3"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-600">Status</label>
            <select
              value={status}
              onChange={(e) => { setPage(0); setStatus(e.target.value as StatusFilter); }}
              className="h-10 border rounded px-3"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="voided">Voided</option>
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-600">Page Size</label>
            <select
              value={pageSize}
              onChange={(e) => { setPage(0); setPageSize(parseInt(e.target.value, 10) || 50); }}
              className="h-10 border rounded px-3"
            >
              {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <PosButton
            variant="confirm"
            className="!bg-white !text-black !border !border-gray-300 shadow hover:!bg-gray-100 active:!bg-gray-200 focus:!ring-2 focus:!ring-black"
            onClick={() => { setPage(0); reload(); }}
            disabled={loading}
          >
            Refresh
          </PosButton>
        </div>
      </div>

      {/* 本頁小計 */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Order Revenue (page)</div>
          <div className="mt-1 text-2xl font-extrabold text-[#111]">
            $ {fmtMoney(pageTotals.orderRevenue)}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Orders: {pageTotals.orderCount}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Delivery Revenue (page)</div>
          <div className="mt-1 text-2xl font-extrabold text-[#dc2626]">
            $ {fmtMoney(pageTotals.deliveryRevenue)}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Deliveries: {pageTotals.deliveryCount}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Total (page)</div>
          <div className="mt-1 text-2xl font-extrabold">
            $ {fmtMoney(pageTotals.orderRevenue + pageTotals.deliveryRevenue)}
          </div>
        </div>
        <div className="bg-white border rounded-xl p-4 shadow">
          <div className="text-sm text-gray-500">Rows (page)</div>
          <div className="mt-1 text-2xl font-extrabold">
            {rows.length}
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white border rounded-xl p-4 shadow">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black text-white uppercase text-xs font-bold">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Payment</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-center">Voided</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">Loading…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">No records.</td>
                </tr>
              ) : (
                rows.map((o) => {
                  const shortId = (o.id || "").slice(-6);
                  const type = isDelivery(o) ? "DELIVERY" : "IN_STORE";
                  return (
                    <tr key={o.id} className="border-t">
                      <td className="px-3 py-2">{fmtDateTime(o.createdAt)}</td>
                      <td className="px-3 py-2 font-mono">{shortId}</td>
                      <td className="px-3 py-2">
                        {type === "DELIVERY" ? (
                          <span className="inline-block text-[11px] px-2 py-[2px] rounded bg-amber-100 text-amber-700">
                            DELIVERY
                          </span>
                        ) : (
                          <span className="inline-block text-[11px] px-2 py-[2px] rounded bg-gray-100 text-gray-700">
                            IN_STORE
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{o.paymentMethod || <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-2 text-right font-bold text-[#dc2626]">$ {fmtMoney(o.total)}</td>
                      <td className="px-3 py-2 text-center">
                        {o.voided ? (
                          <span className="inline-block text-[11px] px-2 py-[2px] rounded bg-rose-100 text-rose-700">
                            VOIDED
                          </span>
                        ) : (
                          <span className="inline-block text-[11px] px-2 py-[2px] rounded bg-emerald-100 text-emerald-700">
                            ACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {/* 查看明細 */}
                          <PosButton
                            variant="black"
                            className="px-2 py-1 text-xs"
                            onClick={() => setDetailOrder(o)}
                            title="View order details"
                          >
                            Details
                          </PosButton>

                          {/* 作廢按鈕：已 void 的就不顯示 */}
                          {!o.voided && (
                            <PosButton
                              variant="red"
                              className="px-2 py-1 text-xs"
                              disabled={voidingId === o.id}
                              onClick={() => handleVoid(o)}
                              title="Void this order"
                            >
                              Void
                            </PosButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {detailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4">
            {/* header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <div className="text-xs text-gray-500">
                  {isDelivery(detailOrder) ? "Delivery" : "In-store"} •{" "}
                  {fmtDateTime(detailOrder.createdAt)}
                </div>
                <div className="text-lg font-extrabold">
                  Order {(detailOrder.id || "").slice(-6)}
                </div>
              </div>
              <button
                type="button"
                className="text-gray-500 hover:text-black text-xl leading-none px-2"
                onClick={() => setDetailOrder(null)}
              >
                ×
              </button>
            </div>

            {/* items */}
            <div className="px-4 py-3 max-h-[60vh] overflow-y-auto">
              {(!detailOrder.items || detailOrder.items.length === 0) ? (
                <p className="text-gray-500 text-sm">No items.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="py-1 text-left">Item</th>
                      <th className="py-1 text-right">Qty</th>
                      <th className="py-1 text-right">Price</th>
                      <th className="py-1 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailOrder.items!.map((it, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-1 pr-2">
                          <div>{it.name}</div>
                          {it.grams ? (
                            <div className="text-xs text-gray-500">
                              {it.grams}g{it.category ? ` • ${it.category}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-1 text-right">{it.qty}</td>
                        <td className="py-1 text-right">{fmtMoney(it.price)}</td>
                        <td className="py-1 text-right">
                          {fmtMoney(it.qty * it.price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* footer */}
            <div className="px-4 py-3 border-t flex items-center justify-between text-sm">
              <div>
                <span className="text-gray-500">Payment: </span>
                <span>{detailOrder.paymentMethod || "—"}</span>
              </div>
              <div className="font-bold">
                Total: MOP$ {fmtMoney(detailOrder.total)}
              </div>
            </div>
            <div className="px-4 py-3 border-t flex justify-end">
              <PosButton
                variant="black"
                className="px-4 py-2"
                onClick={() => setDetailOrder(null)}
              >
                Close
              </PosButton>
            </div>
          </div>
        </div>
      )}
        </div>

        {/* 分頁 */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Page {page + 1} · Page Size {pageSize}
          </div>
          <div className="flex gap-2">
            <PosButton
              variant="black"
              className="px-3 py-1"
              disabled={!hasPrev || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ⟵ Prev
            </PosButton>
            <PosButton
              variant="black"
              className="px-3 py-1"
              disabled={!hasNext || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ⟶
            </PosButton>
          </div>
        </div>
      </div>
    </div>
  );
}
