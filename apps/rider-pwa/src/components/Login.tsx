"use client";
import { useState } from "react";
import type { ApiClient } from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { T } from "@/lib/i18n";

export function Login({ api, t, onLoggedIn }: { api: Pick<ApiClient, "requestOtp" | "verifyOtp">; t: T; onLoggedIn: (token: string) => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<"bad" | "many" | "other" | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.requestOtp(phone.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "many" : "other");
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.verifyOtp(phone.trim(), code.trim());
      onLoggedIn(res.token);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "many" : "bad");
    }
  }

  const input = "mt-1 block min-h-tap w-full rounded-lg border-2 border-gray-900 px-3 text-xl";
  const button = "min-h-tap w-full rounded-xl bg-brand px-4 py-3 text-xl font-bold text-white hover:bg-brand-dark";
  return (
    <form onSubmit={sent ? verify : send} className="space-y-4" aria-label={t("login.title")}>
      <h1 className="text-2xl font-extrabold">{t("login.title")}</h1>
      <label className="block">
        <span className="font-semibold">{t("login.phone")}</span>
        <input type="tel" autoComplete="tel" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} className={input} aria-describedby="phone-hint" />
        <span id="phone-hint" className="text-sm text-gray-700">{t("login.phoneHint")}</span>
      </label>
      {sent && (
        <>
          <p role="status">{t("login.codeSent")}</p>
          <label className="block">
            <span className="font-semibold">{t("login.code")}</span>
            <input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={input} />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="font-semibold text-red-800">
          {error === "many" ? t("login.tooMany") : error === "bad" ? t("login.badCode") : t("common.error")}
        </p>
      )}
      <button type="submit" className={button}>
        {sent ? t("login.verify") : t("login.sendCode")}
      </button>
    </form>
  );
}
