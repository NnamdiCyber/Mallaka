import type { Lease, Payment, Receipt } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
  }
}

/** Thrown when the network is unreachable (so the app can fall back to the saved state). */
export class NetworkError extends Error {}

const TOKEN_KEY = "mallaka:token";
export const tokenStore = {
  get: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** The only way this app talks to the backend: services/api through the /api proxy. */
export class ApiClient {
  constructor(
    private readonly base = "/api",
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly getToken: () => string | null = tokenStore.get
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } catch {
      throw new NetworkError("offline");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new ApiError(body.error?.message ?? "Something went wrong", res.status, body.error?.code ?? "ERROR");
    }
    return (await res.json()) as T;
  }

  requestOtp(phone: string) {
    return this.call<{ status: string }>("/v1/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) });
  }
  verifyOtp(phone: string, code: string) {
    return this.call<{ token: string; role: string }>("/v1/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
  }
  async listLeases(): Promise<Lease[]> {
    return (await this.call<{ leases: Lease[] }>("/v1/leases")).leases;
  }
  getLease(id: string, fresh = false) {
    return this.call<Lease>(`/v1/leases/${id}${fresh ? "?fresh=true" : ""}`);
  }
  activate(id: string) {
    return this.call<Lease>(`/v1/leases/${id}/activate`, { method: "POST" });
  }
  async payments(id: string): Promise<Payment[]> {
    return (await this.call<{ payments: Payment[] }>(`/v1/leases/${id}/payments`)).payments;
  }
  initiatePayment(id: string, amountNaira: string) {
    return this.call<{ reference: string; checkoutUrl: string }>(`/v1/leases/${id}/payments/initiate`, {
      method: "POST",
      body: JSON.stringify({ amountNaira }),
    });
  }
  receipt(id: string, paymentId: string) {
    return this.call<Receipt>(`/v1/leases/${id}/receipt/${paymentId}`);
  }
}
