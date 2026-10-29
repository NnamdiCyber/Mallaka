/**
 * JSON Schemas shared by routes. Fastify validates requests against them and
 * serialises responses through them (undeclared fields are dropped, which is
 * also how PII is kept out of responses). OpenAPI is generated from these.
 */
export const errorResponse = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        contractError: { type: "string", description: "README 7.5 error name when the chain rejected the call" },
        details: {},
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
} as const;

export const errorResponses = {
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
  429: errorResponse,
} as const;

const idParam = {
  type: "object",
  properties: { id: { type: "string", pattern: "^[0-9]{1,20}$" } },
  required: ["id"],
} as const;

export const leaseIdParams = idParam;

export const paymentParams = {
  type: "object",
  properties: {
    id: { type: "string", pattern: "^[0-9]{1,20}$" },
    paymentId: { type: "string", format: "uuid" },
  },
  required: ["id", "paymentId"],
} as const;

const amountPair = {
  type: "object",
  properties: {
    token: { type: "string", description: "Settlement-currency amount, decimal string" },
    naira: { type: "string", description: "Approximate naira at the recorded FX rate, decimal string" },
  },
  required: ["token", "naira"],
} as const;

export const leaseView = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["Pending", "Active", "Grace", "Defaulted", "Completed", "Repossessed", "Cancelled"] },
    terms: {
      type: "object",
      properties: {
        totalPrice: amountPair,
        deposit: amountPair,
        installment: amountPair,
        intervalSeconds: { type: "integer" },
        graceSeconds: { type: "integer" },
        repossessionWaitSeconds: { type: "integer" },
      },
      required: ["totalPrice", "deposit", "installment", "intervalSeconds", "graceSeconds", "repossessionWaitSeconds"],
    },
    balance: {
      type: "object",
      properties: { paid: amountPair, remaining: amountPair, arrears: amountPair },
      required: ["paid", "remaining", "arrears"],
    },
    nextDue: { type: ["integer", "null"], description: "Unix seconds of the next installment due date" },
    graceEnds: { type: ["integer", "null"], description: "Unix seconds when the grace window ends for the overdue installment" },
    progressPercent: { type: "integer", minimum: 0, maximum: 100 },
    asset: {
      type: "object",
      properties: { type: { type: "string" }, deviceId: { type: "string", description: "Staff and admin only" } },
      required: ["type"],
    },
    lessee: {
      type: "object",
      description: "Staff and admin only. Phone is masked to the last 4 digits.",
      properties: { id: { type: "string" }, phoneLast4: { type: "string" } },
    },
    fx: {
      type: "object",
      properties: { nairaPerToken: { type: "string" }, source: { type: "string" } },
      required: ["nairaPerToken", "source"],
    },
    source: { type: "string", enum: ["cache", "chain"], description: "Where this state was read from" },
    stale: { type: "boolean", description: "True when a fresh chain read was needed but the chain was unreachable" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "status", "terms", "balance", "progressPercent", "asset", "fx", "source", "stale", "updatedAt"],
} as const;

export const leaseList = {
  type: "object",
  properties: { leases: { type: "array", items: leaseView } },
  required: ["leases"],
} as const;

export const paymentView = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    nairaAmount: { type: "string" },
    status: { type: "string", enum: ["processing", "settled"], description: "Settled only once the on-chain payment is final" },
    provider: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    settledAt: { type: ["string", "null"], format: "date-time" },
    excessFlagged: { type: "boolean", description: "Part of this payment exceeded the balance and will be refunded manually" },
    txHash: { type: "string", description: "Staff and admin only (for the explorer link)" },
  },
  required: ["id", "nairaAmount", "status", "provider", "createdAt", "settledAt", "excessFlagged"],
} as const;

export const receiptView = {
  type: "object",
  properties: {
    receiptNumber: { type: "string" },
    leaseId: { type: "string" },
    paidAt: { type: "string", format: "date-time" },
    nairaAmount: { type: "string" },
    appliedNairaAmount: { type: "string", description: "Part applied to the lease" },
    excessNairaAmount: { type: "string", description: "Part flagged for manual refund" },
    paymentMethod: { type: "string" },
    balanceRemaining: { type: "object", properties: { naira: { type: "string" } }, required: ["naira"] },
    progressPercent: { type: "integer" },
    assetType: { type: "string" },
    lessorName: { type: "string" },
    onChainConfirmed: { type: "boolean" },
    txHash: { type: "string", description: "Staff and admin only" },
  },
  required: [
    "receiptNumber", "leaseId", "paidAt", "nairaAmount", "appliedNairaAmount", "excessNairaAmount",
    "paymentMethod", "balanceRemaining", "progressPercent", "assetType", "lessorName", "onChainConfirmed",
  ],
} as const;

export const phoneProp = { type: "string", pattern: "^\\+[1-9][0-9]{9,14}$", description: "E.164 phone number" } as const;
