"use client";

import React, { useState } from "react";
import { dateText, naira, sumMoney, usd } from "@/lib/money";
import type { Lease, LeaseStatus } from "@/lib/types";

const STATUS_BADGE: Record<LeaseStatus, string> = {
  Pending: "bg-slate-100 text-slate-800",
  Active: "bg-emerald-100 text-emerald-900",
  Grace: "bg-amber-100 text-amber-900",
  Defaulted: "bg-red-100 text-red-900",
  Completed: "bg-blue-100 text-blue-900",
  Repossessed: "bg-purple-100 text-purple-900",
  Cancelled: "bg-slate-200 text-slate-700",
};

const PORTFOLIO_STATUSES: Array<"All" | LeaseStatus> = ["All", "Active", "Grace", "Defaulted", "Completed", "Pending"];

export function statusBadgeClass(status: LeaseStatus): string {
  return STATUS_BADGE[status] ?? "bg-slate-100 text-slate-800";
}

interface PortfolioProps {
  leases: Lease[];
  onSelectLease: (id: string) => void;
}

export function Portfolio({ leases, onSelectLease }: PortfolioProps) {
  const [filter, setFilter] = useState<"All" | LeaseStatus>("All");

  const countBy = (s: LeaseStatus) => leases.filter((l) => l.status === s).length;
  const totalCollectedNaira = sumMoney(leases.map((l) => l.balance.paid.naira));
  const totalCollectedToken = sumMoney(leases.map((l) => l.balance.paid.token));
  const totalOutstandingNaira = sumMoney(leases.map((l) => l.balance.remaining.naira));
  const totalOutstandingToken = sumMoney(leases.map((l) => l.balance.remaining.token));

  const soonestLease = leases
    .filter((l): l is Lease & { nextDue: number } => typeof l.nextDue === "number" && l.nextDue > 0)
    .sort((a, b) => a.nextDue - b.nextDue)[0];

  const visible = filter === "All" ? leases : leases.filter((l) => l.status === filter);

  return (
    <section aria-label="Portfolio overview" className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status Breakdown</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between rounded bg-emerald-50 px-2.5 py-1.5">
              <dt className="font-medium text-emerald-900">Active</dt>
              <dd data-testid="count-Active" className="font-bold text-emerald-950">{countBy("Active")}</dd>
            </div>
            <div className="flex justify-between rounded bg-amber-50 px-2.5 py-1.5">
              <dt className="font-medium text-amber-900">Grace</dt>
              <dd data-testid="count-Grace" className="font-bold text-amber-950">{countBy("Grace")}</dd>
            </div>
            <div className="flex justify-between rounded bg-red-50 px-2.5 py-1.5">
              <dt className="font-medium text-red-900">Defaulted</dt>
              <dd data-testid="count-Defaulted" className="font-bold text-red-950">{countBy("Defaulted")}</dd>
            </div>
            <div className="flex justify-between rounded bg-blue-50 px-2.5 py-1.5">
              <dt className="font-medium text-blue-900">Completed</dt>
              <dd data-testid="count-Completed" className="font-bold text-blue-950">{countBy("Completed")}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Collected</p>
          <p data-testid="total-collected" className="mt-2 text-2xl font-bold text-slate-900">
            {naira(totalCollectedNaira)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{usd(totalCollectedToken)} settlement value</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Outstanding</p>
          <p data-testid="total-outstanding" className="mt-2 text-2xl font-bold text-slate-900">
            {naira(totalOutstandingNaira)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{usd(totalOutstandingToken)} settlement value</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Due Soonest</p>
          {soonestLease ? (
            <div data-testid="next-due-soonest" className="mt-2">
              <p className="text-lg font-bold text-slate-900">{dateText(soonestLease.nextDue)}</p>
              <button
                type="button"
                onClick={() => onSelectLease(soonestLease.id)}
                className="mt-1 text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
              >
                Lease #{soonestLease.id} ({soonestLease.asset.type})
              </button>
            </div>
          ) : (
            <p data-testid="next-due-soonest" className="mt-2 text-sm text-slate-500">
              No upcoming due dates
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">Leases ({visible.length})</h2>
          <div role="tablist" aria-label="Filter leases by status" className="flex flex-wrap gap-1.5">
            {PORTFOLIO_STATUSES.map((status) => (
              <button
                key={status}
                role="tab"
                type="button"
                aria-selected={filter === status}
                onClick={() => setFilter(status)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  filter === status ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No leases match this status.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Lease</th>
                  <th className="px-4 py-3">Asset & Device</th>
                  <th className="px-4 py-3">Rider</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Remaining</th>
                  <th className="px-4 py-3">Next Due</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((lease) => (
                  <tr key={lease.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">#{lease.id}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="capitalize">{lease.asset.type.replace("_", " ")}</span>
                      {lease.asset.deviceId && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                          {lease.asset.deviceId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {lease.lessee?.phoneLast4 ? `••••${lease.lessee.phoneLast4}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(lease.status)}`}>
                        {lease.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{naira(lease.balance.paid.naira)}</td>
                    <td className="px-4 py-3 text-slate-800">{naira(lease.balance.remaining.naira)}</td>
                    <td className="px-4 py-3 text-slate-700">{lease.nextDue ? dateText(lease.nextDue) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectLease(lease.id)}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
