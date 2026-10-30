import { describe, it } from "node:test";
import assert from "node:assert";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const validBaseEnv: NodeJS.ProcessEnv = {
    STELLAR_NETWORK: "testnet",
    SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
    LEASE_CONTRACT_ID: "CDNKLGLDN64SFB3WIOVAMA7Q4LILLO2H27HWIXFTXTXTK7UO5ERF5TJE",
    DATABASE_URL: "postgresql://mallaka:mallaka@localhost:5432/mallaka",
  };

  it("loads valid minimal configuration successfully", () => {
    const config = loadConfig(validBaseEnv);
    assert.strictEqual(config.STELLAR_NETWORK, "testnet");
    assert.strictEqual(config.SOROBAN_RPC_URL, "https://soroban-testnet.stellar.org");
    assert.strictEqual(config.LEASE_CONTRACT_ID, "CDNKLGLDN64SFB3WIOVAMA7Q4LILLO2H27HWIXFTXTXTK7UO5ERF5TJE");
    assert.strictEqual(config.DATABASE_URL, "postgresql://mallaka:mallaka@localhost:5432/mallaka");
    assert.strictEqual(config.KEEPER_INTERVAL_SECONDS, 60); // default
  });

  it("parses optional numerical fields properly", () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv,
      SPONSOR_MIN_BALANCE: "250.5",
      KEEPER_INTERVAL_SECONDS: "30",
    };
    const config = loadConfig(env);
    assert.strictEqual(config.SPONSOR_MIN_BALANCE, 250.5);
    assert.strictEqual(config.KEEPER_INTERVAL_SECONDS, 30);
  });

  it("fails fast with clear error when required fields are missing", () => {
    assert.throws(
      () => loadConfig({}),
      (err: Error) => {
        assert(err.message.includes("[ConfigError]"));
        assert(err.message.includes("STELLAR_NETWORK"));
        assert(err.message.includes("SOROBAN_RPC_URL"));
        assert(err.message.includes("LEASE_CONTRACT_ID"));
        assert(err.message.includes("DATABASE_URL"));
        return true;
      }
    );
  });

  it("fails when STELLAR_NETWORK is invalid", () => {
    assert.throws(
      () =>
        loadConfig({
          ...validBaseEnv,
          STELLAR_NETWORK: "rinkeby" as any,
        }),
      (err: Error) => {
        assert(err.message.includes("STELLAR_NETWORK"));
        return true;
      }
    );
  });

  it("fails when SOROBAN_RPC_URL is not a valid URL", () => {
    assert.throws(
      () =>
        loadConfig({
          ...validBaseEnv,
          SOROBAN_RPC_URL: "not-a-url",
        }),
      (err: Error) => {
        assert(err.message.includes("SOROBAN_RPC_URL"));
        return true;
      }
    );
  });

  it("strictly requires KMS_KEY_ID when STELLAR_NETWORK is mainnet", () => {
    assert.throws(
      () =>
        loadConfig({
          ...validBaseEnv,
          STELLAR_NETWORK: "mainnet",
        }),
      (err: Error) => {
        assert(err.message.includes("KMS_KEY_ID"));
        assert(err.message.includes("forbidden on mainnet"));
        return true;
      }
    );

    const validMainnet = loadConfig({
      ...validBaseEnv,
      STELLAR_NETWORK: "mainnet",
      KMS_KEY_ID: "projects/mallaka-prod/locations/global/keyRings/mallaka/cryptoKeys/sponsor",
    });
    assert.strictEqual(validMainnet.STELLAR_NETWORK, "mainnet");
    assert.strictEqual(
      validMainnet.KMS_KEY_ID,
      "projects/mallaka-prod/locations/global/keyRings/mallaka/cryptoKeys/sponsor"
    );
  });
});
