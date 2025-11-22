// src/services/deliveryShortcuts.ts
// 簡單的本地持久化（localStorage）。之後若要改成 DB，也只需改這支 service。

export type DeliveryShortcut = {
  id: string;
  label: string; // 顯示名稱 / 收件者名稱
  fee: number;   // 運費（MOP）
};

const LS_KEY = "hare_delivery_shortcuts_v1";

// 產生隨機 ID
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // @ts-ignore
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// 讀取快捷鍵；如無資料回傳空陣列
export async function loadDeliveryShortcuts(): Promise<DeliveryShortcut[]> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as DeliveryShortcut[];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        id: String((x as any).id ?? newId()),
        label: String((x as any).label ?? ""),
        fee: Number((x as any).fee ?? 0) || 0,
      }))
      .filter((x) => x.label.trim().length > 0);
  } catch {
    return [];
  }
}

// 儲存快捷鍵（會覆蓋整份清單）
export async function saveDeliveryShortcuts(list: DeliveryShortcut[]): Promise<void> {
  const cleaned = (Array.isArray(list) ? list : [])
    .map((x) => ({
      id: String((x as any).id ?? newId()),
      label: String((x as any).label ?? "").trim(),
      fee: Number((x as any).fee ?? 0) || 0,
    }))
    .filter((x) => x.label.length > 0);

  localStorage.setItem(LS_KEY, JSON.stringify(cleaned));
}
