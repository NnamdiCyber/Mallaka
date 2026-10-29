"use client";

import React from "react";
import { dateText, naira, toCents, usd } from "@/lib/money";
import type { Lease } from "@/lib/types";
import { statusBadgeClass } from "./Portfolio";

interface DelinquencyProps {
  leases: Lease[];
  onSelectLease: (id: string) => void;
}

export function Delinquency({ leases, onSelectLease }: DelinquencyProps) {
  const delinquent = leases
    .filter((l) => l.status === "Grace" || l.status === "Defaulted")
    .sort((a, b) => {
      const diff = toCents(b.balance.arrears.naira) - toCents(a.balance.arrears.naira);
      if (diff !== 0n) return diff > 0n ? 1 : -1;
      return Number(a.id) - Number(b.id);
    });

  return (
    <section aria-label="Delinquency view" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">Grace & Defaulted Leases ({delinquent.length})</h2>
        <p className="text-xs text-slate-600">Sorted highest-to-lowest by overdue arrears.</p>
      </div>

      {delinquent.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">No leases are currently in Grace or Defaulted.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Lease</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Rider</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Arrears</th>
                <th className="px-4 py-3">Remaining Balance</th>
                <th className="px-4 py-3">Grace Ends</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {delinquent.map((lease) => (
                <tr key={lease.id} data-testid={`delinquent-row-${lease.id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">#{lease.id}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(lease.status)}`}>
                      {lease.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {lease.lessee?.phoneLast4 ? `••••${lease.lessee.phoneLast4}` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{lease.asset.deviceId ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-red-800">
                    {naira(lease.balance.arrears.naira)}
                    <span className="ml-1 text-xs font-normal text-slate-500">({usd(lease.balance.arrears.token)})</span>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{naira(lease.balance.remaining.naira)}</td>
                  <td className="px-4 py-3 text-slate-700">{lease.graceEnds ? dateText(lease.graceEnds) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onSelectLease(lease.id)}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
