// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

/** 你頁面有用到不同 key，這裡雙欄位相容：label 與 name 都保留 */
export type DeliveryShortcut = {
  id: string;
  label: string;                         // 主要顯示名稱
  name?: string;                         // 向後相容（=label）
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | null;
  sort_order?: number | null;
  active?: boolean | null;               // null 視為 true
  org_id?: string | null;
  created_at?: string;
};

/* 取 org_id（與 AppState 同邏輯） */
async function getOrgIdForCurrentUser(): Promise<string> {
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

/** 讀取（只取 active 或 null） */
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const orgId = await getOrgIdForCurrentUser();
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("*")
    .eq("org_id", orgId)
    .or("active.is.null,active.eq.true")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  const rows = (data ?? []) as any[];

  return rows.map((r: any): DeliveryShortcut => ({
    id: r.id,
    label: r.label ?? r.name ?? "",
    name: r.label ?? r.name ?? "",             // 向後相容
    fee: Number(r.fee) || 0,
    note: r.note ?? null,
    defaultPayment: r.default_payment ?? r.defaultPayment ?? null,
    sort_order: r.sort_order ?? null,
    active: r.active ?? true,
    org_id: r.org_id ?? orgId,
    created_at: r.created_at ?? null,
  }));
}

/** 批次儲存（全量覆寫）：
 *  - 會 upsert 現有/新增
 *  - 若要刪除：請傳入 active=false
 */
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]) {
  const orgId = await getOrgIdForCurrentUser();
  const payload = (list ?? []).map((s, idx) => ({
    id: s.id,
    org_id: orgId,
    label: (s.label ?? s.name ?? "").trim(),
    fee: Number(s.fee) || 0,
    note: s.note ?? null,
    default_payment: s.defaultPayment ?? null,
    sort_order: s.sort_order ?? idx + 1,
    active: s.active ?? true,
  })).filter((x) => x.label.length > 0);

  const { error } = await supabase.from("delivery_shortcuts").upsert(payload);
  if (error) throw error;
}

export const newId = () => (crypto?.randomUUID?.() ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));
