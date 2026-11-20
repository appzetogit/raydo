import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, Building2 } from "lucide-react";
import { franchiseApi } from "../api";
import { errMsg, inputCls, labelCls, btn } from "@food/pages/admin/franchise/finance/ui";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.password) {
      setError("Enter your email and password");
      return;
    }
    setBusy(true);
    try {
      await franchiseApi.login(form.email.trim(), form.password);
      const back = location.state?.from;
      navigate(back && back.startsWith("/franchise") && !back.startsWith("/franchise/login") ? back : "/franchise", { replace: true });
    } catch (err) {
      setError(errMsg(err, "Could not sign in"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-black text-slate-900">Franchise partner login</h1>
          <p className="text-sm text-slate-500 mt-1">Use the email and password Raydo sent you.</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4" noValidate>
          <div>
            <label htmlFor="fr-email" className={labelCls}>Email</label>
            <input id="fr-email" type="email" autoComplete="username" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label htmlFor="fr-password" className={labelCls}>Password</label>
            <div className="relative">
              <input id="fr-password" type={show ? "text" : "password"} autoComplete="current-password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} className={`${inputCls} pr-10`} />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600"
                aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {error && <p className="text-xs font-semibold text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className={`${btn.primary} w-full py-3 text-sm`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
          </button>
        </form>
        <p className="text-center text-xs text-slate-500 mt-4">Forgot your password? Ask Raydo support to issue a new one.</p>
      </div>
    </div>
  );
}
