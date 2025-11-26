// src/pages/Reports.tsx
import React, { useState } from "react";
import PosButton from "../components/PosButton.jsx";
import { fetchOrders } from "../services/orders";

// 跟 History 一樣的型別
type StatusFilter = "all" | "active" | "voided";

type OrderRow = {
  id: string;
  createdAt: string;
  total: number;
  paymentMethod?: string | null;
  channel?: "IN_STORE" | "DELIVERY" | null;
  isDelivery?: boolean;
  voided?: boolean;
  items?: Array<{
    name: string;
    qty: number;
    price: number;
    grams?: number | null;
    category?: string;
  }>;
};

const dateInputToDate = (s?: string) =>
  s && s.length >= 10 ? new Date(`${s}T00:00:00`) : undefined;

// 專門給 CSV 用的日期格式
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

const escapeCsv = (v: any) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // 有逗號、引號、換行就包雙引號
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

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
  const [exporting, setExporting] = useState(false);

  const isDelivery = (o: OrderRow) =>
    typeof o.isDelivery === "boolean"
      ? o.isDelivery
      : o.channel === "DELIVERY";

  const handleExportCsv = async () => {
    try {
      setExporting(true);

      const res: any = await fetchOrders({
        from: dateInputToDate(fromStr),
        to: dateInputToDate(toStr),
        status,        // "all" | "active" | "voided"
        page: 0,
        pageSize: 5000, // 一次抓最多 5000 筆（夠用）
      });

      const rows: OrderRow[] = (res?.rows || []) as OrderRow[];

      if (!rows.length) {
        alert("這個條件下沒有歷史訂單可以匯出。");
        return;
      }

      const header = [
        "Date",
        "OrderID",
        "Type",
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

      const csvContent = "\uFEFF" + lines.join("\r\n"); // 加 BOM，Excel 比較不亂碼
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      const rangeLabel = (fromStr || "all") + "_" + (toStr || "today");

      a.href = url;
      a.download = `orders_${rangeLabel}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("[Reports] export csv failed", e);
      alert(e?.message || "匯出失敗，請稍後再試。");
    } finally {
      setExporting(false);
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

          <div className="ml-auto">
            <PosButton
              variant="black"
              className="px-4 py-2 text-sm"
              disabled={exporting}
              onClick={handleExportCsv}
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </PosButton>
          </div>
        </div>

        <p className="text-xs text-gray-500">
        </p>
      </div>
    </div>
  );
};

export default Reports;
