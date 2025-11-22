// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

/**
 * 對外型別（供頁面使用）：
 * - name           ⇄ DB: label
 * - defaultPayment ⇄ DB: default_payment
 */
export type DeliveryShortcut = {
  id: string;
  name: string;
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | null;
  sort?: number;       // 對應 DB sort_order
  active?: boolean;
};

/** 產生 id（供暫存新增用） */
export const newId = () =>
  (crypto?.randomUUID?.() ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** 取得目前使用者的 org_id（沿用你現有員工表） */
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

/** DB → UI 轉換 */
function fromRow(r: any): DeliveryShortcut {
  return {
    id: r.id,
    name: r.label,                       // label -> name
    fee: Number(r.fee ?? 0),
    note: r.note ?? null,
    defaultPayment: (r.default_payment ?? null) as any, // default_payment -> defaultPayment
    sort: Number(r.sort_order ?? 0),
    active: !!r.active,
  };
}

/** UI → DB 轉換 */
function toRow(orgId: string, s: DeliveryShortcut, sortIndex: number) {
  return {
    id: s.id,
    org_id: orgId,
    label: (s.name || "").trim(),
    fee: Number(s.fee || 0),
    note: s.note ?? null,
    default_payment: (s.defaultPayment || null) as any,
    sort_order: Number.isFinite(s.sort as number) ? Number(s.sort) : sortIndex,
    active: typeof s.active === "boolean" ? s.active : true,
  };
}

/**
 * 讀取所有快捷（按 sort_order、created_at 排序）
 */
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const orgId = await getOrgIdForCurrentUser();
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("id,label,fee,note,default_payment,sort_order,active,created_at")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(fromRow);
}

/**
 * 儲存整份快捷清單（你原本的 Save 按鈕）
 * - 行為：upsert 目前清單；刪除 DB 中「不在清單」的資料（完全同步）
 */
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]): Promise<void> {
  const orgId = await getOrgIdForCurrentUser();

  // 1) 先抓出 DB 目前有哪些 id
  const prev = await supabase
    .from("delivery_shortcuts")
    .select("id")
    .eq("org_id", orgId);

  if (prev.error) throw prev.error;
  const prevIds = new Set((prev.data ?? []).map((r: any) => r.id));

  // 2) upsert 目前清單（依畫面順序寫入 sort）
  const rows = list.map((s, idx) => toRow(orgId, s, idx));
  const up = await supabase
    .from("delivery_shortcuts")
    .upsert(rows, { onConflict: "id" })
    .select("id");

  if (up.error) throw up.error;

  const keepIds = new Set((up.data ?? []).map((r: any) => r.id));
  for (const s of list) keepIds.add(s.id); // 若 supabase 未回傳所有 id，保險再補

  // 3) 刪除「不在清單」的舊資料（完全同步）
  const toDelete = [...prevIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const del = await supabase
      .from("delivery_shortcuts")
      .delete()
      .in("id", toDelete)
      .eq("org_id", orgId);
    if (del.error) throw del.error;
  }
}

/** 單筆新增（若你需要即時新增不走整包 Save） */
export async function createDeliveryShortcut(s: Omit<DeliveryShortcut, "id"> & { id?: string }) {
  const orgId = await getOrgIdForCurrentUser();
  const row = toRow(orgId, { ...s, id: s.id ?? newId() } as DeliveryShortcut, s as any as number ?? 0);
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data);
}

/** 單筆更新 */
export async function updateDeliveryShortcut(id: string, patch: Partial<DeliveryShortcut>) {
  const orgId = await getOrgIdForCurrentUser();
  // 先讀原始值，再組合更新
  const cur = await supabase
    .from("delivery_shortcuts")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (cur.error) throw cur.error;
  if (!cur.data) throw new Error("Shortcut not found");

  const merged = {
    id,
    name: patch.name ?? cur.data.label,
    fee: patch.fee ?? cur.data.fee,
    note: patch.note ?? cur.data.note,
    defaultPayment: typeof patch.defaultPayment === "undefined" ? cur.data.default_payment : patch.defaultPayment,
    sort: typeof patch.sort === "undefined" ? cur.data.sort_order : patch.sort,
    active: typeof patch.active === "undefined" ? cur.data.active : patch.active,
  } as DeliveryShortcut;

  const row = toRow(orgId, merged, merged.sort ?? 0);
  const up = await supabase
    .from("delivery_shortcuts")
    .update(row)
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();

  if (up.error) throw up.error;
  return fromRow(up.data);
}

/** 刪除單筆 */
export async function deleteDeliveryShortcut(id: string) {
  const orgId = await getOrgIdForCurrentUser();
  const { error } = await supabase
    .from("delivery_shortcuts")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}
