"use client";

import React, { useState } from "react";
import type { ApiClient } from "@/lib/api";
import { usd } from "@/lib/money";
import { previewLease } from "@/lib/preview";
import type { CreateLeaseInput, Lease } from "@/lib/types";

interface CreateLeaseFormProps {
  api: ApiClient;
  onCreated: (lease: Lease) => void;
}

export function CreateLeaseForm({ api, onCreated }: CreateLeaseFormProps) {
  const [vinOrSerial, setVinOrSerial] = useState("");
  const [assetType, setAssetType] = useState<CreateLeaseInput["asset"]["assetType"]>("motorcycle");
  const [deviceId, setDeviceId] = useState("");
  const [photoRefsText, setPhotoRefsText] = useState("");
  const [lesseePhone, setLesseePhone] = useState("");
  const [lesseeAddress, setLesseeAddress] = useState("");
  const [totalPrice, setTotalPrice] = useState("1000.00");
  const [deposit, setDeposit] = useState("100.00");
  const [installment, setInstallment] = useState("15.00");
  const [interval, setInterval] = useState<"daily" | "weekly">("weekly");
  const [graceDays, setGraceDays] = useState(3);
  const [repossessionWaitDays, setRepossessionWaitDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = previewLease({
    totalPrice,
    deposit,
    installment,
    interval,
    graceDays,
    repossessionWaitDays,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview.valid) return;
    setError(null);
    setBusy(true);
    try {
      const photoRefs = photoRefsText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);

      const created = await api.createLease({
        asset: {
          vinOrSerial: vinOrSerial.trim(),
          assetType,
          deviceId: deviceId.trim(),
          ...(photoRefs.length > 0 ? { photoRefs } : {}),
        },
        lessee: {
          phone: lesseePhone.trim(),
          ...(lesseeAddress.trim() ? { address: lesseeAddress.trim() } : {}),
        },
        totalPrice: totalPrice.trim(),
        deposit: deposit.trim(),
        installment: installment.trim(),
        interval,
        graceDays: Number(graceDays),
        repossessionWaitDays: Number(repossessionWaitDays),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create lease");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Create lease" className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Create Lease & Register Asset</h2>
          <p className="mt-1 text-xs text-slate-600">
            Asset details and rider contact info stay encrypted/off-chain; only a SHA-256 asset anchor hash is stored on-chain.
            Fixed daily and weekly intervals are supported (seasonal schedules are Phase 6).
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-800">1. Asset Record</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="asset-type" className="block text-xs font-medium text-slate-700">Asset type</label>
              <select
                id="asset-type"
                value={assetType}
                onChange={(e) => setAssetType(e.target.value as CreateLeaseInput["asset"]["assetType"])}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="motorcycle">Motorcycle</option>
                <option value="tricycle">Tricycle</option>
                <option value="farm_equipment">Farm equipment</option>
              </select>
            </div>
            <div>
              <label htmlFor="asset-vin" className="block text-xs font-medium text-slate-700">VIN or serial number</label>
              <input
                id="asset-vin"
                type="text"
                required
                minLength={3}
                placeholder="VIN-BAJAJ-00921"
                value={vinOrSerial}
                onChange={(e) => setVinOrSerial(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="asset-device" className="block text-xs font-medium text-slate-700">Immobilizer / GPS device ID</label>
              <input
                id="asset-device"
                type="text"
                required
                placeholder="DEV-IMM-104"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>
          <div>
            <label htmlFor="asset-photos" className="block text-xs font-medium text-slate-700">
              Asset photo upload references (optional, comma-separated storage keys/URLs)
            </label>
            <input
              id="asset-photos"
              type="text"
              placeholder="s3://assets/vin-00921-front.jpg, s3://assets/vin-00921-plate.jpg"
              value={photoRefsText}
              onChange={(e) => setPhotoRefsText(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-800">2. Lessee (Rider)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lessee-phone" className="block text-xs font-medium text-slate-700">Rider phone (E.164)</label>
              <input
                id="lessee-phone"
                type="tel"
                required
                placeholder="+2348090001122"
                value={lesseePhone}
                onChange={(e) => setLesseePhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="lessee-address" className="block text-xs font-medium text-slate-700">
                Custodial account address (required for new rider)
              </label>
              <input
                id="lessee-address"
                type="text"
                placeholder="G..."
                value={lesseeAddress}
                onChange={(e) => setLesseeAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold text-slate-800">3. Lease Terms (USD settlement currency)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="term-price" className="block text-xs font-medium text-slate-700">Total price (USD)</label>
              <input
                id="term-price"
                type="text"
                required
                value={totalPrice}
                onChange={(e) => setTotalPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="term-deposit" className="block text-xs font-medium text-slate-700">Upfront deposit (USD)</label>
              <input
                id="term-deposit"
                type="text"
                required
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="term-installment" className="block text-xs font-medium text-slate-700">Installment (USD)</label>
              <input
                id="term-installment"
                type="text"
                required
                value={installment}
                onChange={(e) => setInstallment(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="term-interval" className="block text-xs font-medium text-slate-700">Schedule interval</label>
              <select
                id="term-interval"
                value={interval}
                onChange={(e) => setInterval(e.target.value as "daily" | "weekly")}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="daily">Daily (fixed)</option>
                <option value="weekly">Weekly (fixed)</option>
              </select>
            </div>
            <div>
              <label htmlFor="term-grace" className="block text-xs font-medium text-slate-700">Grace period (days)</label>
              <input
                id="term-grace"
                type="number"
                min={0}
                max={60}
                required
                value={graceDays}
                onChange={(e) => setGraceDays(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="term-repo" className="block text-xs font-medium text-slate-700">Repossession wait (days)</label>
              <input
                id="term-repo"
                type="number"
                min={0}
                max={365}
                required
                value={repossessionWaitDays}
                onChange={(e) => setRepossessionWaitDays(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={!preview.valid || busy}
          className="rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
        >
          {busy ? "Creating on-chain lease..." : "Create lease"}
        </button>
      </form>

      <aside aria-label="Total cost of ownership preview" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-bold text-slate-900">Total Cost of Ownership Preview</h3>
        <p className="mt-1 text-xs text-slate-600">Disclosed before signing (README section 20).</p>

        {!preview.valid ? (
          <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {preview.problem}
          </p>
        ) : (
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Total cost to rider</dt>
              <dd data-testid="tco-total" className="font-bold text-slate-900">{usd(preview.totalCost)}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Upfront deposit</dt>
              <dd className="font-semibold text-slate-800">{usd(preview.deposit)}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Financed balance</dt>
              <dd data-testid="tco-payable" className="font-semibold text-slate-800">{usd(preview.payable)}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Number of installments</dt>
              <dd data-testid="tco-installments" className="font-semibold text-slate-800">
                {preview.installments} ({interval})
              </dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Final installment</dt>
              <dd data-testid="tco-final" className="font-semibold text-slate-800">{usd(preview.finalInstallment)}</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Estimated duration</dt>
              <dd className="font-semibold text-slate-800">{preview.durationDays} days</dd>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-600">Late / compounding fees</dt>
              <dd className="font-semibold text-emerald-800">$0.00 (off)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Grace protection</dt>
              <dd className="font-semibold text-slate-800">{graceDays} days before default</dd>
            </div>
          </dl>
        )}
      </aside>
    </section>
  );
}
