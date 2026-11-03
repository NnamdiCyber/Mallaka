# Runbook: Lock Bridge Stuck or IoT Device Unreachable

## Overview
The Mallaka Lock Bridge enforces remote immobilizer commands based on lease default events. The bridge enforces strict safety rules:
1. **Never immobilize a moving vehicle** (`stationary: true`, `engineOff: true` required).
2. **Grace notice and pre-lock notice must exist** before immobilizing.
3. **Fail open** if connectivity or chain status is ambiguous.

---

## Symptoms & Alerts
- Alert `lock_bridge_command_deferred`: High number of lock commands in `queued` status waiting for vehicle stop or connection.
- Device unreachable errors: `device_unreachable` logged in `lock_commands.result_details`.
- Lessor complaint: Lease is Defaulted, but vehicle is not locked.

---

## Diagnostic Procedure

### 1. Inspect Queued Commands in Database
```sql
SELECT id, lease_id, device_id, command, status, result_details, created_at
FROM lock_commands
WHERE status = 'queued'
ORDER BY created_at DESC;
```
Common reasons in `result_details`:
- `vehicle_in_use_waiting_for_next_stop`: Normal behavior. Vehicle is in motion. The sweeper will execute when the engine is turned off.
- `pre_lock_waiting_period`: Notice period (default 24h) has not elapsed.
- `device_unreachable`: Cellular modem / tracker lost network connection.

### 2. Check IoT Telematics Provider Status
If tracker vendor API / MQTT broker is unreachable:
1. Test tracker vendor endpoint:
   ```bash
   curl -I -H "Authorization: Bearer $LOCK_VENDOR_API_KEY" "$LOCK_VENDOR_API_URL/health"
   ```
2. Verify MQTT broker connectivity:
   ```bash
   mosquitto_sub -h "$MQTT_HOST" -p 8883 -u "$MQTT_USER" -P "$MQTT_PASS" -t "devices/+/telemetry"
   ```

### 3. Emergency Manual Override
If a vehicle was immobilized in an unsafe situation (e.g., rider medical emergency or payment cured but device offline):
1. Use Lessor Dashboard or Lessor Staff API to issue an immediate `unlock`:
   ```bash
   curl -X POST "https://api.mallaka.example.com/v1/leases/$LEASE_ID/unlock" \
     -H "Authorization: Bearer $STAFF_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Emergency rider roadside assistance"}'
   ```
2. Dispatches priority unlock queue job and logs to `audit_log`.
