#!/usr/bin/env node
import { main } from "../packages/shared/src/db/seed.js";

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Seed script failed:", err);
  process.exit(1);
});
