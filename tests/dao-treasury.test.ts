import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

// contract info
const treasuryAddress = `${deployer}.dao-treasury`;
const baseDaoAddress = `${deployer}.base-dao`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const daoTokenAddress = `${deployer}.dao-token`;

// Error codes
const ERR_NOT_DAO_OR_EXTENSION = 1900;
const ERR_ASSET_NOT_ALLOWED = 1901;

// Helper function to mint mock sBTC to a wallet
function mintMockSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
}

describe("dao-treasury: initial state", function () {
  it("get-contract-info() returns valid contract info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
  });

  it("is-allowed-asset() returns false for any asset initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-allowed-asset() returns none for any asset initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "get-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });
});

describe("dao-treasury: callback", function () {
  it("callback() succeeds for any caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "callback",
      [Cl.principal(wallet1), Cl.buffer(new Uint8Array(34))],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("dao-treasury: allow-asset", function () {
  it("allow-asset() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "allow-asset",
      [Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("allow-asset() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "allow-asset",
      [Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });
});

describe("dao-treasury: deposit-ft", function () {
  it("deposit-ft() fails when asset is not allowed", function () {
    // arrange
    const amount = 1000000;
    mintMockSbtc(amount, wallet1);
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ASSET_NOT_ALLOWED));
  });

  it("deposit-ft() fails even with valid token if not allowed", function () {
    // arrange
    const amount = 500000;
    mintMockSbtc(amount, wallet2);
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      wallet2
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ASSET_NOT_ALLOWED));
  });
});

describe("dao-treasury: withdraw-ft", function () {
  it("withdraw-ft() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(1000), Cl.principal(wallet1)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("withdraw-ft() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(1000), Cl.principal(wallet1)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });
});

describe("dao-treasury: authorization pattern", function () {
  it("only DAO or extensions can allow assets", function () {
    // arrange
    // act
    const result1 = simnet.callPublicFn(
      treasuryAddress,
      "allow-asset",
      [Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    const result2 = simnet.callPublicFn(
      treasuryAddress,
      "allow-asset",
      [Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet2
    );
    // assert
    expect(result1.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
    expect(result2.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("only DAO or extensions can withdraw", function () {
    // arrange
    // act
    const result1 = simnet.callPublicFn(
      treasuryAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(1000), Cl.principal(wallet1)],
      wallet1
    );
    const result2 = simnet.callPublicFn(
      treasuryAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(1000), Cl.principal(wallet2)],
      wallet2
    );
    // assert
    expect(result1.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
    expect(result2.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("deposits require allowed assets, not authorization", function () {
    // arrange
    const amount = 100000;
    mintMockSbtc(amount, wallet1);
    // act - even though wallet1 is not authorized, error is about asset not allowed
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      wallet1
    );
    // assert - fails on asset check, not auth check
    expect(receipt.result).toBeErr(Cl.uint(ERR_ASSET_NOT_ALLOWED));
  });
});

describe("dao-treasury: read-only functions", function () {
  it("is-allowed-asset() returns false for unknown asset", function () {
    // arrange
    const unknownAsset = `${deployer}.unknown-token`;
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(unknownAsset)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-allowed-asset() returns none for unknown asset", function () {
    // arrange
    const unknownAsset = `${deployer}.unknown-token`;
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "get-allowed-asset",
      [Cl.principal(unknownAsset)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-contract-info() can be called by anyone", function () {
    // arrange
    // act
    const result1 = simnet.callReadOnlyFn(
      treasuryAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    const result2 = simnet.callReadOnlyFn(
      treasuryAddress,
      "get-contract-info",
      [],
      wallet1
    ).result;
    // assert
    expect(result1.type).toBe(ClarityType.Tuple);
    expect(result2.type).toBe(ClarityType.Tuple);
  });
});

describe("dao-treasury: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_NOT_DAO_OR_EXTENSION).toBe(1900);
    expect(ERR_ASSET_NOT_ALLOWED).toBe(1901);
  });
});
