// functions/api/superadmin.ts
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPERADMIN_TOKEN?: string;
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function makeServiceClient(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function requireAdminToken(req: Request, env: Env) {
  const hdr = req.headers.get("authorization") || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;
  return !!env.SUPERADMIN_TOKEN && token === env.SUPERADMIN_TOKEN;
}

async function ensureEmployee(supabase: any, userId: string, orgId: string, role: string) {
  const { data: exists, error: selErr } = await supabase
    .from("employees")
    .select("user_id,org_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (selErr && (selErr as any).code !== "PGRST116") throw selErr;

  if (exists) {
    const { error: updErr } = await supabase.from("employees").update({ role } as any).eq("user_id", userId).eq("org_id", orgId);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supabase.from("employees").insert([{ user_id: userId, org_id: orgId, role }] as any);
    if (insErr) throw insErr;
  }
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  if (!requireAdminToken(request, env)) return json(401, { ok: false, error: "Unauthorized" });

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

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!requireAdminToken(request, env)) return json(401, { ok: false, error: "Unauthorized" });

  const supabase = makeServiceClient(env);
  const body = (await request.json().catch(() => ({}))) as Partial<{ action: "remove"; user_id: string; org_id: string; role: string }>;
  const userId = String(body.user_id || "").trim();
  const orgId = String(body.org_id || "").trim();
  if (!userId || !orgId) return json(400, { ok: false, error: "Missing user_id or org_id" });

  if (body.action === "remove") {
    const { error } = await supabase.from("employees").delete().eq("user_id", userId).eq("org_id", orgId);
    if (error) return json(500, { ok: false, error: String(error.message || error) });
    return json(200, { ok: true, removed: { user_id: userId, org_id: orgId } });
  }

  const role = String(body.role ?? "member").trim();
  try {
    await ensureEmployee(supabase, userId, orgId, role);
    return json(200, { ok: true, user_id: userId, org_id: orgId, role });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
};
