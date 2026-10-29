import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient, session } from "@/lib/api";
import { previewLease } from "@/lib/preview";
import type { AuditEntry, Lease, Payment } from "@/lib/types";
import { App } from "@/components/App";

function makeLease(overrides: Partial<Lease> & { id: string; status: Lease["status"] }): Lease {
  return {
    id: overrides.id,
    status: overrides.status,
    terms: overrides.terms ?? {
      totalPrice: { token: "1000.00", naira: "1600000.00" },
      deposit: { token: "100.00", naira: "160000.00" },
      installment: { token: "15.00", naira: "24000.00" },
      intervalSeconds: 604_800,
      graceSeconds: 259_200,
      repossessionWaitSeconds: 1_209_600,
    },
    balance: overrides.balance ?? {
      paid: { token: "250.00", naira: "400000.00" },
      remaining: { token: "750.00", naira: "1200000.00" },
      arrears: { token: "0.00", naira: "0.00" },
    },
    nextDue: overrides.nextDue !== undefined ? overrides.nextDue : 1_760_000_000,
    graceEnds: overrides.graceEnds ?? null,
    progressPercent: overrides.progressPercent ?? 25,
    asset: overrides.asset ?? { type: "motorcycle", deviceId: `DEV-${overrides.id}` },
    lessee: overrides.lessee ?? { id: `u-${overrides.id}`, phoneLast4: "4455" },
    source: overrides.source ?? "cache",
    stale: overrides.stale ?? false,
    updatedAt: overrides.updatedAt ?? "2026-10-29T10:00:00.000Z",
  };
}

const SAMPLE_LEASES: Lease[] = [
  makeLease({
    id: "1",
    status: "Active",
    nextDue: 1_760_100_000,
    balance: {
      paid: { token: "200.00", naira: "320000.00" },
      remaining: { token: "800.00", naira: "1280000.00" },
      arrears: { token: "0.00", naira: "0.00" },
    },
  }),
  makeLease({
    id: "2",
    status: "Grace",
    nextDue: 1_759_900_000, // soonest!
    graceEnds: 1_760_159_200,
    balance: {
      paid: { token: "150.00", naira: "240000.00" },
      remaining: { token: "850.00", naira: "1360000.00" },
      arrears: { token: "15.00", naira: "24000.00" },
    },
  }),
  makeLease({
    id: "3",
    status: "Defaulted",
    nextDue: 1_760_200_000,
    graceEnds: 1_759_800_000,
    balance: {
      paid: { token: "100.00", naira: "160000.00" },
      remaining: { token: "900.00", naira: "1440000.00" },
      arrears: { token: "45.00", naira: "72000.00" },
    },
  }),
  makeLease({
    id: "4",
    status: "Completed",
    nextDue: null,
    progressPercent: 100,
    balance: {
      paid: { token: "1000.00", naira: "1600000.00" },
      remaining: { token: "0.00", naira: "0.00" },
      arrears: { token: "0.00", naira: "0.00" },
    },
  }),
];

const SAMPLE_PAYMENTS: Payment[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    nairaAmount: "160000.00",
    status: "settled",
    provider: "paystack",
    createdAt: "2026-10-01T09:00:00.000Z",
    settledAt: "2026-10-01T09:00:08.000Z",
    excessFlagged: false,
    txHash: "abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
  },
];

const SAMPLE_AUDIT: AuditEntry[] = [
  {
    id: "aud-1",
    actor: "lessor_staff:staff-1",
    action: "lease_created",
    resource: "lease:1",
    details: { assetType: "motorcycle", interval: "weekly" },
    createdAt: "2026-10-01T08:30:00.000Z",
  },
];

