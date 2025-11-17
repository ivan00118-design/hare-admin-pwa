// functions/api/employees.ts
import { createClient } from "@supabase/supabase-js";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SERVICE_ROLE?: string;
  SUPABASE_ANON_KEY?: string;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
    ...init,
  });
}

function makeClient(env: Env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE || env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SERVICE_ROLE(/ANON) key in env");
  return createClient(url, key, { auth: { persistSession: false } });
}

// 為避免 TS 泛型造成 never，這裡以 any 消解；邏輯為 select→update/insert（不使用 on_conflict）
async function ensureEmployee(supabase: any, userId: string, orgId: string, role?: string | null) {
  const { data: exists, error: selErr } = await supabase
    .from("employees")
    .select("user_id,org_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (selErr && (selErr as any).code !== "PGRST116") throw selErr;

  const roleVal = role ?? "member";

  if (exists) {
    const { error: updErr } = await supabase
      .from("employees")
      .update({ role: roleVal } as any)
      .eq("user_id", userId)
      .eq("org_id", orgId);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supabase
      .from("employees")
      .insert([{ user_id: userId, org_id: orgId, role: roleVal }] as any);
    if (insErr) throw insErr;
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    const supabase = makeClient(env);
    const body = (await request.json().catch(() => ({}))) as Partial<{
      user_id: string;
      org_id: string;
      role: string;
    }>;

    const userId = String(body.user_id || "").trim();
    const orgId = String(body.org_id || "").trim();
    const role = typeof body.role === "string" ? body.role : undefined;

    if (!userId || !orgId) return json({ ok: false, error: "Missing 'user_id' or 'org_id'." }, { status: 400 });

    await ensureEmployee(supabase, userId, orgId, role);
    return json({ ok: true });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || "Unexpected error" }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
