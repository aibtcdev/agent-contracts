import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const contractName = `${deployer}.heartbeat`;

describe("heartbeat", () => {
  describe("beat()", () => {
    it("rejects non-DAO caller", () => {
      // beat() is now restricted to DAO contracts/extensions
      const { result } = simnet.callPublicFn(
        contractName,
        "beat",
        [Cl.principal(wallet1)],
        wallet1 // Not the DAO — should fail
      );
      expect(result).toBeErr(Cl.uint(1001)); // ERR_NOT_AUTHORIZED
    });

    it("rejects self-beat (contract calling beat for itself)", () => {
      const contractPrincipal = contractName;
      const { result } = simnet.callPublicFn(
        contractName,
        "beat",
        [Cl.principal(contractPrincipal)],
        deployer
      );
      // Will hit NOT_AUTHORIZED (deployer isn't DAO) before CANNOT_BEAT_SELF
      expect(result.type).toBe(ClarityType.ResponseErr);
    });
  });

  describe("check-in()", () => {
    it("records liveness for tx-sender", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "check-in",
        [],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("updates last-seen with block metadata for tx-sender", () => {
      simnet.callPublicFn(contractName, "check-in", [], wallet1);
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-last-seen",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalSome);
      // The value should be a tuple with stacks-block, burn-block, timestamp
    });
  });

  describe("is-active()", () => {
    it("returns false for unknown agent", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "is-active",
        [Cl.principal(wallet2), Cl.uint(1008)],
        deployer
      );
      expect(result).toBeBool(false);
    });

    it("returns true for recently active agent", () => {
      simnet.callPublicFn(contractName, "check-in", [], wallet1);
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "is-active",
        [Cl.principal(wallet1), Cl.uint(1008)],
        deployer
      );
      expect(result).toBeBool(true);
    });

    it("returns false when agent exceeds threshold", () => {
      simnet.callPublicFn(contractName, "check-in", [], wallet1);
      // Mine enough blocks to exceed threshold
      simnet.mineEmptyBlocks(10);
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "is-active",
        [Cl.principal(wallet1), Cl.uint(5)],
        deployer
      );
      expect(result).toBeBool(false);
    });
  });

  describe("get-blocks-since()", () => {
    it("returns none for unknown agent", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-blocks-since",
        [Cl.principal(wallet2)],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalNone);
    });

    it("returns block count since last activity", () => {
      simnet.callPublicFn(contractName, "check-in", [], wallet1);
      simnet.mineEmptyBlocks(5);
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-blocks-since",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalSome);
    });
  });

  describe("get-info()", () => {
    it("returns contract info", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-info",
        [],
        deployer
      );
      expect(result.type).toBe(ClarityType.Tuple);
    });
  });
});
