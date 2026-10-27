export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = "INTERNAL_ERROR"
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", public readonly details?: unknown) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class LockBridgeError extends AppError {
  constructor(message: string, public readonly deviceId?: string) {
    super(message, 502, "LOCK_BRIDGE_ERROR");
  }
}

/**
 * Exact error names from README section 7.5.
 */
export enum ContractErrorCode {
  NotFound = 1,
  Unauthorized = 2,
  InvalidTerms = 3,
  InvalidState = 4,
  InvalidAmount = 5,
  AlreadyActive = 6,
  NotDefaulted = 7,
  RepossessionTooEarly = 8,
  Overpayment = 9,
  MathOverflow = 10,
}

export const CONTRACT_ERROR_NAMES: Record<number, string> = {
  1: "NotFound",
  2: "Unauthorized",
  3: "InvalidTerms",
  4: "InvalidState",
  5: "InvalidAmount",
  6: "AlreadyActive",
  7: "NotDefaulted",
  8: "RepossessionTooEarly",
  9: "Overpayment",
  10: "MathOverflow",
};

export class ContractError extends AppError {
  public readonly contractErrorCode: number;
  public readonly contractErrorName: string;

  constructor(code: number, rawMessage?: string) {
    const errorName = CONTRACT_ERROR_NAMES[code] || `UnknownContractError(${code})`;
    super(
      rawMessage || `Contract error ${code}: ${errorName}`,
      400,
      `CONTRACT_${errorName.toUpperCase()}`
    );
    this.contractErrorCode = code;
    this.contractErrorName = errorName;
  }

  static fromCode(code: number): ContractError {
    return new ContractError(code);
  }
}