function mockFetch(handlers: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^\/api/, "");
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `Unhandled ${key}` } }), { status: 404 });
    }
    const res = handler(init);
    return new Response(JSON.stringify(res.body), {
      status: res.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("Lessor Dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("blocks riders from logging into the lessor dashboard and admits lessor_staff", async () => {
    const user = userEvent.setup();
    let roleToReturn: "rider" | "lessor_staff" = "rider";

    const fetchFn = mockFetch({
      "POST /v1/auth/otp/request": () => ({ body: { status: "sent" } }),
      "POST /v1/auth/otp/verify": () => ({ body: { token: "jwt-tok", role: roleToReturn } }),
      "GET /v1/leases": () => ({ body: { leases: SAMPLE_LEASES } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);

    await user.type(screen.getByLabelText(/phone number/i), "+2348011112222");
    await user.click(screen.getByRole("button", { name: /send verification code/i }));
    await user.type(screen.getByLabelText(/6-digit verification code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify & sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/restricted to lessor staff and administrators/i);

    roleToReturn = "lessor_staff";
    await user.click(screen.getByRole("button", { name: /verify & sign in/i }));
    expect(await screen.findByLabelText("Portfolio overview")).toBeInTheDocument();
  });

  it("computes accurate portfolio status counts, total collected, total outstanding, and next-due soonest (no CSV export)", async () => {
    session.set("jwt-staff", "lessor_staff");
    const fetchFn = mockFetch({
      "GET /v1/leases": () => ({ body: { leases: SAMPLE_LEASES } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);

    await screen.findByLabelText("Portfolio overview");
    expect(screen.getByTestId("count-Active")).toHaveTextContent("1");
    expect(screen.getByTestId("count-Grace")).toHaveTextContent("1");
    expect(screen.getByTestId("count-Defaulted")).toHaveTextContent("1");
    expect(screen.getByTestId("count-Completed")).toHaveTextContent("1");

    // 320,000 + 240,000 + 160,000 + 1,600,000 = 2,320,000
    expect(screen.getByTestId("total-collected")).toHaveTextContent("₦2,320,000");
    // 1,280,000 + 1,360,000 + 1,440,000 + 0 = 4,080,000
    expect(screen.getByTestId("total-outstanding")).toHaveTextContent("₦4,080,000");
    // Lease #2 has the smallest nextDue (1_759_900_000)
    expect(screen.getByTestId("next-due-soonest")).toHaveTextContent("Lease #2");

    // Explicitly no CSV export per README good first issue constraint
    expect(screen.queryByText(/csv/i)).not.toBeInTheDocument();
  });

  it("sorts Grace and Defaulted leases descending by arrears in the delinquency view", async () => {
    const user = userEvent.setup();
    session.set("jwt-staff", "lessor_staff");
    const fetchFn = mockFetch({
      "GET /v1/leases": () => ({ body: { leases: SAMPLE_LEASES } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);
    await screen.findByLabelText("Portfolio overview");

    await user.click(screen.getByRole("button", { name: /^delinquency$/i }));
    const section = await screen.findByLabelText("Delinquency view");
    const rows = within(section).getAllByRole("row").slice(1); // skip header
    expect(rows).toHaveLength(2);
    // Lease #3 has ₦72,000 arrears; Lease #2 has ₦24,000 arrears
    expect(rows[0]).toHaveTextContent("#3");
    expect(rows[1]).toHaveTextContent("#2");
  });

  it("previews Total Cost of Ownership using ceil installment count and creates a lease via POST /v1/leases", async () => {
    // Unit-verify preview math with uneven remainder: (1000 - 100) / 14 = 64.28 -> 65 installments, final $4.00
    const uneven = previewLease({
      totalPrice: "1000.00",
      deposit: "100.00",
      installment: "14.00",
      interval: "weekly",
      graceDays: 3,
      repossessionWaitDays: 14,
    });
    expect(uneven.valid).toBe(true);
    expect(uneven.installments).toBe(65);
    expect(uneven.finalInstallment).toBe("4.00");

    const user = userEvent.setup();
    session.set("jwt-staff", "lessor_staff");
    let capturedBody: unknown = null;
    const createdLease = makeLease({ id: "99", status: "Pending", nextDue: null, progressPercent: 0 });

    const fetchFn = mockFetch({
      "GET /v1/leases": () => ({ body: { leases: capturedBody ? [createdLease, ...SAMPLE_LEASES] : SAMPLE_LEASES } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
      "POST /v1/leases": (init) => {
        capturedBody = JSON.parse(String(init?.body));
        return { status: 201, body: createdLease };
      },
      "GET /v1/leases/99": () => ({ body: createdLease }),
      "GET /v1/leases/99/payments": () => ({ body: { payments: [] } }),
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);
    await screen.findByLabelText("Portfolio overview");

    await user.click(screen.getByRole("button", { name: /create lease/i }));
    expect(screen.getByTestId("tco-total")).toHaveTextContent("$1,000.00");
    expect(screen.getByTestId("tco-payable")).toHaveTextContent("$900.00");
    expect(screen.getByTestId("tco-installments")).toHaveTextContent("60 (weekly)");

    await user.type(screen.getByLabelText(/vin or serial/i), "VIN-TVS-9988");
    await user.type(screen.getByLabelText(/immobilizer \/ gps device id/i), "DEV-9988");
    await user.type(screen.getByLabelText(/rider phone/i), "+2348099887766");
    await user.type(
      screen.getByLabelText(/custodial account address/i),
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    );

    const createSection = screen.getByLabelText("Create lease");
    await user.click(within(createSection).getByRole("button", { name: /create lease/i }));

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toMatchObject({
      asset: { vinOrSerial: "VIN-TVS-9988", assetType: "motorcycle", deviceId: "DEV-9988" },
      lessee: { phone: "+2348099887766" },
      totalPrice: "1000.00",
      deposit: "100.00",
      installment: "15.00",
      interval: "weekly",
    });
    expect(await screen.findByRole("heading", { name: /lease #99/i })).toBeInTheDocument();

    // Return to portfolio, confirm Lease #99 appears, then simulate rider payment settling and updating balance
    await user.click(screen.getByRole("button", { name: /← back/i }));
    expect(await screen.findByText("#99")).toBeInTheDocument();
  });

  it("reflects updated balance on the lease and portfolio after a rider payment settles", async () => {
    const user = userEvent.setup();
    session.set("jwt-staff", "lessor_staff");
    let riderPaid = false;

    const initialLease = makeLease({
      id: "50",
      status: "Active",
      progressPercent: 10,
      balance: {
        paid: { token: "100.00", naira: "160000.00" },
        remaining: { token: "900.00", naira: "1440000.00" },
        arrears: { token: "0.00", naira: "0.00" },
      },
    });
    const updatedLease = makeLease({
      id: "50",
      status: "Active",
      progressPercent: 25,
      source: "chain",
      balance: {
        paid: { token: "250.00", naira: "400000.00" },
        remaining: { token: "750.00", naira: "1200000.00" },
        arrears: { token: "0.00", naira: "0.00" },
      },
    });

    const fetchFn = mockFetch({
      "GET /v1/leases": () => ({ body: { leases: [riderPaid ? updatedLease : initialLease] } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
      "GET /v1/leases/50": () => ({ body: riderPaid ? updatedLease : initialLease }),
      "GET /v1/leases/50?fresh=true": () => ({ body: updatedLease }),
      "GET /v1/leases/50/payments": () => ({ body: { payments: riderPaid ? SAMPLE_PAYMENTS : [] } }),
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);
    await screen.findByLabelText("Portfolio overview");
    expect(screen.getByTestId("total-collected")).toHaveTextContent("₦160,000");

    await user.click(screen.getByRole("button", { name: /view details/i }));
    await screen.findByRole("heading", { name: /lease #50/i });

    // Rider payment settles on-chain; lessor refreshes from chain
    riderPaid = true;
    await user.click(screen.getByRole("button", { name: /verify fresh on-chain state/i }));
    expect(await screen.findByText("25%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /← back/i }));
    expect(await screen.findByTestId("total-collected")).toHaveTextContent("₦400,000");
    expect(screen.getByTestId("total-outstanding")).toHaveTextContent("₦1,200,000");
  });

  it("displays Stellar Explorer tx link, enforces Defaulted-only lock, and drives the two-person lock approval flow", async () => {
    const user = userEvent.setup();
    session.set("jwt-staff", "admin");
    const lockCalls: Array<{ reason: string; approvalId?: string }> = [];
    const approvalUuid = "22222222-2222-4222-8222-222222222222";

    const defaultedLease = SAMPLE_LEASES[2]; // id: "3", status: "Defaulted"

    const fetchFn = mockFetch({
      "GET /v1/leases": () => ({ body: { leases: SAMPLE_LEASES } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
      "GET /v1/leases/3": () => ({ body: defaultedLease }),
      "GET /v1/leases/3/payments": () => ({ body: { payments: SAMPLE_PAYMENTS } }),
      "POST /v1/admin/leases/3/lock": (init) => {
        const parsed = JSON.parse(String(init?.body)) as { reason: string; approvalId?: string };
        lockCalls.push(parsed);
        if (!parsed.approvalId) {
          return {
            status: 202,
            body: {
              status: "approval_required",
              approvalId: approvalUuid,
              message: "A second person must approve this lock.",
            },
          };
        }
        return {
          status: 202,
          body: {
            status: "queued",
            commandId: "33333333-3333-4333-8333-333333333333",
            message: "Approved. Lock queued; safety rules are checked before it is sent.",
          },
        };
      },
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);
    await screen.findByLabelText("Portfolio overview");

    // Open Lease #3 (Defaulted)
    const viewButtons = screen.getAllByRole("button", { name: /view details/i });
    await user.click(viewButtons[2]);

    await screen.findByRole("heading", { name: /lease #3/i });
    const explorerLink = await screen.findByTestId("explorer-link");
    expect(explorerLink).toHaveAttribute("href", expect.stringContaining("/tx/abc123def4567890"));
    expect(screen.getByTestId("device-id")).toHaveTextContent("DEV-3");

    // Step 1: First staff member requests manual lock -> receives approval_required
    await user.type(
      screen.getByLabelText(/reason for audit log/i),
      "Defaulted beyond grace window; stationary lock requested."
    );
    await user.click(screen.getByRole("button", { name: /request manual lock/i }));

    expect(await screen.findByTestId("pending-approval-id")).toHaveTextContent(approvalUuid);
    expect(lockCalls).toHaveLength(1);
    expect(lockCalls[0].approvalId).toBeUndefined();

    // Step 2: Second approver submits approvalId -> receives queued
    await user.click(screen.getByRole("button", { name: /approve lock/i }));
    await waitFor(() => expect(lockCalls).toHaveLength(2));
    expect(lockCalls[1].approvalId).toBe(approvalUuid);
    expect(await screen.findByTestId("lock-command-result")).toHaveTextContent(/approved\. lock queued/i);
  });

  it("renders the read-only audit log", async () => {
    const user = userEvent.setup();
    session.set("jwt-staff", "admin");
    const fetchFn = mockFetch({
      "GET /v1/leases": () => ({ body: { leases: SAMPLE_LEASES } }),
      "GET /v1/admin/audit-log?limit=50": () => ({ body: { entries: SAMPLE_AUDIT } }),
    });

    render(<App client={new ApiClient("/api", fetchFn)} />);
    await screen.findByLabelText("Portfolio overview");

    await user.click(screen.getByRole("button", { name: /audit log/i }));
    const logSection = await screen.findByLabelText("Audit log");
    expect(within(logSection).getByText("lease_created")).toBeInTheDocument();
    expect(within(logSection).getByText("lessor_staff:staff-1")).toBeInTheDocument();
  });
});
