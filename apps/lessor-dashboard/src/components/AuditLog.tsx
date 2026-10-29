"use client";

import React from "react";
import { dateTimeText } from "@/lib/money";
import type { AuditEntry } from "@/lib/types";

interface AuditLogProps {
  entries: AuditEntry[];
}

export function AuditLog({ entries }: AuditLogProps) {
  return (
    <section aria-label="Audit log" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold text-slate-900">Audit Log (Read-Only)</h2>
        <p className="text-xs text-slate-600">Append-only record of lease and lock actions ({entries.length} entries).</p>
      </div>

      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">No audit entries recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{dateTimeText(entry.createdAt)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-800">{entry.actor}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{entry.action}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{entry.resource}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{JSON.stringify(entry.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
