/**
 * Device adapter interface (README 11). The device only ever receives
 * authenticated lock/unlock commands. It NEVER holds a wallet or private key,
 * and nothing here sends one.
 */
export interface DeviceState {
  reachable: boolean;
  /** Speed is zero. */
  stationary: boolean;
  /** Ignition is off. */
  engineOff: boolean;
}

export interface DeviceCommand {
  deviceId: string;
  command: "lock" | "unlock";
  /** lock_commands.id, so the vendor/lessor can correlate. */
  commandId: string;
}

export interface DeviceResult {
  /** True once the device (or vendor) confirmed it executed the command. */
  acknowledged: boolean;
  detail?: Record<string, unknown>;
}

export interface DeviceAdapter {
  readonly name: string;
  /** False for drivers that cannot see the vehicle (manual): a human checks the safety rules. */
  readonly reportsState: boolean;
  getState(deviceId: string): Promise<DeviceState>;
  /** Sends a command. Throws on transport errors. */
  send(cmd: DeviceCommand): Promise<DeviceResult>;
}

/**
 * Phase 1: records the intent so the lessor dashboard can action it. Nothing is
 * transmitted. The command stays 'sent' (awaiting a human) rather than 'acknowledged'.
 */
export class ManualDriver implements DeviceAdapter {
  readonly name = "manual";
  readonly reportsState = false;
  readonly intents: DeviceCommand[] = [];

  async getState(): Promise<DeviceState> {
    return { reachable: true, stationary: true, engineOff: true };
  }

  async send(cmd: DeviceCommand): Promise<DeviceResult> {
    this.intents.push(cmd);
    return { acknowledged: false, detail: { manual: true, note: "Intent recorded for the lessor dashboard" } };
  }
}

/** Test and E2E device with scriptable state and acknowledgements. */
export class MockDevice implements DeviceAdapter {
  readonly name = "mock";
  readonly reportsState = true;
  state: DeviceState = { reachable: true, stationary: true, engineOff: true };
  sent: DeviceCommand[] = [];
  /** Number of upcoming sends that fail with a transport error. */
  failSends = 0;
  /** Number of upcoming sends that are delivered but not acknowledged. */
  withholdAcks = 0;
  /** Last command each device acknowledged. */
  locked = new Map<string, boolean>();

  async getState(): Promise<DeviceState> {
    return { ...this.state };
  }

  async send(cmd: DeviceCommand): Promise<DeviceResult> {
    this.sent.push(cmd);
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error("device unreachable");
    }
    if (this.withholdAcks > 0) {
      this.withholdAcks--;
      return { acknowledged: false };
    }
    this.locked.set(cmd.deviceId, cmd.command === "lock");
    return { acknowledged: true };
  }
}

export interface VendorHttpOptions {
  baseUrl: string;
  /** LOCK_VENDOR_API_KEY. The only credential the vendor API gets. */
  apiKey: string;
  fetchFn?: typeof fetch;
}

/**
 * SKELETON for a typical GPS tracker + immobilizer relay HTTP API.
 * UNTESTED against real hardware or a real vendor. Endpoint paths and payload
 * shapes are assumptions modelled on common vendor APIs; adjust per vendor docs
 * before any pilot. Authenticated with LOCK_VENDOR_API_KEY only.
 */
export class VendorHttpDriver implements DeviceAdapter {
  readonly name = "vendor-http";
  readonly reportsState = true;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: VendorHttpOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private headers() {
    return { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" };
  }

  async getState(deviceId: string): Promise<DeviceState> {
    const res = await this.fetchFn(`${this.opts.baseUrl}/devices/${encodeURIComponent(deviceId)}/status`, { headers: this.headers() });
    if (!res.ok) return { reachable: false, stationary: false, engineOff: false };
    // Assumed shape: { online: boolean, speed_kmh: number, ignition: "on" | "off" }
    const b = (await res.json()) as { online?: boolean; speed_kmh?: number; ignition?: string };
    return { reachable: b.online !== false, stationary: (b.speed_kmh ?? 1) === 0, engineOff: b.ignition === "off" };
  }

  async send(cmd: DeviceCommand): Promise<DeviceResult> {
    const res = await this.fetchFn(`${this.opts.baseUrl}/devices/${encodeURIComponent(cmd.deviceId)}/immobilizer`, {
      method: "POST",
      headers: this.headers(),
      // Assumed shape. Contains a command id and an action. No keys, no wallet data.
      body: JSON.stringify({ action: cmd.command === "lock" ? "engage" : "release", reference: cmd.commandId }),
    });
    if (!res.ok) throw new Error(`Vendor API returned HTTP ${res.status}`);
    const b = (await res.json().catch(() => ({}))) as { acknowledged?: boolean; status?: string };
    return { acknowledged: b.acknowledged === true || b.status === "ok" };
  }
}

export interface MqttPublisher {
  /** Publishes and resolves with the device's ack payload, or null on timeout. */
  request(topic: string, payload: string, ackTimeoutMs: number): Promise<string | null>;
}

/**
 * Optional MQTT transport (MQTT_URL) behind the same interface. Topics:
 *   mallaka/devices/<id>/command  (we publish)   mallaka/devices/<id>/state (retained, device publishes)
 * Credentials belong to the MQTT connection, never to the payload. UNTESTED against a real broker.
 */
export class MqttDriver implements DeviceAdapter {
  readonly name = "mqtt";
  readonly reportsState = true;
  constructor(
    private readonly client: MqttPublisher,
    private readonly readState: (deviceId: string) => Promise<DeviceState>,
    private readonly ackTimeoutMs = 10_000
  ) {}

  getState(deviceId: string): Promise<DeviceState> {
    return this.readState(deviceId);
  }

  async send(cmd: DeviceCommand): Promise<DeviceResult> {
    const ack = await this.client.request(
      `mallaka/devices/${cmd.deviceId}/command`,
      JSON.stringify({ command: cmd.command, reference: cmd.commandId }),
      this.ackTimeoutMs
    );
    return { acknowledged: ack !== null };
  }
}
