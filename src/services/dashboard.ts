// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

// 與頁面對齊的型別
export type DeliveryShortcut = {
  id: string;
  name: string;                 // 對應 DB 的 label
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | null;
  sort_order?: number | null;
  active?: boolean | null;
  created_at?: string;
};

// 取得目前使用者所屬 org_id（沿用你在 AppState 的做法）
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

// 讀取（不再過濾 archived；若你的表有 active 欄位可以加 .or('active.is.null,active.eq.true')）
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const orgId = await getOrgId();

  let q = supabase
    .from("delivery_shortcuts")
    .select("id,label,fee,note,default_payment,sort_order,active,created_at")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.label ?? "",
    fee: Number(r.fee ?? 0),
    note: r.note ?? null,
    defaultPayment: (r.default_payment ?? null) as any,
    sort_order: r.sort_order ?? null,
    active: r.active ?? null,
    created_at: r.created_at,
  }));
}

// 儲存（upsert）
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]) {
  const orgId = await getOrgId();

  const rows = list.map((s, idx) => ({
    id: s.id,
    org_id: orgId,
    label: s.name?.trim() || "",
    fee: Number(s.fee || 0),
    note: s.note ?? null,
    default_payment: s.defaultPayment ?? null,
    sort_order: s.sort_order ?? idx,
    active: s.active ?? true,
  }));

  const { error } = await supabase.from("delivery_shortcuts").upsert(rows);
  if (error) throw error;
}
