import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const contractName = `${deployer}.heartbeat`;

describe("heartbeat", () => {
  describe("beat()", () => {
    it("records liveness for an agent", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "beat",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("updates last-seen block for the agent", () => {
      simnet.callPublicFn(contractName, "beat", [Cl.principal(wallet1)], deployer);
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-last-seen",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalSome);
    });

    it("increments total-agents on first beat", () => {
      // Before any beats
      let { result } = simnet.callReadOnlyFn(
        contractName,
        "get-total-agents",
        [],
        deployer
      );
      expect(result).toBeUint(0);

      // First beat for wallet1
      simnet.callPublicFn(contractName, "beat", [Cl.principal(wallet1)], deployer);
      ({ result } = simnet.callReadOnlyFn(
        contractName,
        "get-total-agents",
        [],
        deployer
      ));
      expect(result).toBeUint(1);

      // Second beat for same wallet — should NOT increment
      simnet.callPublicFn(contractName, "beat", [Cl.principal(wallet1)], deployer);
      ({ result } = simnet.callReadOnlyFn(
        contractName,
        "get-total-agents",
        [],
        deployer
      ));
      expect(result).toBeUint(1);

      // Beat for wallet2 — should increment
      simnet.callPublicFn(contractName, "beat", [Cl.principal(wallet2)], deployer);
      ({ result } = simnet.callReadOnlyFn(
        contractName,
        "get-total-agents",
        [],
        deployer
      ));
      expect(result).toBeUint(2);
    });

    it("rejects self-beat (contract calling beat for itself)", () => {
      // Calling beat with the contract's own address should fail
      const contractPrincipal = contractName;
      const { result } = simnet.callPublicFn(
        contractName,
        "beat",
        [Cl.principal(contractPrincipal)],
        deployer
      );
      expect(result).toBeErr(Cl.uint(1000));
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

    it("updates last-seen for tx-sender", () => {
      simnet.callPublicFn(contractName, "check-in", [], wallet1);
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-last-seen",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalSome);
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
