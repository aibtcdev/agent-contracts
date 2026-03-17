import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const contractName = `${deployer}.btc-binding`;

describe("btc-binding", () => {
  describe("get-challenge()", () => {
    it("returns the challenge bytes", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-challenge",
        [],
        deployer
      );
      expect(result.type).toBe(ClarityType.Buffer);
    });
  });

  describe("is-bound()", () => {
    it("returns false for unbound principal", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "is-bound",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result).toBeBool(false);
    });
  });

  describe("get-btc-key()", () => {
    it("returns none for unbound principal", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-btc-key",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.type).toBe(ClarityType.OptionalNone);
    });
  });

  describe("get-total-bindings()", () => {
    it("starts at 0", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-total-bindings",
        [],
        deployer
      );
      expect(result).toBeUint(0);
    });
  });

  describe("bind-btc()", () => {
    it("rejects invalid signature (wrong length)", () => {
      // 32-byte buffer instead of 65
      const badSig = Cl.buffer(new Uint8Array(32));
      const { result } = simnet.callPublicFn(
        contractName,
        "bind-btc",
        [badSig],
        wallet1
      );
      // Should fail with type error or invalid signature
      expect(result.type).toBe(ClarityType.ResponseErr);
    });

    it("rejects invalid signature (65 bytes but wrong content)", () => {
      // 65 bytes of zeros - invalid recoverable signature
      const badSig = Cl.buffer(new Uint8Array(65));
      const { result } = simnet.callPublicFn(
        contractName,
        "bind-btc",
        [badSig],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(4000)); // ERR_INVALID_SIGNATURE
    });
  });

  describe("unbind-btc()", () => {
    it("fails when no binding exists", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "unbind-btc",
        [],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(4001)); // ERR_KEY_MISMATCH
    });
  });
});
