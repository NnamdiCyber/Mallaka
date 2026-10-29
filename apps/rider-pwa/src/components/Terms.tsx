import type { Lease } from "@/lib/types";
import type { T } from "@/lib/i18n";
import { days, intervalWord, naira } from "@/lib/format";

/** Plain-language lease terms. No jargon. */
export function Terms({ lease, t }: { lease: Lease; t: T }) {
  const x = lease.terms;
  const word = intervalWord(x.intervalSeconds);
  return (
    <section aria-label={t("terms.title")} className="space-y-3">
      <h2 className="text-xl font-bold">{t("terms.title")}</h2>
      <ul className="list-disc space-y-3 pl-6">
        <li>{t("terms.price", { amount: naira(x.totalPrice.naira) })}</li>
        <li>{t("terms.deposit", { amount: naira(x.deposit.naira) })}</li>
        <li>{t("terms.installment", { amount: naira(x.installment.naira), interval: t(`interval.${word}`) })}</li>
        <li>{t("terms.prepay")}</li>
        <li>{t("terms.grace", { days: days(x.graceSeconds) })}</li>
        <li>{t("terms.missed")}</li>
        <li>{t("terms.repossession", { days: days(x.repossessionWaitSeconds) })}</li>
        <li>{t("terms.ownership")}</li>
      </ul>
    </section>
  );
}
