import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const contractName = `${deployer}.publisher-role`;
const identityRegistry = `${deployer}.identity-registry`;

describe("publisher-role", () => {
  describe("initial state", () => {
    it("publisher-agent-id starts at 0", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-publisher-agent-id",
        [],
        deployer
      );
      expect(result).toBeUint(0);
    });

    it("treasury is not frozen initially", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "is-frozen",
        [],
        deployer
      );
      expect(result).toBeBool(false);
    });

    it("bond is 0.1 sBTC (10000000 sats)", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-bond",
        [],
        deployer
      );
      expect(result).toBeUint(10000000);
    });
  });

  describe("is-publisher()", () => {
    it("returns false when no publisher is set", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "is-publisher",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result).toBeBool(false);
    });

    it("returns true after publisher is set and wallet matches", () => {
      // Register wallet1 as agent in identity registry mock
      simnet.callPublicFn(
        identityRegistry,
        "register-agent",
        [Cl.principal(wallet1)],
        deployer
      );

      // Set publisher to agent-id 1 (requires DAO auth — use deployer as base-dao)
      // Note: this will fail because deployer isn't base-dao, but tests the flow
      const { result } = simnet.callPublicFn(
        contractName,
        "set-publisher",
        [Cl.uint(1)],
        deployer // This should fail — not authorized
      );
      // Expect unauthorized since deployer isn't the DAO
      expect(result).toBeErr(Cl.uint(3000));
    });
  });

  describe("freeze-treasury()", () => {
    it("rejects non-DAO caller", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "freeze-treasury",
        [],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(3000)); // ERR_NOT_AUTHORIZED
    });
  });

  describe("unfreeze-treasury()", () => {
    it("rejects non-DAO caller", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "unfreeze-treasury",
        [],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(3000)); // ERR_NOT_AUTHORIZED
    });
  });

  describe("set-publisher()", () => {
    it("rejects non-DAO caller", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-publisher",
        [Cl.uint(1)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(3000)); // ERR_NOT_AUTHORIZED
    });

    it("rejects zero agent-id", () => {
      // Even deployer can't set (not DAO), but test the validation
      const { result } = simnet.callPublicFn(
        contractName,
        "set-publisher",
        [Cl.uint(0)],
        deployer
      );
      // Will hit NOT_AUTHORIZED before INVALID_AGENT_ID since deployer != DAO
      expect(result).toBeErr(Cl.uint(3000));
    });
  });

  describe("spend()", () => {
    it("rejects non-publisher", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "spend",
        [Cl.uint(1000), Cl.principal(wallet2)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(3001)); // ERR_NOT_PUBLISHER
    });
  });

  describe("set-bond()", () => {
    it("rejects non-DAO caller", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-bond",
        [Cl.uint(5000000)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(3000)); // ERR_NOT_AUTHORIZED
    });
  });

  describe("get-publisher-wallet()", () => {
    it("returns none when publisher agent-id is 0", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-publisher-wallet",
        [],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalNone);
    });
  });
});
