// src/pages/Reports.tsx
import React, { useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchOrders } from "../services/orders";

/** 跟 History 一樣的型別（寬鬆） */
type StatusFilter = "all" | "active" | "voided";

type OrderItemRow = {
  name: string;
  sku: string;
  qty: number;
  price: number;
  grams?: number | null;
  category?: string;
};

type OrderRow = {
  id: string;
  createdAt: string;
  total: number;
  paymentMethod?: string | null;
  channel?: "IN_STORE" | "DELIVERY" | null;
  isDelivery?: boolean;
  voided?: boolean;
  items?: OrderItemRow[];
};

/** 從 YYYY-MM-DD 轉成 Date（不校正時區） */
const dateInputToDate = (s?: string) =>
  s && s.length >= 10 ? new Date(`${s}T00:00:00`) : undefined;

/** 給 CSV 用的固定時間格式 */
const fmtDateTimeForCsv = (isoLike: string | Date) => {
  const d = isoLike instanceof Date ? isoLike : new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike ?? "");
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
};

/** CSV 轉義：處理逗號 / 引號 / 換行 */
const escapeCsv = (v: any) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/** 金額格式（跟 History 一樣邏輯） */
const fmtMoney = (n: number) => {
  const v = Number(n) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Number.isInteger(r)
    ? String(r)
    : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const Reports: React.FC = () => {
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [exportingSummary, setExportingSummary] = useState(false);
  const [exportingDetails, setExportingDetails] = useState(false);

  const isDelivery = (o: OrderRow) =>
    typeof o.isDelivery === "boolean"
      ? o.isDelivery
      : o.channel === "DELIVERY";

  /** 共用：依照條件讀取訂單（跟 History 用同一個 fetchOrders） */
  const loadOrders = async (): Promise<OrderRow[]> => {
    const res: any = await fetchOrders({
      from: dateInputToDate(fromStr),
      to: dateInputToDate(toStr),
      status,         // "all" | "active" | "voided"
      page: 0,
      pageSize: 5000, // 一次最多抓 5000 張訂單
    });
    return (res?.rows || []) as OrderRow[];
  };

  /** 粗版：一張訂單一列（跟之前一樣的 summary 匯出） */
  const handleExportSummaryCsv = async () => {
    try {
      setExportingSummary(true);
      const rows = await loadOrders();

      if (!rows.length) {
        alert("這個條件下沒有歷史訂單可以匯出。");
        return;
      }

      const header = [
        "Date",
        "OrderID",
        "Type",     // Delivery / In-store
        "Channel",
        "Payment",
        "Total",
        "Voided",
      ];

      const lines: string[] = [];
      lines.push(header.join(","));

      for (const o of rows) {
        const typeLabel = isDelivery(o) ? "Delivery" : "In-store";

        lines.push(
          [
            escapeCsv(fmtDateTimeForCsv(o.createdAt)),
            escapeCsv(o.id),
            escapeCsv(typeLabel),
            escapeCsv(o.channel || ""),
            escapeCsv(o.paymentMethod || ""),
            escapeCsv(fmtMoney(o.total)),
            escapeCsv(o.voided ? "YES" : "NO"),
          ].join(",")
        );
      }

      const csvContent = "\uFEFF" + lines.join("\r\n");
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const rangeLabel = (fromStr || "all") + "_" + (toStr || "today");

      a.href = url;
      a.download = `orders_summary_${rangeLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("[Reports] export summary csv failed", e);
      alert(e?.message || "匯出失敗，請稍後再試。");
    } finally {
      setExportingSummary(false);
    }
  };

  /** 細版：每個品項一列（Order × Item 展開） */
  const handleExportDetailsCsv = async () => {
    try {
      setExportingDetails(true);
      const rows = await loadOrders();

      if (!rows.length) {
        alert("這個條件下沒有歷史訂單可以匯出。");
        return;
      }

      const header = [
        "Date",
        "OrderID",
        "Type",       // Delivery / In-store
        "Channel",
        "Payment",
        "Voided",
        "ItemName",
        "SKU",
        "Qty",
        "UnitPrice",
        "Subtotal",
        "Category",
        "Grams",
      ];

      const lines: string[] = [];
      lines.push(header.join(","));

      for (const o of rows) {
        const typeLabel = isDelivery(o) ? "Delivery" : "In-store";
        const commonCols = [
          escapeCsv(fmtDateTimeForCsv(o.createdAt)),
          escapeCsv(o.id),
          escapeCsv(typeLabel),
          escapeCsv(o.channel || ""),
          escapeCsv(o.paymentMethod || ""),
          escapeCsv(o.voided ? "YES" : "NO"),
        ];

        const items = o.items || [];
        if (!items.length) {
          // 沒有 items 的訂單，略過（或你想要也輸出一列空品項可以改這裡）
          continue;
        }

        for (const it of items) {
          const subtotal = (Number(it.qty) || 0) * (Number(it.price) || 0);

          lines.push(
            [
              ...commonCols,
              escapeCsv(it.name),
              escapeCsv(it.sku),
              escapeCsv(it.qty),
              escapeCsv(fmtMoney(it.price)),
              escapeCsv(fmtMoney(subtotal)),
              escapeCsv(it.category || ""),
              escapeCsv(it.grams ?? ""),
            ].join(",")
          );
        }
      }

      const csvContent = "\uFEFF" + lines.join("\r\n");
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const rangeLabel = (fromStr || "all") + "_" + (toStr || "today");

      a.href = url;
      a.download = `orders_details_${rangeLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("[Reports] export details csv failed", e);
      alert(e?.message || "匯出失敗，請稍後再試。");
    } finally {
      setExportingDetails(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold mb-4">Reports</h1>

      <div className="border rounded-xl p-4 bg-white shadow-sm max-w-3xl">
        <h2 className="text-base font-semibold mb-3">
          匯出歷史訂單（與 History 頁面相同來源）
        </h2>

        <div className="flex flex-wrap items-end gap-4 mb-3">
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">From</label>
            <input
              type="date"
              value={fromStr}
              onChange={(e) => setFromStr(e.target.value)}
              className="h-10 border rounded px-3"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">To</label>
            <input
              type="date"
              value={toStr}
              onChange={(e) => setToStr(e.target.value)}
              className="h-10 border rounded px-3"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as StatusFilter)
              }
              className="h-10 border rounded px-3"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="voided">Voided</option>
            </select>
          </div>

          <div className="ml-auto flex flex-col gap-2">
            <PosButton
              variant="black"
              className="px-4 py-2 text-sm w-full"
              disabled={exportingSummary || exportingDetails}
              onClick={handleExportSummaryCsv}
            >
              {exportingSummary ? "Exporting…" : "Export Summary CSV"}
            </PosButton>

            <PosButton
              variant="confirm"
              className="px-4 py-2 text-sm w-full"
              disabled={exportingSummary || exportingDetails}
              onClick={handleExportDetailsCsv}
            >
              {exportingDetails ? "Exporting…" : "Export Details CSV"}
            </PosButton>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Summary：每張訂單一列（總額、付款方式等）；
          Details：每個品項一列（會展開 Order × Item，含 Qty / 價格 / 小計 / 類別 / 克數）。
        </p>
      </div>
    </div>
  );
};

export default Reports;
