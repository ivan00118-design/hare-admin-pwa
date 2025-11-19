// src/auth/Login.tsx
import { useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { supabase } from "../supabaseClient";

const FAKE_DOMAIN = import.meta.env.VITE_FAKE_EMAIL_DOMAIN ?? "enroll.local";

export default function Login() {
  const [empId, setEmpId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const email = `emp-${empId.trim()}@${FAKE_DOMAIN}`;
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: pin
      });
      if (error) throw error;
      // 登入成功，重新載入（或用路由導回首頁）
      location.replace("/");
    } catch (e: any) {
      setErr(e?.message ?? "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{minHeight:"100vh", display:"grid", placeItems:"center"}}>
      <form onSubmit={onSubmit} style={{width:320, padding:24, border:"1px solid #e5e7eb", borderRadius:12, background:"#fff"}}>
        <h2 style={{marginBottom:16}}>Sign in</h2>
        <label style={{display:"block", fontSize:12, color:"#6b7280"}}>Employee ID</label>
        <input
          value={empId}
          onChange={(e)=>setEmpId(e.target.value)}
          placeholder="例如：hare"
          autoFocus
          required
          style={{width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:8, marginBottom:12}}
        />
        <label style={{display:"block", fontSize:12, color:"#6b7280"}}>PIN</label>
        <input
          value={pin}
          onChange={(e)=>setPin(e.target.value)}
          type="password"
          placeholder="至少 6 碼"
          required
          style={{width:"100%", padding:"8px 10px", border:"1px solid #d1d5db", borderRadius:8, marginBottom:12}}
        />
        {err && <div style={{color:"#b91c1c", fontSize:12, marginBottom:8}}>{err}</div>}
        <button disabled={loading} type="submit" style={{width:"100%", padding:"10px 12px", borderRadius:8, background:"#16a34a", color:"#fff"}}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <p style={{fontSize:12, color:"#6b7280", marginTop:8}}>
        </p>
      </form>
    </div>
  );
}
