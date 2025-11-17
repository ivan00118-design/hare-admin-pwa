// 安全版 upsert：先查 → 有就 update，沒有就 insert（完全不使用 on_conflict）
async function ensureEmployee(
  supabase: any,
  userId: string,
  orgId: string,
  role?: string | null
) {
  const { data: exists, error: selErr } = await supabase
    .from("employees")
    .select("user_id,org_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();

  // PGRST116: Row not found（非錯誤）；其它才丟出
  if (selErr && (selErr as any).code !== "PGRST116") throw selErr;

  const roleVal = role ?? "member";

  if (exists) {
    const { error: updErr } = await supabase
      .from("employees")
      .update({ role: roleVal })
      .eq("user_id", userId)
      .eq("org_id", orgId);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supabase
      .from("employees")
      .insert([{ user_id: userId, org_id: orgId, role: roleVal }]);
    if (insErr) throw insErr;
  }
}
