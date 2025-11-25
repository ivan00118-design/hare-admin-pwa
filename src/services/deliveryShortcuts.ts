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

// 跟 deliveryShipments / dashboard 一樣，從 employees 找出目前使用者的 org_id
async function getOrgId(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("employees")
    .select("org_id")
    .eq("user_id", uid)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.org_id) throw new Error("No organization bound to this user");

  return data.org_id as string;
}

export const newId = () =>
  (crypto?.randomUUID?.()
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10));

/** 讀取目前 org 的 shortcuts */
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const orgId = await getOrgId();

  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("id,label,fee,note,default_payment,sort_order,archived")
    .eq("org_id", orgId)
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

/** 儲存 shortcuts：帶上 org_id，避免 NOT NULL 錯誤 */
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]): Promise<void> {
  const orgId = await getOrgId();

  const rows = list.map((s, idx) => ({
    id: s.id,
    org_id: orgId,
    label: s.label,
    fee: s.fee ?? 0,
    note: s.note ?? null,
    default_payment: (s.defaultPayment ?? s.default_payment ?? null) as PaymentKey | null,
    sort_order: s.sort_order ?? idx,
    archived: s.archived ?? false,
  }));

  const { error } = await supabase
    .from("delivery_shortcuts")
    .upsert(rows, { onConflict: "id" });

  if (error) throw error;
}
