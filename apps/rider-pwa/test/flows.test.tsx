import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/components/App";
import { PayPanel } from "../src/components/PayPanel";
import { History, receiptText } from "../src/components/History";
import { ApiClient } from "../src/lib/api";
import { saveLease } from "../src/lib/offline";
import { makeT } from "../src/lib/i18n";
import { lease } from "./fixtures";

const t = makeT("en");
const payment = (status: "processing" | "settled", id = "p1") => ({
  id, nairaAmount: "15000.00", status, createdAt: "2026-10-25T10:00:00.000Z", settledAt: null, excessFlagged: false,
});

describe("offline", () => {
  it("renders the last saved lease, clearly labelled, when the network is down", async () => {
    localStorage.setItem("mallaka:token", "tok");
    saveLease(lease("Grace", { graceEnds: 1_793_172_800 }), new Date("2026-10-24T08:30:00Z"));
    const offlineFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    render(<App client={new ApiClient("/api", offlineFetch as unknown as typeof fetch, () => "tok")} />);

    expect(await screen.findByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByTestId("balance")).toHaveTextContent("₦900,000");
    expect(screen.getByTestId("last-updated")).toHaveTextContent("Last updated 24 Oct 2026, 08:30");
    expect(screen.getByRole("status", { name: /late, but you still have time/ })).toBeInTheDocument();
  });

  it("shows the live lease and saves it when online", async () => {
    localStorage.setItem("mallaka:token", "tok");
    const l = lease("Active");
    const fetchFn = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (url.endsWith("/v1/leases") ? { leases: [l] } : l),
    }));
    render(<App client={new ApiClient("/api", fetchFn as unknown as typeof fetch, () => "tok")} />);
    expect(await screen.findByTestId("balance")).toHaveTextContent("₦900,000");
    expect(screen.queryByText(/You are offline/)).toBeNull();
    expect(localStorage.getItem("mallaka:lease:7")).toContain('"id":"7"');
  });

  it("shows the login form when there is no session", async () => {
    render(<App client={new ApiClient("/api", vi.fn() as unknown as typeof fetch, () => null)} />);
    expect(await screen.findByRole("form", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("payment flow against a mocked API", () => {
  it("starts checkout, waits, and shows success ONLY after the API reports settlement", async () => {
    const user = userEvent.setup();
    const settled: ReturnType<typeof payment>[][] = [[], [], [payment("settled")]];
    let poll = 0;
    const api = {
      initiatePayment: vi.fn().mockResolvedValue({ reference: "mlk_1", checkoutUrl: "https://checkout.example/pay" }),
      payments: vi.fn(async () => settled[Math.min(poll++, settled.length - 1)]),
      getLease: vi.fn().mockResolvedValue(lease("Active", { balance: { paid: { naira: "465000.00", token: "" }, remaining: { naira: "885000.00", token: "" }, arrears: { naira: "0.00", token: "" } } })),
    };
    const redirect = vi.fn();
    const onSettled = vi.fn();
    render(<PayPanel api={api} lease={lease("Active")} t={t} onClose={() => {}} onSettled={onSettled} redirect={redirect} pollMs={10} />);

    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://checkout.example/pay"));
    expect(api.initiatePayment).toHaveBeenCalledWith("7", "15000");

    // Still waiting: no success message yet.
    expect(screen.getByText(/Waiting for your bank/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/)).toBeNull();

    // After the API reports a settled payment:
    expect(await screen.findByText(/Payment received. Thank you! Your balance is now ₦885,000/)).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalled();
    expect(screen.queryByText(/Waiting for your bank/)).toBeNull();
  });

  it("never shows success while the payment is only processing, and tells the rider not to pay twice when slow", async () => {
    const user = userEvent.setup();
    const api = {
      initiatePayment: vi.fn().mockResolvedValue({ reference: "r", checkoutUrl: "https://c.example" }),
      payments: vi.fn().mockResolvedValue([payment("processing")]),
      getLease: vi.fn(),
    };
    render(<PayPanel api={api} lease={lease("Active")} t={t} onClose={() => {}} onSettled={() => {}} redirect={() => {}} pollMs={10} timeoutMs={60} />);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(await screen.findByText(/Do not pay again/)).toBeInTheDocument();
    expect(screen.queryByText(/Payment received/)).toBeNull();
    expect(api.getLease).not.toHaveBeenCalled();
  });

  it("validates the amount and shows a friendly error if the payment cannot start", async () => {
    const user = userEvent.setup();
    const api = {
      initiatePayment: vi.fn().mockRejectedValue(new Error("boom")),
      payments: vi.fn().mockResolvedValue([]),
      getLease: vi.fn(),
    };
    render(<PayPanel api={api} lease={lease("Active")} t={t} onClose={() => {}} onSettled={() => {}} redirect={() => {}} />);
    const input = screen.getByLabelText("Amount in naira");
    await user.clear(input);
    await user.type(input, "20");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least ₦100");
    await user.clear(input);
    await user.type(input, "500");
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(await screen.findByText(/could not start the payment/)).toBeInTheDocument();
  });
});

describe("payment history and receipts", () => {
  it("lists payments and downloads a receipt only for settled ones", async () => {
    const user = userEvent.setup();
    const receipt = {
      receiptNumber: "MLK-ABC", paidAt: "2026-10-25T10:00:00.000Z", nairaAmount: "15000.00", appliedNairaAmount: "15000.00",
      excessNairaAmount: "0.00", paymentMethod: "paystack", balanceRemaining: { naira: "885000.00" }, progressPercent: 34,
      assetType: "motorcycle", lessorName: "Lagos Fleet",
    };
    const api = {
      payments: vi.fn().mockResolvedValue([payment("settled", "a"), payment("processing", "b")]),
      receipt: vi.fn().mockResolvedValue(receipt),
    };
    const save = vi.fn();
    render(<History api={api} leaseId="7" t={t} save={save} />);
    expect(await screen.findByText("Received", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download receipt" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Download receipt" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [name, text] = save.mock.calls[0];
    expect(name).toBe("mallaka-receipt-MLK-ABC.txt");
    expect(text).toContain("Balance remaining: ₦885,000");
    expect(text).not.toMatch(/\+234|phone|wallet|hash/i);
    expect(receiptText(receipt, t)).toContain("Receipt number: MLK-ABC");
  });
});
