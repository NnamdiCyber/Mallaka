import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HomeScreen } from "../src/components/HomeScreen";
import { Terms } from "../src/components/Terms";
import { makeT, translate, LOCALES } from "../src/lib/i18n";
import { en } from "../src/lib/locales/en";
import { completed, defaulted, grace, lease } from "./fixtures";

const t = makeT("en");
const view = (l = lease("Active")) =>
  render(<HomeScreen lease={l} t={t} lastUpdated="2026-10-25T10:00:00.000Z" offline={false} onPay={() => {}} />);

/** The UI must never expose crypto concepts (README 1: riders never touch crypto). */
const CRYPTO = /wallet|xlm|\bgas\b|token|hash|stellar|crypto|blockchain|soroban|usdc|seed phrase/i;

describe("home screen states", () => {
  it("Active: balance, next due date and progress are prominent; no banner", () => {
    const { container } = view();
    expect(screen.getByTestId("balance")).toHaveTextContent("₦900,000");
    expect(screen.getByTestId("next-due")).toHaveTextContent("26 Oct 2026");
    expect(screen.getByRole("progressbar", { name: "Progress to ownership" })).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText(/33% paid/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /late|owed/i })).toBeNull();
    expect(container.textContent).not.toMatch(CRYPTO);
  });

  it("Grace: calm banner says what to do and by when", () => {
    const { container } = view(grace());
    const banner = screen.getByRole("status", { name: "Your payment is late, but you still have time" });
    expect(within(banner).getByText(/was due on 26 Oct 2026/)).toBeInTheDocument();
    expect(within(banner).getByText(/until 28 Oct 2026/)).toBeInTheDocument();
    expect(banner.textContent).toMatch(/Nothing will happen to your vehicle before then/);
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(CRYPTO);
  });

  it("Defaulted: calm banner with the amount to pay, how to unlock and who to ask", () => {
    const { container } = view(defaulted());
    const banner = screen.getByRole("status", { name: /Please pay what is owed/ });
    expect(banner.textContent).toMatch(/behind by ₦45,000/);
    expect(banner.textContent).toMatch(/unlocks right away/);
    expect(banner.textContent).toMatch(/talk to your lessor/);
    expect(banner.textContent).not.toMatch(/penalt|fine|seiz|illegal|warning|final notice/i);
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(CRYPTO);
  });

  it("Completed: celebrates, shows 100%, no pay button or due date", () => {
    const { container } = view(completed());
    expect(screen.getByRole("status", { name: /finished paying/ })).toBeInTheDocument();
    expect(screen.getByTestId("balance")).toHaveTextContent("₦0");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
    expect(screen.getByTestId("next-due")).toHaveTextContent("No payment due");
    expect(container.textContent).not.toMatch(CRYPTO);
  });

  it("labels when the information was last updated", () => {
    view();
    expect(screen.getByTestId("last-updated")).toHaveTextContent("Last updated 25 Oct 2026, 10:00");
  });

  it("buttons are large tap targets", () => {
    view();
    expect(screen.getByRole("button", { name: "Pay now" }).className).toMatch(/min-h-tap/);
  });
});

describe("lease terms in plain language", () => {
  it("explains price, installment, grace, what happens if you miss a payment, and ownership", () => {
    const { container } = render(<Terms lease={lease("Active")} t={t} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Price of the vehicle: ₦1,500,000/);
    expect(text).toMatch(/Deposit paid at the start: ₦150,000/);
    expect(text).toMatch(/You pay ₦15,000 every day/);
    expect(text).toMatch(/2 days to catch up/);
    expect(text).toMatch(/may be locked, but only when it is safely stopped/);
    expect(text).toMatch(/3 more days/);
    expect(text).toMatch(/becomes yours automatically/);
    expect(text).not.toMatch(CRYPTO);
  });
});

describe("i18n scaffolding", () => {
  it("Hausa, Yoruba, Igbo and Pidgin are empty placeholders that fall back to English", () => {
    for (const l of LOCALES.filter((x) => x.code !== "en")) {
      expect(l.ready).toBe(false);
      expect(translate(l.code, "home.balance")).toBe(en["home.balance"]);
    }
  });

  it("no English string mentions crypto concepts", () => {
    for (const value of Object.values(en)) expect(value).not.toMatch(CRYPTO);
  });
});
