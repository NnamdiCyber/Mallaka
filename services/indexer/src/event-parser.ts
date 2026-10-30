import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";

export interface ParsedEvent {
  contractId: string;
  eventName: string;
  txHash: string;
  eventIndex: number;
  ledger: number;
  ledgerClosedAt: Date;
  topics: unknown[];
  data: unknown;
  leaseId?: bigint;
}

/**
 * Parses raw Soroban RPC event into typed format matching README section 7.4
 */
export function parseSorobanEvent(
  rawEvent: rpc.Api.GetEventsResponse["events"][0],
  eventIndex: number
): ParsedEvent {
  const topics: unknown[] = (rawEvent.topic || []).map((t: string | xdr.ScVal | any) => {
    try {
      let scVal: xdr.ScVal;
      if (typeof t === "string") {
        scVal = xdr.ScVal.fromXDR(t, "base64");
      } else if (t && typeof t.toXDR === "function") {
        scVal = xdr.ScVal.fromXDR(t.toXDR("base64"), "base64");
      } else {
        scVal = t;
      }
      return scValToNative(scVal);
    } catch {
      return typeof t?.toString === "function" ? t.toString() : t;
    }
  });

  let data: unknown = null;
  try {
    let dataVal: xdr.ScVal | undefined;
    if (typeof rawEvent.value === "string") {
      dataVal = xdr.ScVal.fromXDR(rawEvent.value, "base64");
    } else if (rawEvent.value && typeof (rawEvent.value as any).toXDR === "function") {
      dataVal = xdr.ScVal.fromXDR((rawEvent.value as any).toXDR("base64"), "base64");
    } else if ((rawEvent.value as any)?.xdr) {
      dataVal = xdr.ScVal.fromXDR((rawEvent.value as any).xdr, "base64");
    } else {
      dataVal = rawEvent.value as any;
    }
    if (dataVal) {
      data = scValToNative(dataVal);
    }
  } catch {
    data = rawEvent.value;
  }

  // Topic[0] is the event symbol/name
  const eventName = String(topics[0] || "unknown");

  // Topic[1] is typically lease_id
  let leaseId: bigint | undefined = undefined;
  if (topics.length > 1 && (typeof topics[1] === "bigint" || typeof topics[1] === "number")) {
    leaseId = BigInt(topics[1]);
  }

  const txHash = (rawEvent as any).txHash || rawEvent.id || `evt_${rawEvent.ledger}_${eventIndex}`;
  const ledgerClosedAt = rawEvent.ledgerClosedAt ? new Date(rawEvent.ledgerClosedAt) : new Date();

  return {
    contractId: rawEvent.contractId ? rawEvent.contractId.toString() : "",
    eventName,
    txHash,
    eventIndex,
    ledger: rawEvent.ledger,
    ledgerClosedAt,
    topics,
    data,
    leaseId,
  };
}
