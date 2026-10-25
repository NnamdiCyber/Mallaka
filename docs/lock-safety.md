# Lock Safety Rules

This document is a checklist of the safety rules from README section 11 (Lock and Immobilizer Integration).

## Mandatory Safety Rules

- [ ] **Never immobilize a moving vehicle.** Engage only when the vehicle is stationary and the engine is off, or at the next stop.
- [ ] **Notify first.** The rider receives SMS and app notifications at `Grace` entry and before any lock.
- [ ] **Release instantly.** On `cured` or `completed`, the unlock command is sent immediately and retried until acknowledged.
- [ ] **Fail open.** If the bridge cannot confirm contract state, it does not lock.
- [ ] **Every command is logged** with a trigger, timestamp, and result.
- [ ] **Local law applies.** Remote immobilization and repossession rules vary by jurisdiction.

## Lock Bridge Validation

The lock bridge must:

- [ ] Re-read on-chain state before every command (do not trust the event alone)
- [ ] Verify lease is still `Defaulted` on-chain
- [ ] Verify safety rules pass
- [ ] Send command to device vendor API / MQTT
- [ ] Log result in `lock_commands`

## Phases

| Phase | Mechanism | Purpose |
|-------|-----------|---------|
| 1 | Manual lock toggled by lessor from dashboard | Validate business model before buying hardware |
| 2 | Off-the-shelf GPS tracker with immobilizer relay via vendor API | Automated, low-cost enforcement |
| 3 | Custom ESP32-based device | Specialized needs such as farm machinery |

> The IoT device never holds a wallet or private key. It only receives authenticated commands from the bridge.

See [README section 11](README.md#11-lock-and-immobilizer-integration) for the complete lock safety specification.