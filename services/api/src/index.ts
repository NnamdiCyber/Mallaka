export * from "./app.js";
export * from "./types.js";
export * from "./checkout.js";
export * from "./errors.js";
export { startApi } from "./server.js";

import { startApi } from "./server.js";

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startApi().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
