import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import type { ApiDeps } from "./types.js";

/** Builds the app with inert dependencies and returns the generated OpenAPI document. */
export async function generateOpenApi(): Promise<string> {
  const never = new Proxy({}, { get: () => () => Promise.reject(new Error("not used for OpenAPI generation")) });
  const app = await buildApp({
    db: never,
    chain: never,
    otp: never,
    fx: never,
    payQueue: never,
    checkout: {},
    jwtSecret: "x".repeat(32),
    contracts: { titleRegistry: "", token: "" },
    manualLockApprovalThreshold: 0n,
  } as unknown as ApiDeps);
  await app.ready();
  const doc = JSON.stringify(app.swagger(), null, 2) + "\n";
  await app.close();
  return doc;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const OPENAPI_PATH = path.resolve(here, "../../../docs/openapi.json");

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  fs.writeFileSync(OPENAPI_PATH, await generateOpenApi());
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OPENAPI_PATH}`);
}
