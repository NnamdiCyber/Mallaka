import type { Lease } from "@/lib/types";
import type { T } from "@/lib/i18n";
import { dateText, dateTimeText, naira } from "@/lib/format";

interface Props {
  lease: Lease;
  t: T;
  /** When this information was last fetched (or saved, when offline). */
  lastUpdated: Date | string;
  offline: boolean;
  onPay: () => void;
  onActivate?: () => void;
  activateError?: boolean;
}

/** Calm, non-threatening banner for Grace, Defaulted and the other special states. */
function StatusBanner({ lease, t }: { lease: Lease; t: T }) {
  const installment = naira(lease.terms.installment.naira);
  switch (lease.status) {
    case "Grace":
      return (
        <Banner tone="amber" title={t("banner.grace.title")}>
          {t("banner.grace.body", {
            amount: installment,
            due: lease.nextDue ? dateText(lease.nextDue) : "",
            graceEnds: lease.graceEnds ? dateText(lease.graceEnds) : "",
          })}
        </Banner>
      );
    case "Defaulted":
      return (
        <Banner tone="amber" title={t("banner.defaulted.title")}>
          {t("banner.defaulted.body", { arrears: naira(lease.balance.arrears.naira) })}
        </Banner>
      );
    case "Completed":
      return (
        <Banner tone="green" title={t("banner.completed.title")}>
          {t("banner.completed.body")}
        </Banner>
      );
    case "Pending":
      return (
        <Banner tone="blue" title={t("banner.pending.title")}>
          {t("banner.pending.body")}
        </Banner>
      );
    case "Repossessed":
    case "Cancelled":
      return (
        <Banner tone="gray" title={t("banner.ended.title")}>
          {t("banner.ended.body")}
        </Banner>
      );
    default:
      return null;
  }
}

const TONES = {
  amber: "border-amber-700 bg-amber-50 text-amber-950",
  green: "border-green-800 bg-green-50 text-green-950",
  blue: "border-blue-800 bg-blue-50 text-blue-950",
  gray: "border-gray-700 bg-gray-100 text-gray-950",
} as const;

function Banner({ tone, title, children }: { tone: keyof typeof TONES; title: string; children: React.ReactNode }) {
  return (
    <section role="status" aria-label={title} className={`rounded-xl border-2 p-4 ${TONES[tone]}`}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1">{children}</p>
    </section>
  );
}

export function HomeScreen({ lease, t, lastUpdated, offline, onPay, onActivate, activateError }: Props) {
  const canPay = ["Active", "Grace", "Defaulted"].includes(lease.status);
  const pct = lease.progressPercent;
  return (
    <div className="space-y-4">
      {offline && (
        <p role="status" className="rounded-lg bg-gray-900 p-3 text-white">
          {t("home.offline")}
        </p>
      )}
      {!offline && lease.stale && (
        <p role="status" className="rounded-lg bg-gray-100 p-3 text-gray-900">
          {t("home.stale")}
        </p>
      )}

      <StatusBanner lease={lease} t={t} />

      <section aria-labelledby="balance-label" className="rounded-xl border-2 border-gray-900 p-4">
        <h2 id="balance-label" className="text-base font-semibold text-gray-800">
          {t("home.balance")}
        </h2>
        <p className="text-4xl font-extrabold" data-testid="balance">
          {naira(lease.balance.remaining.naira)}
        </p>
      </section>

      <section aria-labelledby="due-label" className="rounded-xl border-2 border-gray-900 p-4">
        <h2 id="due-label" className="text-base font-semibold text-gray-800">
          {t("home.nextDue")}
        </h2>
        <p className="text-2xl font-bold" data-testid="next-due">
          {lease.nextDue && canPay ? dateText(lease.nextDue) : t("home.noDue")}
        </p>
        {canPay && <p>{t("home.nextAmount", { amount: naira(lease.terms.installment.naira) })}</p>}
      </section>

      <section aria-labelledby="progress-label" className="rounded-xl border-2 border-gray-900 p-4">
        <h2 id="progress-label" className="text-base font-semibold text-gray-800">
          {t("home.progress")}
        </h2>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={t("home.progress")}
          className="mt-2 h-6 w-full overflow-hidden rounded-full border-2 border-gray-900 bg-white"
        >
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2">{t("home.progressText", { pct, paid: naira(lease.balance.paid.naira) })}</p>
      </section>

      {canPay && (
        <button
          type="button"
          onClick={onPay}
          className="min-h-tap w-full rounded-xl bg-brand px-4 py-3 text-xl font-bold text-white hover:bg-brand-dark"
        >
          {t("pay.button")}
        </button>
      )}
      {lease.status === "Pending" && onActivate && (
        <>
          <button
            type="button"
            onClick={onActivate}
            className="min-h-tap w-full rounded-xl bg-brand px-4 py-3 text-xl font-bold text-white hover:bg-brand-dark"
          >
            {t("activate.button")}
          </button>
          {activateError && <p role="alert" className="font-semibold text-red-800">{t("activate.error")}</p>}
        </>
      )}

      <p className="text-sm text-gray-700" data-testid="last-updated">
        {t("home.lastUpdated", { when: dateTimeText(lastUpdated) })}
      </p>
    </div>
  );
}
