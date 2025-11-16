import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  // 讓你在 dev / Pages 一眼看到環境變數沒設好
  console.error(
    "[Supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. 請在 .env.* 或 Cloudflare Pages 的 Environment Variables 設定這兩個值。"
  );
  throw new Error("Missing Supabase VITE_* envs");
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "hare-pos-auth"
  }
});
