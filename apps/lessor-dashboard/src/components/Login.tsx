"use client";

import React, { useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { Role } from "@/lib/types";

interface LoginProps {
  api: ApiClient;
  onAuthenticated: (token: string, role: Role) => void;
}

export function Login({ api, onAuthenticated }: LoginProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.requestOtp(phone.trim());
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send verification code");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.verifyOtp(phone.trim(), code.trim());
      if (res.role !== "lessor_staff" && res.role !== "admin") {
        setError("This dashboard is restricted to lessor staff and administrators.");
        return;
      }
      onAuthenticated(res.token, res.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid verification code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Mallaka Operations</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Lessor Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">Sign in with your staff or administrator phone number.</p>

        {error && (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === "phone" ? (
          <form onSubmit={handleRequestOtp} className="mt-6 space-y-4">
            <div>
              <label htmlFor="staff-phone" className="block text-sm font-medium text-slate-800">
                Phone number (E.164)
              </label>
              <input
                id="staff-phone"
                type="tel"
                required
                placeholder="+2348012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 focus:border-emerald-700 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
            >
              {busy ? "Sending code..." : "Send verification code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="mt-6 space-y-4">
            <div>
              <label htmlFor="staff-otp" className="block text-sm font-medium text-slate-800">
                6-digit verification code
              </label>
              <input
                id="staff-otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 tracking-widest text-slate-900 focus:border-emerald-700 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
            >
              {busy ? "Verifying..." : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setError(null);
              }}
              className="w-full text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Use a different phone number
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
