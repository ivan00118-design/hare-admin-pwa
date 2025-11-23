// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

/** 單筆快捷鍵型別（同時提供 name 與 label，避免舊程式改太多） */
export type DeliveryShortcut = {
  id: string;
  label: string;                         // DB 欄位
  name?: string;                         // 前端相容別名（＝label）
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | "QrCode" | null;
  sort_order?: number | null;
  org_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

/** 上傳/儲存用最小結構 */
export type DeliveryShortcutUpsert = {
  id?: string;
  label: string;
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | "QrCode" | null;
  sort_order?: number | null;
  archived?: boolean | null;
};

export const newId = () =>
  (crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/** 全量讀取（依 sort_order、created_at 排序） */
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    label: r.label,
    name: r.label, // 相容舊程式
    fee: Number(r.fee || 0),
    note: r.note ?? null,
    defaultPayment: r.default_payment ?? null,
    sort_order: r.sort_order ?? null,
    org_id: r.org_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** 批次儲存（upsert by id） */
export async function saveDeliveryShortcuts(list: DeliveryShortcutUpsert[]): Promise<void> {
  const rows = (list ?? [])
    .map((s) => ({
      id: s.id ?? undefined,
      label: String(s.label || "").trim(),
      fee: Number(s.fee || 0),
      note: s.note ?? null,
      default_payment: s.defaultPayment ?? null,
      sort_order: s.sort_order ?? null,
      archived: s.archived ?? false,
    }))
    // 濾掉空白 label
    .filter((x) => x.label.length > 0);

  const { error } = await supabase
    .from("delivery_shortcuts")
    .upsert(rows, { onConflict: "id" });

  if (error) throw error;
}

/** 單筆刪除（必要時用） */
export async function removeDeliveryShortcut(id: string): Promise<void> {
  const { error } = await supabase.from("delivery_shortcuts").delete().eq("id", id);
  if (error) throw error;
}
