// src/services/deliveryShortcuts.ts
import { supabase } from "../supabaseClient";

/**
 * 統一給前端用的型別（與 DB 命名解耦）
 * - DB 欄位若是 label / default_payment 也 OK，載入時自動轉換
 */
export type DeliveryShortcut = {
  id: string;
  name: string;
  fee: number;
  note?: string | null;
  defaultPayment?: "SimplePay" | "Cash" | "MacauPass" | null;
  sortOrder?: number | null;
  archived?: boolean | null;
  created_at?: string;
};

export function newId() {
  try {
    // @ts-ignore
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 依登入者取 org_id（與 AppState 內部版本一致） */
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

/** DB row → 前端型別（自動容錯 name/label、note/memo、default_payment/defaultPayment） */
function rowToShortcut(row: any): DeliveryShortcut {
  return {
    id: String(row.id ?? newId()),
    name: String(row.name ?? row.label ?? ""),
    fee: Number(row.fee ?? 0),
    note: (row.note ?? row.memo ?? null) as string | null,
    defaultPayment: (row.default_payment ?? row.defaultPayment ?? null) as any,
    sortOrder: row.sort_order ?? null,
    archived: row.archived ?? null,
    created_at: row.created_at ?? undefined,
  };
}

/** 讀取全部快捷（未封存） */
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  const orgId = await getOrgIdForCurrentUser();
  // 用 "*" 以避免欄位命名差異造成 select 失敗
  const { data, error } = await supabase
    .from("delivery_shortcuts")
    .select("*")
    .eq("org_id", orgId)
    .or("archived.is.null,archived.eq.false")
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(rowToShortcut);
}

/**
 * 儲存整份快捷（同步模式）：
 * - Upsert 現有/新增
 * - 刪除不在清單的舊資料（若要改成封存，把 delete 換成 update { archived: true }）
 * - 自動容錯 name/label 欄位差異（先試 name，不行再退回 label）
 */
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]): Promise<void> {
  const orgId = await getOrgIdForCurrentUser();

  // 1) 先抓目前的 id，後面用來刪除不在清單中的舊資料
  const cur = await supabase
    .from("delivery_shortcuts")
    .select("id")
    .eq("org_id", orgId);
  if (cur.error) throw cur.error;

  const keep = new Set(list.map((x) => x.id));
  const toDelete = (cur.data ?? [])
    .map((r: any) => r.id)
    .filter((id: string) => !keep.has(id));

  // 2) 準備 upsert rows（優先以 name 欄位）
  const rowsName = list.map((s, i) => ({
    id: s.id ?? newId(),
    org_id: orgId,
    name: s.name,
    fee: Number(s.fee || 0),
    note: s.note ?? null,
    default_payment: s.defaultPayment ?? null,
    sort_order: i,
    archived: false,
  }));

  // 3) 嘗試 upsert（name 版）
  const up1 = await supabase
    .from("delivery_shortcuts")
    .upsert(rowsName, { onConflict: "id" });

  // 4) 若資料表沒有 name 欄位，改用 label 欄位重試
  if (up1.error && /column .*name.* does not exist/i.test(up1.error.message)) {
    const rowsLabel = rowsName.map((r: any) => {
      const { name, ...rest } = r;
      return { ...rest, label: name };
    });
    const up2 = await supabase
      .from("delivery_shortcuts")
      .upsert(rowsLabel, { onConflict: "id" });
    if (up2.error) throw up2.error;
  } else if (up1.error) {
    throw up1.error;
  }

  // 5) 清掉不在本次清單的舊資料（若要 soft-delete，改成 update archived=true）
  if (toDelete.length > 0) {
    const del = await supabase
      .from("delivery_shortcuts")
      .delete()
      .in("id", toDelete)
      .eq("org_id", orgId);
    if (del.error) throw del.error;
  }
}
