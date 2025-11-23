// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

export type PaymentKey = "SimplePay" | "Cash" | "MacauPass" | "QR";

export type DeliveryShortcut = {
  id: string;
  label: string;
  fee: number;
  note: string | null;
  defaultPayment: PaymentKey | null;      // 給前端用（駝峰）
  default_payment?: PaymentKey | null;    // DB 欄位（蛇形）；為了兼容
  sort_order?: number | null;
  archived?: boolean | null;
  /** 舊程式若用到 name 欄位，這裡保留為 optional 以消除 TS 錯誤 */
  name?: string;
};

export const newId = () =>
  (crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));

export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("id,label,fee,note,default_payment,sort_order,archived")
    .or("archived.is.null,archived.eq.false")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map((r: any) => ({
    id: r.id,
    label: r.label,
    fee: Number(r.fee || 0),
    note: r.note ?? null,
    defaultPayment: (r.default_payment ?? null) as PaymentKey | null,
    default_payment: r.default_payment ?? null,
    sort_order: r.sort_order ?? null,
    archived: r.archived ?? null,
    name: r.label, // 兼容舊型別
  }));
}

export async function saveDeliveryShortcuts(list: DeliveryShortcut[]): Promise<void> {
  const rows = list.map((s) => ({
    id: s.id,
    label: s.label,
    fee: s.fee ?? 0,
    note: s.note ?? null,
    default_payment: (s.defaultPayment ?? s.default_payment ?? null) as PaymentKey | null,
    sort_order: s.sort_order ?? null,
    archived: s.archived ?? false,
  }));

  const { error } = await supabase
    .from("delivery_shortcuts")
    .upsert(rows, { onConflict: "id" });
  if (error) throw error;
}
