import type { AuditEntry, CommandResult, CreateLeaseInput, Lease, Payment, Role } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
  }
}

const TOKEN_KEY = "mallaka:staff-token";
const ROLE_KEY = "mallaka:staff-role";
export const session = {
  token: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  role: () => (typeof localStorage === "undefined" ? null : (localStorage.getItem(ROLE_KEY) as Role | null)),
  set: (token: string, role: Role) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  },
};

/** The only way the dashboard talks to the backend: services/api through the /api proxy. */
export class ApiClient {
  constructor(
    private readonly base = "/api",
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly getToken: () => string | null = session.token
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
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
    return this.call<{ token: string; role: Role }>("/v1/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
  }
  async listLeases(): Promise<Lease[]> {
    return (await this.call<{ leases: Lease[] }>("/v1/leases")).leases;
  }
  getLease(id: string, fresh = false) {
    return this.call<Lease>(`/v1/leases/${id}${fresh ? "?fresh=true" : ""}`);
  }
  createLease(input: CreateLeaseInput) {
    return this.call<Lease>("/v1/leases", { method: "POST", body: JSON.stringify(input) });
  }
  async payments(id: string): Promise<Payment[]> {
    return (await this.call<{ payments: Payment[] }>(`/v1/leases/${id}/payments`)).payments;
  }
  lock(id: string, reason: string, approvalId?: string) {
    return this.call<CommandResult>(`/v1/admin/leases/${id}/lock`, { method: "POST", body: JSON.stringify({ reason, ...(approvalId ? { approvalId } : {}) }) });
  }
  unlock(id: string, reason: string) {
    return this.call<CommandResult>(`/v1/admin/leases/${id}/unlock`, { method: "POST", body: JSON.stringify({ reason }) });
  }
  async auditLog(limit = 100): Promise<AuditEntry[]> {
    return (await this.call<{ entries: AuditEntry[] }>(`/v1/admin/audit-log?limit=${limit}`)).entries;
  }
}
