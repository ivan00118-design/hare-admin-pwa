/// <reference types="@cloudflare/workers-types" />
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_API_TOKEN: string;
}


type SuperadminBody = { empId: string; enable: boolean };

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  const adminToken = request.headers.get("x-admin-token");
  if (adminToken !== env.ADMIN_API_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 解析 JSON 並做型別斷言
  const body = (await request.json()) as SuperadminBody;
  if (!body?.empId || typeof body.enable !== "boolean") {
    return new Response("empId and enable required", { status: 400 });
  }

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: emp, error: e0 } = await admin
    .from("employees")
    .select("user_id")
    .eq("emp_id", body.empId)
    .single();

  if (e0 || !emp) return new Response("employee not found", { status: 404 });

  if (body.enable) {
    const { error } = await admin
      .from("app_roles")
      .upsert({ user_id: emp.user_id, role: "superadmin" });
    if (error) return new Response(error.message, { status: 400 });
  } else {
    const { error } = await admin
      .from("app_roles")
      .delete()
      .eq("user_id", emp.user_id);
    if (error) return new Response(error.message, { status: 400 });
  }

  return new Response(JSON.stringify({ ok: true, empId: body.empId, superadmin: body.enable }), {
    headers: { "Content-Type": "application/json" }
  });
};
export const onRequest = onRequestPost;
