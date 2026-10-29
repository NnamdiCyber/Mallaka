"use client";

import React, { useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { CommandResult, LeaseStatus } from "@/lib/types";

interface LockControlsProps {
  api: ApiClient;
  leaseId: string;
  status: LeaseStatus;
  onActionRecorded?: () => void;
}

export function LockControls({ api, leaseId, status, onActionRecorded }: LockControlsProps) {
  const [reason, setReason] = useState("");
  const [approvalIdInput, setApprovalIdInput] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reasonValid = reason.trim().length >= 10;

  async function submitLock(approvalId?: string) {
    if (!reasonValid) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.lock(leaseId, reason.trim(), approvalId?.trim() || undefined);
      setResult(res);
      if (res.status === "approval_required" && res.approvalId) {
        setApprovalIdInput(res.approvalId);
      }
      onActionRecorded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lock request failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitUnlock() {
    if (!reasonValid) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.unlock(leaseId, reason.trim());
      setResult(res);
      onActionRecorded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-bold text-slate-900">Manual Lock & Unlock Controls</h3>
      <p className="mt-1 text-xs text-slate-600">
        Enforcement follows contract state and mandatory safety rules (README sections 11 & 19).
      </p>

      <ul className="mt-3 list-disc space-y-1 rounded-lg bg-slate-50 py-2.5 pl-7 pr-3 text-xs text-slate-700">
        <li>Never immobilize a moving vehicle: lock engages only when stationary with engine off.</li>
        <li>Notify first: rider must have received Grace entry and pre-lock SMS notices.</li>
        <li>Fail open: if on-chain Defaulted state cannot be verified, no lock is issued.</li>
        <li>Above the balance threshold, a second staff member or admin must approve a manual lock.</li>
        <li>Unlock never requires a second approver and releases immediately on payment.</li>
      </ul>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div
          role="status"
          data-testid="lock-command-result"
          className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${
            result.status === "approval_required"
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-emerald-300 bg-emerald-50 text-emerald-950"
          }`}
        >
          <p className="font-semibold">{result.message}</p>
          {result.approvalId && (
            <p className="mt-1 text-xs">
              Approval ID for second approver:{" "}
              <code data-testid="pending-approval-id" className="rounded bg-white px-1.5 py-0.5 font-mono font-bold">
                {result.approvalId}
              </code>
            </p>
          )}
          {result.commandId && (
            <p className="mt-1 text-xs">
              Command ID: <code className="font-mono">{result.commandId}</code>
            </p>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="lock-reason" className="block text-xs font-medium text-slate-700">
            Reason for audit log (minimum 10 characters)
          </label>
          <textarea
            id="lock-reason"
            rows={2}
            placeholder="e.g. Lease defaulted after grace window; rider contacted by phone."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!reasonValid || busy || status !== "Defaulted"}
            onClick={() => submitLock()}
            className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            Request Manual Lock
          </button>
          <button
            type="button"
            disabled={!reasonValid || busy}
            onClick={submitUnlock}
            className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            Manual Unlock
          </button>
        </div>
        {status !== "Defaulted" && (
          <p className="text-xs text-slate-500">Manual lock is disabled because on-chain status is {status} (must be Defaulted).</p>
        )}

        <div className="border-t border-slate-200 pt-3">
          <label htmlFor="approval-id-input" className="block text-xs font-medium text-slate-700">
            Second-person lock approval (different staff/admin enters Approval ID)
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="approval-id-input"
              type="text"
              placeholder="UUID from first requester"
              value={approvalIdInput}
              onChange={(e) => setApprovalIdInput(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
            />
            <button
              type="button"
              disabled={!reasonValid || !approvalIdInput.trim() || busy || status !== "Defaulted"}
              onClick={() => submitLock(approvalIdInput)}
              className="rounded-lg border border-amber-700 bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Approve Lock
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
