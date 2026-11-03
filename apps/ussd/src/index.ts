export * from "./menu.js";
export * from "./server.js";

import { startUssdService } from "./server.js";

// Run directly when called via node/tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  startUssdService().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("USSD service failed to start:", err);
    process.exit(1);
  });
}
