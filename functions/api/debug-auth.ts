// functions/api/debug-auth.ts
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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

export const onRequestGet = async ({ request, env }: CfCtx<Env>) => {
  const supabase = makeServiceClient(env);
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id") || undefined;
  const orgId = url.searchParams.get("org_id") || undefined;

  const out: any = {
    ok: true,
    env: {
      hasUrl: !!env.SUPABASE_URL,
      hasServiceRole: !!env.SUPABASE_SERVICE_ROLE_KEY,
    },
    checks: {},
  };

  // 基本 DB 連線健康檢查（隨便抓一筆 employees）
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("user_id, org_id, role")
      .limit(1);
    out.checks.employeesHead = error
      ? { ok: false, error: String(error.message || error) }
      : { ok: true, sample: (data && data[0]) || null };
  } catch (e: any) {
    out.checks.employeesHead = { ok: false, error: String(e?.message || e) };
  }

  // 依 user_id 查詢
  if (userId) {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("user_id, org_id, role")
        .eq("user_id", userId);
      out.employeesOfUser = error
        ? { ok: false, error: String(error.message || error) }
        : { ok: true, rows: data || [] };
    } catch (e: any) {
      out.employeesOfUser = { ok: false, error: String(e?.message || e) };
    }
  }

  // 依 org_id 查詢
  if (orgId) {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select("user_id, org_id, role")
        .eq("org_id", orgId);
      out.employeesOfOrg = error
        ? { ok: false, error: String(error.message || error) }
        : { ok: true, rows: data || [] };
    } catch (e: any) {
      out.employeesOfOrg = { ok: false, error: String(e?.message || e) };
    }
  }

  return json(200, out);
};
