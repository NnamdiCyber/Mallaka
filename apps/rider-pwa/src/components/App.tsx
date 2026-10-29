"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, ApiError, NetworkError, tokenStore } from "@/lib/api";
import { LOCALES, makeT, type Locale } from "@/lib/i18n";
import { loadSavedLeases, saveLease } from "@/lib/offline";
import type { Lease } from "@/lib/types";
import { HomeScreen } from "./HomeScreen";
import { History } from "./History";
import { Login } from "./Login";
import { PayPanel } from "./PayPanel";
import { Terms } from "./Terms";

type View = "home" | "payments" | "terms";

export function App({ client }: { client?: ApiClient }) {
  const api = useMemo(() => client ?? new ApiClient(), [client]);
  const [locale, setLocale] = useState<Locale>("en");
  const t = useMemo(() => makeT(locale), [locale]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | string>(new Date());
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("home");
  const [paying, setPaying] = useState(false);
  const [activateError, setActivateError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const leases = await api.listLeases();
      setOffline(false);
      const first = leases[0] ?? null;
      if (first) {
        // Ask for a fresh chain read on the lease we show; fall back to the list item.
        const fresh = await api.getLease(first.id).catch(() => first);
        saveLease(fresh);
        setLease(fresh);
        setLastUpdated(new Date());
      } else setLease(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        tokenStore.clear();
        setAuthed(false);
      } else if (err instanceof NetworkError) {
        // Offline: show what we last saved, clearly labelled.
        const saved = loadSavedLeases()[0];
        setOffline(true);
        if (saved) {
          setLease(saved.lease);
          setLastUpdated(saved.savedAt);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const has = tokenStore.get() !== null;
    setAuthed(has);
    if (has) void load();
    else setLoading(false);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, [load]);

  async function activate() {
    if (!lease) return;
    setActivateError(false);
    try {
      const updated = await api.activate(lease.id);
      saveLease(updated);
      setLease(updated);
      setLastUpdated(new Date());
    } catch {
      setActivateError(true);
    }
  }

  const nav = "min-h-tap flex-1 px-2 py-2 font-bold";
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="text-2xl font-extrabold text-brand">{t("app.name")}</span>
        <label className="text-sm">
          <span className="sr-only">{t("nav.language")}</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="min-h-tap rounded-lg border-2 border-gray-900 bg-white px-2"
            aria-label={t("nav.language")}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}{l.ready ? "" : " *"}</option>
            ))}
          </select>
        </label>
      </header>
      {locale !== "en" && <p className="text-sm text-gray-800">{t("language.review")}</p>}

      {authed === false && (
        <Login
          api={api}
          t={t}
          onLoggedIn={(token) => {
            tokenStore.set(token);
            setAuthed(true);
            void load();
          }}
        />
      )}

      {authed && loading && <p role="status">{t("home.loading")}</p>}
      {authed && !loading && !lease && <p>{t("home.noLease")}</p>}

      {authed && lease && (
        <>
          <nav aria-label="Main" className="flex overflow-hidden rounded-xl border-2 border-gray-900">
            {(["home", "payments", "terms"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-current={view === v ? "page" : undefined}
                onClick={() => setView(v)}
                className={`${nav} ${view === v ? "bg-brand text-white" : "bg-white text-gray-900"}`}
              >
                {t(v === "home" ? "nav.home" : v === "payments" ? "nav.payments" : "nav.terms")}
              </button>
            ))}
          </nav>

          {view === "home" && !paying && (
            <HomeScreen lease={lease} t={t} lastUpdated={lastUpdated} offline={offline} onPay={() => setPaying(true)} onActivate={() => void activate()} activateError={activateError} />
          )}
          {view === "home" && paying && (
            <PayPanel
              api={api}
              lease={lease}
              t={t}
              onClose={() => setPaying(false)}
              onSettled={(fresh) => {
                saveLease(fresh);
                setLease(fresh);
                setLastUpdated(new Date());
              }}
            />
          )}
          {view === "payments" && <History api={api} leaseId={lease.id} t={t} />}
          {view === "terms" && <Terms lease={lease} t={t} />}

          <button
            type="button"
            className="min-h-tap w-full rounded-xl border-2 border-gray-900 px-4 py-2 font-semibold"
            onClick={() => {
              tokenStore.clear();
              setAuthed(false);
              setLease(null);
            }}
          >
            {t("nav.logout")}
          </button>
        </>
      )}
    </main>
  );
}
