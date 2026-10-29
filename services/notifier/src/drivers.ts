import { createLogger, type Logger } from "@mallaka/shared";
import type { NotificationDriver } from "./types.js";

/** Masks all but the last 4 digits so logs never carry a full phone number. */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

/** Development driver: prints the message. Never use in production (it would print OTP codes). */
export class ConsoleDriver implements NotificationDriver {
  readonly name = "console";
  readonly sent: { to: string; text: string }[] = [];
  constructor(private readonly logger: Logger = createLogger("notifier:console")) {}

  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
    // eslint-disable-next-line no-console
    console.log(`[notifier:console] to=${maskPhone(to)} message="${text}"`);
  }
}

export interface AfricasTalkingOptions {
  apiKey: string;
  username: string;
  /** Override for tests. Sandbox: https://api.sandbox.africastalking.com/version1/messaging */
  endpoint?: string;
  fetchFn?: typeof fetch;
}

/** Africa's Talking SMS driver (README 13). Credentials come from AFRICASTALKING_* env vars. */
export class AfricasTalkingDriver implements NotificationDriver {
  readonly name = "africastalking";
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: AfricasTalkingOptions) {
    this.endpoint = opts.endpoint ?? "https://api.africastalking.com/version1/messaging";
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async send(to: string, text: string): Promise<void> {
    const body = new URLSearchParams({ username: this.opts.username, to, message: text });
    const res = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        apiKey: this.opts.apiKey,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Africa's Talking SMS failed with HTTP ${res.status}`);
    }
  }
}

/** Console driver unless Africa's Talking credentials are configured. */
export function driverFromConfig(config: { AFRICASTALKING_API_KEY?: string; AFRICASTALKING_USERNAME?: string }): NotificationDriver {
  if (config.AFRICASTALKING_API_KEY && config.AFRICASTALKING_USERNAME) {
    return new AfricasTalkingDriver({ apiKey: config.AFRICASTALKING_API_KEY, username: config.AFRICASTALKING_USERNAME });
  }
  return new ConsoleDriver();
}
