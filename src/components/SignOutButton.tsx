// src/components/SignOutButton.tsx
import React from "react";
import { supabase } from "../supabaseClient";

export default function SignOutButton({ className = "" }: { className?: string }) {
  const handleClick = async () => {
    try {
      await supabase.auth.signOut(); // 清除 supabase session
    } finally {
      // 雙保險：把 sb- 前綴的 token 從 localStorage 刪掉
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("sb-")) localStorage.removeItem(k);
        }
      } catch {}
      // 回到首頁 → AuthGate 會顯示 Login（因為沒有 session）
      location.replace("/");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Sign out"
      className={[
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg",
        "text-gray-800 hover:bg-gray-100 active:bg-gray-200",
        className,
      ].join(" ")}
      style={{ colorScheme: "light" }} // 避免 iOS 自動暗色反轉
    >
      <span className="text-lg w-6 shrink-0">↪</span>
      <span className="truncate hidden md:inline-block md:group-[.sidebar]:hover:inline-block">
        Sign out
      </span>
      <span className="md:hidden">Sign out</span>
    </button>
  );
}
