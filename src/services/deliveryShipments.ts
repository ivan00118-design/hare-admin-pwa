// src/services/deliveryShipments.ts
import { supabase } from "../supabaseClient";

export type DeliveryShipment = {
  id: string;               // 本清單用的 uid
  orderId: string;          // 對應下單後回傳的 order id
  createdAt: string;        // ISO
  customerName: string;
  total: number;            // 含運費
  fee: number;
  status: "pending" | "closed";
  note?: string | null;
};

const APP_KEY = "delivery_shipments_v1";

async function getOrgId(): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("employees")
    .select("org_id")
    .eq("user_id", uid)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.org_id) throw new Error("No organization bound to this user");
  return data.org_id as string;
}

export async function loadDeliveryShipments(): Promise<DeliveryShipment[]> {
  const org = await getOrgId();
  const { data, error } = await supabase
    .from("app_state")
    .select("state")
    .eq("org_id", org)
    .eq("key", APP_KEY)
    .maybeSingle();
  if (error && (error as any).code !== "PGRST116") throw error;
  return ((data?.state as any) ?? []) as DeliveryShipment[];
}

export async function saveDeliveryShipments(list: DeliveryShipment[]) {
  const org = await getOrgId();
  const { error } = await supabase
    .from("app_state")
    .upsert([{ org_id: org, key: APP_KEY, state: list }], { onConflict: "org_id,key" });
  if (error) throw error;
}
