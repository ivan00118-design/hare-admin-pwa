// functions/api/superadmin.ts
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPERADMIN_TOKEN?: string; // 需在 CF Pages 設定
}

type CfCtx<E> = {
  request: Request;
  env: E;
  params: Record<string, string>;
  data: any;
  waitUntil(p: Promise<unknown>): void;
  next: () => Promise<Response>;
};

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function makeServiceClient(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function requireAdminToken(req: Request, env: Env) {
  const hdr = req.headers.get("authorization") || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;
  if (!env.SUPERADMIN_TOKEN) return false;
  return token === env.SUPERADMIN_TOKEN;
}

// 安全寫法：select → update / insert（避免 on_conflict）
async function ensureEmployee(
  supabase: ReturnType<typeof makeServiceClient>,
  userId: string,
  orgId: string,
  role: string
) {
  const { data: exists, error: selErr } = await supabase
    .from("employees")
    .select("user_id,org_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  // PGRST116 = not found；其他才算錯
  if (selErr && (selErr as any).code !== "PGRST116") throw selErr;

  if (exists) {
    const { error: updErr } = await supabase
      .from("employees")
      .update({ role })
      .eq("user_id", userId)
      .eq("org_id", orgId);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supabase
      .from("employees")
      .insert([{ user_id: userId, org_id: orgId, role }]);
    if (insErr) throw insErr;
  }
}

export const onRequestGet = async ({ request, env }: CfCtx<Env>) => {
  if (!requireAdminToken(request, env)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  const supabase = makeServiceClient(env);
  const url = new URL(request.url);
  const orgId = url.searchParams.get("org_id") || "";

  if (!orgId) return json(400, { ok: false, error: "Missing org_id" });

  const { data, error } = await supabase
    .from("employees")
    .select("user_id, org_id, role")
    .eq("org_id", orgId)
    .order("user_id", { ascending: true });

  if (error) return json(500, { ok: false, error: String(error.message || error) });
  return json(200, { ok: true, rows: data || [] });
};

export const onRequestPost = async ({ request, env }: CfCtx<Env>) => {
  if (!requireAdminToken(request, env)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }
  const supabase = makeServiceClient(env);
  const body = (await request.json().catch(() => ({}))) as Partial<{
    action: "remove";
    user_id: string;
    org_id: string;
    role: string;
  }>;

  const userId = String(body.user_id || "").trim();
  const orgId = String(body.org_id || "").trim();
  if (!userId || !orgId) return json(400, { ok: false, error: "Missing user_id or org_id" });

  // 刪除員工
  if (body.action === "remove") {
    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("user_id", userId)
      .eq("org_id", orgId);
    if (error) return json(500, { ok: false, error: String(error.message || error) });
    return json(200, { ok: true, removed: { user_id: userId, org_id: orgId } });
  }

  // 確保存在（或更新角色）
  const role = String(body.role ?? "member").trim();
  try {
    await ensureEmployee(supabase, userId, orgId, role);
    return json(200, { ok: true, user_id: userId, org_id: orgId, role });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
};
