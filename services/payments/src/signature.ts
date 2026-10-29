import crypto from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Paystack signs the RAW request body with HMAC-SHA512 using the secret key (x-paystack-signature). */
export function verifyPaystackSignature(rawBody: string, signature: string | undefined, secretKey: string | undefined): boolean {
  if (!secretKey || !signature) return false;
  const expected = crypto.createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex");
  return safeEqual(expected, signature);
}

/** Flutterwave sends the configured secret hash verbatim in the `verif-hash` header. */
export function verifyFlutterwaveHash(header: string | undefined, secretHash: string | undefined): boolean {
  if (!secretHash || !header) return false;
  return safeEqual(secretHash, header);
}
