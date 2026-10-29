"use client";

import React, { useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import { dateText, dateTimeText, naira, usd } from "@/lib/money";
import type { Lease, Payment } from "@/lib/types";
import { LockControls } from "./LockControls";
import { statusBadgeClass } from "./Portfolio";

const EXPLORER_BASE = process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet";
const LEASE_CONTRACT_ID = process.env.NEXT_PUBLIC_LEASE_CONTRACT_ID ?? "";

interface LeaseDetailProps {
  api: ApiClient;
  leaseId: string;
  initialLease?: Lease;
  onBack: () => void;
  onRefreshPortfolio: () => void;
}

export function LeaseDetail({ api, leaseId, initialLease, onBack, onRefreshPortfolio }: LeaseDetailProps) {
  const [lease, setLease] = useState<Lease | null>(initialLease ?? null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(!initialLease);
  const [refreshingChain, setRefreshingChain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setError(null);
      try {
        const [l, p] = await Promise.all([api.getLease(leaseId, false), api.payments(leaseId)]);
        if (!active) return;
        setLease(l);
        setPayments(p);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load lease details");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [api, leaseId]);

  async function refreshFromChain() {
    setRefreshingChain(true);
    setError(null);
    try {
      const [fresh, p] = await Promise.all([api.getLease(leaseId, true), api.payments(leaseId)]);
      setLease(fresh);
      setPayments(p);
      onRefreshPortfolio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read chain state");
    } finally {
      setRefreshingChain(false);
    }
  }

  if (loading && !lease) {
    return <p className="py-8 text-sm text-slate-600">Loading lease #{leaseId}...</p>;
  }

  if (!lease) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="text-sm font-semibold text-emerald-800 hover:underline">
          ← Back to portfolio
        </button>
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          {error ?? "Lease not found."}
        </p>
      </div>
    );
  }

  const intervalLabel = lease.terms.intervalSeconds === 86_400 ? "Daily" : "Weekly";
  const graceDays = Math.round(lease.terms.graceSeconds / 86_400);
  const repoWaitDays = Math.round(lease.terms.repossessionWaitSeconds / 86_400);
  const latestTxHash = payments.find((p) => p.txHash)?.txHash;

  return (
    <section aria-label={`Lease ${lease.id} detail`} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
          >
            ← Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">Lease #{lease.id}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(lease.status)}`}>
                {lease.status}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Asset: <span className="capitalize">{lease.asset.type.replace("_", " ")}</span> · Rider:{" "}
              {lease.lessee?.phoneLast4 ? `••••${lease.lessee.phoneLast4}` : "—"}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={refreshingChain}
          onClick={refreshFromChain}
          className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
        >
          {refreshingChain ? "Reading chain..." : "Verify fresh on-chain state"}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {lease.stale && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-950">
          Chain RPC was temporarily unreachable; displaying cached state last updated {dateTimeText(lease.updatedAt)}.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-900">Schedule & Balance Status</h3>
            <div className="mt-3">
              <div className="flex justify-between text-xs font-semibold text-slate-700">
                <span>Ownership progress</span>
                <span>{lease.progressPercent}%</span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-emerald-700" style={{ width: `${lease.progressPercent}%` }} />
              </div>
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Total price</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{naira(lease.terms.totalPrice.naira)}</dd>
                <dd className="text-xs text-slate-500">{usd(lease.terms.totalPrice.token)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Paid to date</dt>
                <dd className="mt-0.5 font-bold text-emerald-900">{naira(lease.balance.paid.naira)}</dd>
                <dd className="text-xs text-slate-500">{usd(lease.balance.paid.token)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Remaining balance</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{naira(lease.balance.remaining.naira)}</dd>
                <dd className="text-xs text-slate-500">{usd(lease.balance.remaining.token)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Installment ({intervalLabel})</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{naira(lease.terms.installment.naira)}</dd>
                <dd className="text-xs text-slate-500">{usd(lease.terms.installment.token)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Arrears</dt>
                <dd className="mt-0.5 font-semibold text-red-800">{naira(lease.balance.arrears.naira)}</dd>
                <dd className="text-xs text-slate-500">{usd(lease.balance.arrears.token)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Next due / Grace</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{lease.nextDue ? dateText(lease.nextDue) : "—"}</dd>
                <dd className="text-xs text-slate-500">
                  Grace: {graceDays}d · Repo wait: {repoWaitDays}d
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-base font-bold text-slate-900">Payment History ({payments.length})</h3>
            </div>
            {payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5">Amount</th>
                      <th className="px-4 py-2.5">Provider</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">On-Chain Explorer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5 text-xs text-slate-700">{dateTimeText(p.settledAt ?? p.createdAt)}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-900">
                          {naira(p.nairaAmount)}
                          {p.excessFlagged && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                              Excess refund flagged
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 capitalize text-slate-700">{p.provider}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              p.status === "settled" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {p.txHash ? (
                            <a
                              href={`${EXPLORER_BASE}/tx/${p.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-emerald-800 underline hover:text-emerald-950"
                            >
                              {p.txHash.slice(0, 10)}…
                            </a>
                          ) : (
                            <span className="text-slate-400">Pending finality</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-900">On-Chain & Device Status</h3>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Contract state</dt>
                <dd className="font-semibold text-slate-900">{lease.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">State source</dt>
                <dd className="font-mono text-xs text-slate-800">{lease.source}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Device ID</dt>
                <dd data-testid="device-id" className="font-mono text-xs text-slate-900">
                  {lease.asset.deviceId ?? "Unassigned"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Device policy state</dt>
                <dd className="text-xs font-semibold text-slate-800">
                  {lease.status === "Defaulted" ? "Lock eligible (safety-checked)" : "Unlocked / Active"}
                </dd>
              </div>
              <div className="pt-2">
                {latestTxHash ? (
                  <a
                    data-testid="explorer-link"
                    href={`${EXPLORER_BASE}/tx/${latestTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                  >
                    View latest transaction on Stellar Explorer ↗
                  </a>
                ) : LEASE_CONTRACT_ID ? (
                  <a
                    data-testid="explorer-link"
                    href={`${EXPLORER_BASE}/contract/${LEASE_CONTRACT_ID}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                  >
                    View lease contract on Stellar Explorer ↗
                  </a>
                ) : (
                  <a
                    data-testid="explorer-link"
                    href={EXPLORER_BASE}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                  >
                    Open Stellar Testnet Explorer ↗
                  </a>
                )}
              </div>
            </dl>
          </div>

          <LockControls
            api={api}
            leaseId={lease.id}
            status={lease.status}
            onActionRecorded={onRefreshPortfolio}
          />
        </div>
      </div>
    </section>
  );
}
