// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

export type DeliveryShortcut = {
  id: string;
  name: string; // UI 欄位，DB 對應 label
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | "QrCode" | null;
  sort_order?: number | null;
  archived?: boolean | null;
};

type DeliveryShortcutRow = {
  id: string;
  org_id?: string | null;
  label: string;
  fee: number;
  note?: string | null;
  default_payment?: "SimplePay" | "Cash" | "MacauPass" | "QrCode" | null;
  sort_order?: number | null;
  archived?: boolean | null;
  created_at?: string;
};

/** 產生 id（前端） */
export function newId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** DB -> UI */
function rowToUI(r: DeliveryShortcutRow): DeliveryShortcut {
  return {
    id: r.id,
    name: r.label,
    fee: Number(r.fee) || 0,
    note: r.note ?? null,
    defaultPayment: r.default_payment ?? null,
    sort_order: r.sort_order ?? null,
    archived: r.archived ?? null,
  };
}

/** UI -> DB */
function uiToRow(s: DeliveryShortcut): DeliveryShortcutRow {
  return {
    id: s.id,
    label: s.name,
    fee: Number(s.fee) || 0,
    note: s.note ?? null,
    default_payment: s.defaultPayment ?? null,
    sort_order: s.sort_order ?? null,
    archived: s.archived ?? false,
  };
}

/** 讀取（不依賴 archived / org_id 過濾，避免 400）*/
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToUI);
}

/** 儲存：整批 upsert（不刪除不存在的；刪除請另呼叫 remove）*/
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]) {
  const rows = list.map(uiToRow);
  const { error } = await supabase.from("delivery_shortcuts").upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

/** 刪除（或軟刪） */
export async function removeDeliveryShortcut(id: string, soft = true) {
  if (soft) {
    const { error } = await supabase
      .from("delivery_shortcuts")
      .update({ archived: true })
      .eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("delivery_shortcuts").delete().eq("id", id);
    if (error) throw error;
  }
}
