import { AppError, ContractError, CONTRACT_ERROR_NAMES } from "@mallaka/shared";

/**
 * One error shape for every route:
 *   { "error": { "code": "...", "message": "...", "contractError"?: "Overpayment" } }
 * Chain errors surface with their README 7.5 name in both `code` and `contractError`.
 */
export interface ErrorBody {
  error: { code: string; message: string; contractError?: string; details?: unknown };
}

export function mapError(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof ContractError) {
    const name = CONTRACT_ERROR_NAMES[err.contractErrorCode] ?? "ContractError";
    // NotFound -> 404, Unauthorized -> 403, everything else is a rule violation -> 409/400
    const status = err.contractErrorCode === 1 ? 404 : err.contractErrorCode === 2 ? 403 : 409;
    return { status, body: { error: { code: name, contractError: name, message: friendlyContractMessage(name) } } };
  }
  const e = err as { statusCode?: number; code?: string; validation?: unknown; message?: string };
  if (e && e.validation) {
    return {
      status: 400,
      body: { error: { code: "VALIDATION_ERROR", message: e.message ?? "Invalid request", details: e.validation } },
    };
  }
  if (e && e.statusCode === 429) {
    return { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again soon." } } };
  }
  if (err instanceof AppError) {
    return { status: err.statusCode, body: { error: { code: err.code, message: err.message } } };
  }
  if (e && typeof e.statusCode === "number" && e.statusCode < 500) {
    return { status: e.statusCode, body: { error: { code: e.code ?? "BAD_REQUEST", message: e.message ?? "Bad request" } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } } };
}

function friendlyContractMessage(name: string): string {
  const messages: Record<string, string> = {
    NotFound: "Lease not found on chain",
    Unauthorized: "Not allowed to do this",
    InvalidTerms: "The lease terms are not valid",
    InvalidState: "This action is not allowed in the lease's current state",
    InvalidAmount: "The amount is not valid",
    AlreadyActive: "The lease is already active",
    NotDefaulted: "The lease is not in default",
    RepossessionTooEarly: "It is too early to repossess",
    Overpayment: "The payment is more than the remaining balance",
    MathOverflow: "Amount too large",
  };
  return messages[name] ?? name;
}

export class ApiError extends AppError {}
export const forbidden = (message = "You do not have access to this") => new ApiError(message, 403, "FORBIDDEN");
export const notFound = (message = "Not found") => new ApiError(message, 404, "NOT_FOUND");
export const unauthorized = (message = "Please log in") => new ApiError(message, 401, "UNAUTHORIZED");
export const badRequest = (message: string, code = "BAD_REQUEST") => new ApiError(message, 400, code);
export const conflict = (message: string, code = "CONFLICT") => new ApiError(message, 409, code);
