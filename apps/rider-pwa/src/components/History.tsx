"use client";
import { useEffect, useState } from "react";
import type { ApiClient } from "@/lib/api";
import type { Payment, Receipt } from "@/lib/types";
import type { T } from "@/lib/i18n";
import { dateText, naira } from "@/lib/format";

export function receiptText(r: Receipt, t: T): string {
  const line = (k: Parameters<T>[0], v: string) => `${t(k)}: ${v}`;
  return [
    t("receipt.title"),
    "",
    line("receipt.number", r.receiptNumber),
    line("receipt.date", dateText(r.paidAt)),
    line("receipt.amount", naira(r.nairaAmount)),
    line("receipt.applied", naira(r.appliedNairaAmount)),
    ...(Number(r.excessNairaAmount) > 0 ? [line("receipt.excess", naira(r.excessNairaAmount))] : []),
    line("receipt.method", r.paymentMethod),
    line("receipt.balance", naira(r.balanceRemaining.naira)),
    line("receipt.progress", `${r.progressPercent}%`),
    line("receipt.vehicle", r.assetType),
    line("receipt.lessor", r.lessorName),
    "",
  ].join("\n");
}

/** Saves text as a file on the phone. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  api: Pick<ApiClient, "payments" | "receipt">;
  leaseId: string;
  t: T;
  save?: (name: string, text: string) => void;
}

export function History({ api, leaseId, t, save = download }: Props) {
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState(false);
  const [receiptError, setReceiptError] = useState(false);

  useEffect(() => {
    api.payments(leaseId).then(setItems).catch(() => setError(true));
  }, [api, leaseId]);

  async function getReceipt(p: Payment) {
    setReceiptError(false);
    try {
      const r = await api.receipt(leaseId, p.id);
      save(`mallaka-receipt-${r.receiptNumber}.txt`, receiptText(r, t));
    } catch {
      setReceiptError(true);
    }
  }

  if (error) return <p role="alert">{t("common.error")}</p>;
  if (!items) return <p role="status">{t("home.loading")}</p>;
  return (
    <section aria-label={t("history.title")} className="space-y-3">
      <h2 className="text-xl font-bold">{t("history.title")}</h2>
      {items.length === 0 && <p>{t("history.empty")}</p>}
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.id} className="rounded-xl border-2 border-gray-900 p-3">
            <p className="text-xl font-bold">{naira(p.nairaAmount)}</p>
            <p>
              {dateText(p.createdAt)} · {p.status === "settled" ? t("history.settled") : t("history.processing")}
            </p>
            {p.excessFlagged && <p className="font-semibold">{t("history.refundNote")}</p>}
            {p.status === "settled" && (
              <button
                type="button"
                onClick={() => void getReceipt(p)}
                className="mt-2 min-h-tap rounded-lg border-2 border-brand px-4 py-2 font-bold text-brand"
              >
                {t("history.receipt")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {receiptError && <p role="alert" className="font-semibold text-red-800">{t("history.receiptError")}</p>}
    </section>
  );
}
