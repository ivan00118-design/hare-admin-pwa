// src/auth/AuthGate.tsx
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import Login from "./Login";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => {
      if (!mounted) return;
      setSession(s ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!ready) return null;         // 可換成 Loading 畫面
  if (!session) return <Login />;  // 未登入 → 顯示登入頁
  return <>{children}</>;
}
