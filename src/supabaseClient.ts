// src/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

/**
 * 對於使用 Vite 建置的前端，必須使用「VITE_」前綴的環境變數，
 * 例如：VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY
 * 這些值會在「建置時」被寫死進 bundle。
 */
const SUPABASE_URL = import.meta?.env?.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta?.env?.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // 在本地與雲端都給出明確錯誤，避免無 key 的請求打到 REST
  const msg =
    "[supabaseClient] Missing env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
    "請在 Cloudflare Pages 專案設定或本機 .env 中補上（注意要有 VITE_ 前綴）。";
  console.error(msg, { SUPABASE_URL, hasKey: !!SUPABASE_ANON_KEY });
  throw new Error(msg);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  // 可選：避免代理或 CDN 造成的推論問題
  global: {
    headers: {
      // 這不是必需，但可用於除錯辨識
      "x-client-info": "hare-admin-pwa",
    },
  },
});
