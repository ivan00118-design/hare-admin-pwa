// src/components/PosButton.tsx
import React from "react";

type Variant = "red" | "black" | "tab" | "confirm";

export interface PosButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** 只給 tab 按鈕使用（呈現選中狀態） */
  selected?: boolean;
  className?: string;
}

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

export default function PosButton({
  variant = "black",
  selected = false,
  className = "",
  children,
  ...props
}: PosButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-lg font-semibold transition-colors " +
    "focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none";
  const size = "px-4 py-2";

  const styles: Record<Variant, string> = {
    red:   "bg-[#dc2626] text-white hover:bg-[#ef4444] focus:ring-[#dc2626] border border-transparent",
    black: "bg-black text-white hover:bg-black/90 focus:ring-black border border-transparent",
    tab:   selected
           ? "bg-[#dc2626] text-white hover:bg-[#ef4444] focus:ring-[#dc2626] border border-transparent"
           : "bg-white text-black border border-neutral-300 hover:bg-neutral-50 focus:ring-black",
    // 永遠白底黑字（避免 iOS 自動暗色）
    confirm: "bg-white text-black border border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100 focus:ring-black",
  };

  // variant=confirm 強制 light 色彩配置，避免系統暗色影響
  const forceLight: React.CSSProperties | undefined =
    variant === "confirm" ? { colorScheme: "light" } : undefined;

  return (
    <button
      type="button"
      className={cx(base, size, styles[variant] || styles.black, className)}
      style={forceLight}
      {...props}
    >
      {children}
    </button>
  );
}
