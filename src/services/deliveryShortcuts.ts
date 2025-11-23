// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

/** 和前端 UI 對齊：使用 label、defaultPayment（DB 為 default_payment） */
export type PaymentMethodKey = "SimplePay" | "Cash" | "MacauPass" | "QR";

export type DeliveryShortcut = {
  id: string;
  label: string;
  fee: number;
  note?: string | null;
  defaultPayment?: PaymentMethodKey | null;
  sort_order?: number | null;
};

/** 產生前端暫用 id（未寫入 DB 前用） */
export const newId = (): string =>
  (crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2)) +
  Date.now().toString(36);

/** 載入 Delivery Shortcuts（只取未封存；sort_order → created_at） */
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const q = supabase
    .from("delivery_shortcuts")
    .select("id,label,fee,note,default_payment,sort_order,archived")
    // 未封存；兼容舊表（archived 可能為 null）
    .or("archived.is.null,archived.eq.false")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;

  return (data || []).map((r: any) => ({
    id: String(r.id),
    label: r.label ?? "",
    fee: Number(r.fee ?? 0),
    note: r.note ?? null,
    // DB: 'QrCode' → UI: 'QR'
    defaultPayment: (r.default_payment === "QrCode" ? "QR" : r.default_payment) ?? null,
    sort_order: typeof r.sort_order === "number" ? r.sort_order : null,
  }));
}

/** 批次儲存（upsert）Delivery Shortcuts */
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]): Promise<void> {
  const rows = (list || []).map((s) => ({
    id: s.id,
    label: s.label,
    fee: Number(s.fee) || 0,
    note: s.note ?? null,
    // UI: 'QR' → DB: 'QrCode'
    default_payment: s.defaultPayment === "QR" ? "QrCode" : s.defaultPayment ?? null,
    sort_order: s.sort_order ?? null,
    archived: false,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("delivery_shortcuts")
    .upsert(rows, { onConflict: "id" }); // 確保用 id 當 upsert key
  if (error) throw error;
}
