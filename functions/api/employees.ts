/// <reference types="@cloudflare/workers-types" />
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_API_TOKEN: string;
}


type UpsertBody = {
  empId: string;
  orgId?: string;
  pin?: string;
  displayName?: string;
  role?: "member" | "admin";
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (request.headers.get("x-admin-token") !== env.ADMIN_API_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as UpsertBody;
  if (!body.empId) return new Response("empId required", { status: 400 });

  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 取得 / 建立 Default Org
  let orgId = body.orgId?.trim();
  if (!orgId) {
    const { data: org } = await admin.from("organizations").select("id").eq("name", "Default Org").maybeSingle();
    if (org?.id) orgId = org.id;
    else {
      const { data: ins, error: eIns } = await admin
        .from("organizations")
        .insert({ name: "Default Org" })
        .select("id")
        .single();
      if (eIns) return new Response(eIns.message, { status: 400 });
      orgId = ins.id as string;
    }
  }

  const email = `emp-${String(body.empId).trim()}@enroll.local`;
  let password = (body.pin ?? "").toString().trim();
  if (password.length < 6) {
    password = Math.floor(100000 + Math.random() * 900000).toString();
  }

  const { data: existing } = await admin
    .from("employees")
    .select("user_id")
    .eq("emp_id", body.empId)
    .maybeSingle();

  let userId: string;
  if (existing?.user_id) {
    userId = existing.user_id;
    const { error: eUpd } = await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { empId: body.empId, orgId, displayName: body.displayName }
    });
    if (eUpd) return new Response(eUpd.message, { status: 400 });
  } else {
    const { data: created, error: eCreate } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { empId: body.empId, orgId, displayName: body.displayName }
    });
    if (eCreate) return new Response(eCreate.message, { status: 400 });
    userId = created.user.id;

    const { error: eEmp } = await admin
      .from("employees")
      .insert({ emp_id: body.empId, user_id: userId, org_id: orgId, display_name: body.displayName ?? null });
    if (eEmp) return new Response(eEmp.message, { status: 400 });
  }

  const { error: eMem } = await admin
    .from("memberships")
    .upsert({ user_id: userId, org_id: orgId, role: body.role ?? "member" }, { onConflict: "user_id,org_id" });
  if (eMem) return new Response(eMem.message, { status: 400 });

  return new Response(JSON.stringify({
    ok: true,
    empId: body.empId,
    orgId,
    email,
    userId,
    initialPin: password
  }), { headers: { "Content-Type": "application/json" } });
};
export const onRequest = onRequestPost;
