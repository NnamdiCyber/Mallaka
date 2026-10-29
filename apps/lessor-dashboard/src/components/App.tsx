"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, ApiError, session } from "@/lib/api";
import type { AuditEntry, Lease, Role } from "@/lib/types";
import { AuditLog } from "./AuditLog";
import { CreateLeaseForm } from "./CreateLeaseForm";
import { Delinquency } from "./Delinquency";
import { LeaseDetail } from "./LeaseDetail";
import { Login } from "./Login";
import { Portfolio } from "./Portfolio";

type Tab = "portfolio" | "delinquency" | "create" | "audit";

interface AppProps {
  client?: ApiClient;
}

export function App({ client }: AppProps) {
  const api = useMemo(() => client ?? new ApiClient(), [client]);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);

  const [tab, setTab] = useState<Tab>("portfolio");
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = session.token();
    const savedRole = session.role();
    if (savedToken && (savedRole === "lessor_staff" || savedRole === "admin")) {
      setToken(savedToken);
      setRole(savedRole);
    } else if (savedToken) {
      session.clear();
    }
    setReady(true);
  }, []);

  const signOut = useCallback(() => {
    session.clear();
    setToken(null);
    setRole(null);
    setLeases([]);
    setAuditEntries([]);
    setSelectedLeaseId(null);
  }, []);

  const loadPortfolio = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [leaseRows, logRows] = await Promise.all([api.listLeases(), api.auditLog(50)]);
      setLeases(leaseRows);
      setAuditEntries(logRows);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        signOut();
        return;
      }
      setError(err instanceof Error ? err.message : "Could not load portfolio");
    } finally {
      setLoading(false);
    }
  }, [api, signOut, token]);

  useEffect(() => {
    if (token) {
      void loadPortfolio();
    }
  }, [token, loadPortfolio]);

  if (!ready) return null;

  if (!token || (role !== "lessor_staff" && role !== "admin")) {
    return (
      <Login
        api={api}
        onAuthenticated={(newToken, newRole) => {
          session.set(newToken, newRole);
          setToken(newToken);
          setRole(newRole);
        }}
      />
    );
  }

  const navItems: Array<{ id: Tab; label: string }> = [
    { id: "portfolio", label: "Portfolio" },
    { id: "delinquency", label: "Delinquency" },
    { id: "create", label: "Create Lease" },
    { id: "audit", label: "Audit Log" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Mallaka Lessor Console</p>
            <h1 className="text-lg font-bold text-slate-900">Portfolio & Enforcement</h1>
          </div>

          <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedLeaseId(null);
                  setTab(item.id);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  !selectedLeaseId && tab === item.id
                    ? "bg-emerald-800 text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              Role: {role}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && leases.length === 0 ? (
          <p className="py-8 text-sm text-slate-600">Loading portfolio...</p>
        ) : selectedLeaseId ? (
          <LeaseDetail
            api={api}
            leaseId={selectedLeaseId}
            initialLease={leases.find((l) => l.id === selectedLeaseId)}
            onBack={() => setSelectedLeaseId(null)}
            onRefreshPortfolio={() => void loadPortfolio()}
          />
        ) : tab === "portfolio" ? (
          <Portfolio leases={leases} onSelectLease={(id) => setSelectedLeaseId(id)} />
        ) : tab === "delinquency" ? (
          <Delinquency leases={leases} onSelectLease={(id) => setSelectedLeaseId(id)} />
        ) : tab === "create" ? (
          <CreateLeaseForm
            api={api}
            onCreated={(created) => {
              setLeases((prev) => [created, ...prev]);
              setTab("portfolio");
              setSelectedLeaseId(created.id);
              void loadPortfolio();
            }}
          />
        ) : (
          <AuditLog entries={auditEntries} />
        )}
      </main>
    </div>
  );
}
