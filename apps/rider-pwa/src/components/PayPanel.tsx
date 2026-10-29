"use client";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { Lease } from "@/lib/types";
import type { T } from "@/lib/i18n";
import { naira } from "@/lib/format";

interface Props {
  api: Pick<ApiClient, "initiatePayment" | "payments" | "getLease">;
  lease: Lease;
  t: T;
  onClose: () => void;
  /** Called with the fresh lease once the payment has settled. */
  onSettled: (lease: Lease) => void;
  /** Sends the rider to the provider's checkout. Replaced in tests. */
  redirect?: (url: string) => void;
  pollMs?: number;
  timeoutMs?: number;
}

type Phase = "form" | "starting" | "waiting" | "success" | "slow" | "error";

const pendingKey = (leaseId: string) => `mallaka:pending-payment:${leaseId}`;

/**
 * Pay flow. Success is shown ONLY after the API reports the payment as settled
 * (i.e. final on the chain). Until then the rider sees a waiting message.
 */
export function PayPanel({ api, lease, t, onClose, onSettled, redirect, pollMs = 3000, timeoutMs = 120_000 }: Props) {
  const installment = lease.terms.installment.naira;
  const [amount, setAmount] = useState(installment.replace(/\.00$/, ""));
  const [phase, setPhase] = useState<Phase>(() => (sessionStorage.getItem(pendingKey(lease.id)) ? "waiting" : "form"));
  const [badAmount, setBadAmount] = useState(false);
  const [balance, setBalance] = useState("");
  const timer = useRef<ReturnType<typeof setInterval>>();

  // Poll while waiting (also resumes after the rider returns from the provider's page).
  useEffect(() => {
    if (phase !== "waiting") return;
    const raw = sessionStorage.getItem(pendingKey(lease.id));
    const pending = raw ? (JSON.parse(raw) as { settledBefore: number; startedAt: number }) : { settledBefore: 0, startedAt: Date.now() };
    const check = async () => {
      try {
        const list = await api.payments(lease.id);
        if (list.filter((p) => p.status === "settled").length > pending.settledBefore) {
          clearInterval(timer.current);
          sessionStorage.removeItem(pendingKey(lease.id));
          const fresh = await api.getLease(lease.id, true);
          setBalance(naira(fresh.balance.remaining.naira));
          setPhase("success");
          onSettled(fresh);
          return;
        }
      } catch {
        /* keep waiting; a network blip must not show a failure */
      }
      if (Date.now() - pending.startedAt > timeoutMs) {
        clearInterval(timer.current);
        setPhase("slow");
      }
    };
    void check();
    timer.current = setInterval(() => void check(), pollMs);
    return () => clearInterval(timer.current);
  }, [phase, api, lease.id, onSettled, pollMs, timeoutMs]);

  async function start(value: string) {
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) < 100) {
      setBadAmount(true);
      return;
    }
    setBadAmount(false);
    setPhase("starting");
    try {
      const settledBefore = (await api.payments(lease.id)).filter((p) => p.status === "settled").length;
      const res = await api.initiatePayment(lease.id, value);
      sessionStorage.setItem(pendingKey(lease.id), JSON.stringify({ settledBefore, startedAt: Date.now() }));
      setPhase("waiting");
      (redirect ?? ((u: string) => window.location.assign(u)))(res.checkoutUrl);
    } catch {
      setPhase("error");
    }
  }

  return (
    <section role="dialog" aria-label={t("pay.title")} className="space-y-4 rounded-xl border-2 border-gray-900 bg-white p-4">
      <h2 className="text-xl font-bold">{t("pay.title")}</h2>

      {(phase === "form" || phase === "starting" || phase === "error") && (
        <>
          <button
            type="button"
            className="min-h-tap w-full rounded-xl border-2 border-brand px-4 py-3 text-lg font-bold text-brand"
            onClick={() => setAmount(installment.replace(/\.00$/, ""))}
          >
            {t("pay.installment", { amount: naira(installment) })}
          </button>
          <label className="block">
            <span className="font-semibold">{t("pay.amount")}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              className="mt-1 block min-h-tap w-full rounded-lg border-2 border-gray-900 px-3 text-xl"
            />
          </label>
          {badAmount && <p role="alert" className="font-semibold text-red-800">{t("pay.badAmount")}</p>}
          {phase === "error" && <p role="alert" className="font-semibold text-red-800">{t("pay.error")}</p>}
          <button
            type="button"
            disabled={phase === "starting"}
            onClick={() => void start(amount)}
            className="min-h-tap w-full rounded-xl bg-brand px-4 py-3 text-xl font-bold text-white disabled:opacity-60"
          >
            {t("pay.go")}
          </button>
        </>
      )}

      {phase === "waiting" && <p role="status">{t("pay.waiting")}</p>}
      {phase === "slow" && <p role="status">{t("pay.slow")}</p>}
      {phase === "success" && (
        <p role="status" className="text-lg font-bold text-green-900">
          {t("pay.success", { balance })}
        </p>
      )}

      <button type="button" onClick={onClose} className="min-h-tap w-full rounded-xl border-2 border-gray-900 px-4 py-3 text-lg font-semibold">
        {t("pay.cancel")}
      </button>
    </section>
  );
}
