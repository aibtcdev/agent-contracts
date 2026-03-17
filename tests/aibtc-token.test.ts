import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const tokenContract = `${deployer}.aibtc-token`;
const mockSbtc = `${deployer}.mock-sbtc`;
const heartbeat = `${deployer}.heartbeat`;

// Helper: mint mock sBTC to a wallet for testing
function mintSbtc(to: string, amount: number) {
  return simnet.callPublicFn(
    mockSbtc,
    "mint",
    [Cl.uint(amount), Cl.principal(to)],
    deployer
  );
}

describe("aibtc-token", () => {
  describe("metadata", () => {
    it("returns correct name", () => {
      const { result } = simnet.callReadOnlyFn(tokenContract, "get-name", [], deployer);
      expect(result).toBeOk(Cl.stringAscii("AIBTC Token"));
    });

    it("returns correct symbol", () => {
      const { result } = simnet.callReadOnlyFn(tokenContract, "get-symbol", [], deployer);
      expect(result).toBeOk(Cl.stringAscii("AIBTC"));
    });

    it("returns 8 decimals", () => {
      const { result } = simnet.callReadOnlyFn(tokenContract, "get-decimals", [], deployer);
      expect(result).toBeOk(Cl.uint(8));
    });
  });

  describe("deposit()", () => {
    it("mints 1:1 AIBTC for sBTC deposited (no tax)", () => {
      mintSbtc(wallet1, 100000);
      const { result } = simnet.callPublicFn(
        tokenContract,
        "deposit",
        [Cl.uint(100000)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(100000));
    });

    it("updates balance correctly", () => {
      mintSbtc(wallet1, 50000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(50000)], wallet1);
      const { result } = simnet.callReadOnlyFn(
        tokenContract,
        "get-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(50000));
    });

    it("updates total backing", () => {
      mintSbtc(wallet1, 75000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(75000)], wallet1);
      const { result } = simnet.callReadOnlyFn(
        tokenContract,
        "get-total-backing",
        [],
        deployer
      );
      expect(result).toBeUint(75000);
    });

    it("records heartbeat on deposit", () => {
      mintSbtc(wallet1, 10000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(10000)], wallet1);
      const { result } = simnet.callReadOnlyFn(
        heartbeat,
        "is-active",
        [Cl.principal(wallet1), Cl.uint(1008)],
        deployer
      );
      expect(result).toBeBool(true);
    });

    it("rejects zero deposit", () => {
      const { result } = simnet.callPublicFn(
        tokenContract,
        "deposit",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(2003));
    });
  });

  describe("withdraw()", () => {
    it("returns sBTC 1:1 for burned AIBTC", () => {
      mintSbtc(wallet1, 100000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(100000)], wallet1);
      const { result } = simnet.callPublicFn(
        tokenContract,
        "withdraw",
        [Cl.uint(50000)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(50000));
    });

    it("reduces balance and backing", () => {
      mintSbtc(wallet1, 100000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(100000)], wallet1);
      simnet.callPublicFn(tokenContract, "withdraw", [Cl.uint(40000)], wallet1);

      const balance = simnet.callReadOnlyFn(
        tokenContract,
        "get-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance.result).toBeOk(Cl.uint(60000));

      const backing = simnet.callReadOnlyFn(
        tokenContract,
        "get-total-backing",
        [],
        deployer
      );
      expect(backing.result).toBeUint(60000);
    });

    it("rejects withdraw exceeding balance", () => {
      mintSbtc(wallet1, 10000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(10000)], wallet1);
      const { result } = simnet.callPublicFn(
        tokenContract,
        "withdraw",
        [Cl.uint(20000)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(2002));
    });

    it("rejects zero withdraw", () => {
      const { result } = simnet.callPublicFn(
        tokenContract,
        "withdraw",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(2003));
    });
  });

  describe("transfer()", () => {
    it("allows owner to transfer tokens", () => {
      mintSbtc(wallet1, 100000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(100000)], wallet1);
      const { result } = simnet.callPublicFn(
        tokenContract,
        "transfer",
        [Cl.uint(25000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("rejects transfer from non-owner", () => {
      mintSbtc(wallet1, 100000);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(100000)], wallet1);
      const { result } = simnet.callPublicFn(
        tokenContract,
        "transfer",
        [Cl.uint(25000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet2 // not the token owner
      );
      expect(result).toBeErr(Cl.uint(2001));
    });
  });

  describe("total supply", () => {
    it("tracks total supply correctly through deposits and withdrawals", () => {
      mintSbtc(wallet1, 100000);
      mintSbtc(wallet2, 50000);

      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(100000)], wallet1);
      simnet.callPublicFn(tokenContract, "deposit", [Cl.uint(50000)], wallet2);

      let supply = simnet.callReadOnlyFn(tokenContract, "get-total-supply", [], deployer);
      expect(supply.result).toBeOk(Cl.uint(150000));

      simnet.callPublicFn(tokenContract, "withdraw", [Cl.uint(30000)], wallet1);

      supply = simnet.callReadOnlyFn(tokenContract, "get-total-supply", [], deployer);
      expect(supply.result).toBeOk(Cl.uint(120000));
    });
  });
});
