/// <reference types="@cloudflare/workers-types" />
import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export const onRequest = async (ctx: { request: Request; env: Env }) => {
  const admin = createClient(ctx.env.SUPABASE_URL, ctx.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  const ok = !error;
  return new Response(JSON.stringify({ ok, error: error?.message ?? null }), {
    headers: { "content-type": "application/json" }
  });
};
