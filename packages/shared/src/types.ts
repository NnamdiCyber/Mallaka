import type {
  Lease,
  LeaseView,
  LeaseStatus,
  LeaseTerms,
  TitleEntry,
  AssetRecord,
} from "@mallaka/contract-bindings";

export type {
  Lease,
  LeaseView,
  LeaseStatus,
  LeaseTerms,
  TitleEntry,
  AssetRecord,
};

// ==========================================
// Database Models (matching README Section 9)
// ==========================================

export interface User {
  id: string; // UUID
  role: "rider" | "lessor_staff" | "admin";
  lessor_id: string | null; // UUID
  public_key: string | null; // Stellar address
  contact_info_encrypted: string; // Encrypted contact details
  created_at: Date;
  updated_at: Date;
}

export interface Lessor {
  id: string; // UUID
  name: string;
  stellar_address: string;
  payout_settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Asset {
  id: string; // UUID
  lessor_id: string; // UUID
  vin_or_serial: string;
  asset_type: "motorcycle" | "tricycle" | "farm_equipment" | string;
  photos: string[];
  device_id: string;
  asset_hash: string; // 32-byte hex anchored on-chain
  created_at: Date;
  updated_at: Date;
}

export interface DbLease {
  id: string; // bigint formatted as string
  lessor_id: string; // UUID
  asset_id: string; // UUID
  lessee_id: string | null; // UUID
  lessor_address: string;
  lessee_address: string;
  token_address: string;
  title_contract_address: string;
  total_price: string; // numeric(38, 0)
  deposit: string;
  installment: string;
  interval_seconds: number;
  grace_period_seconds: number;
  repossession_wait_seconds: number;
  paid: string;
  start_ts: number;
  status: "Pending" | "Active" | "Grace" | "Defaulted" | "Completed" | "Repossessed" | "Cancelled";
  created_at: Date;
  updated_at: Date;
}

export interface Payment {
  id: string; // UUID
  lease_id: string; // bigint
  payer_address: string;
  naira_amount: string; // numeric(18, 2)
  token_amount: string; // numeric(38, 0)
  fx_rate: string; // numeric(18, 6)
  provider: "paystack" | "flutterwave" | "manual";
  provider_reference: string;
  tx_hash: string | null;
  status: "pending" | "submitted" | "confirmed" | "failed";
  created_at: Date;
  updated_at: Date;
}

export interface ChainEvent {
  id: string; // UUID
  contract_id: string;
  event_name: string;
  tx_hash: string;
  event_index: number;
  ledger_sequence: number;
  ledger_closed_at: Date;
  topics: unknown[];
  data: unknown;
  created_at: Date;
}

export interface LockCommand {
  id: string; // UUID
  lease_id: string; // bigint
  asset_id: string; // UUID
  device_id: string;
  command: "lock" | "unlock";
  triggered_by: string;
  two_person_approved_by: string | null;
  status: "queued" | "sent" | "acknowledged" | "failed";
  result_details: Record<string, unknown> | null;
  created_at: Date;
}

export interface AuditLog {
  id: string; // UUID
  actor: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: Date;
}

// ==========================================
// On-Chain Event Payloads (README Section 7.4)
// ==========================================

export interface LeaseCreatedEventData {
  leaseId: bigint;
  lessor: string;
  lessee: string;
  assetId: string;
}

export interface ActivatedEventData {
  leaseId: bigint;
  startTs: bigint;
  deposit: bigint;
}

export interface PaymentEventData {
  leaseId: bigint;
  payer: string;
  amount: bigint;
  paidTotal: bigint;
  nextDue: bigint;
}

export interface GraceEnteredEventData {
  leaseId: bigint;
  dueTs: bigint;
  graceEnds: bigint;
}

export interface DefaultedEventData {
  leaseId: bigint;
  arrears: bigint;
}

export interface CuredEventData {
  leaseId: bigint;
  paidTotal: bigint;
}

export interface CompletedEventData {
  leaseId: bigint;
  lessee: string;
  finalPaid: bigint;
}

export interface RepossessedEventData {
  leaseId: bigint;
  ts: bigint;
}

export interface CancelledEventData {
  leaseId: bigint;
  ts: bigint;
}
