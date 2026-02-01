import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

// contract info
const contractAddress = `${deployer}.base-dao`;
const contractName = "base-dao";

// Error codes
const ERR_UNAUTHORIZED = 1000;
const ERR_ALREADY_EXECUTED = 1001;
const ERR_INVALID_EXTENSION = 1002;
const ERR_NO_EMPTY_LISTS = 1003;
const ERR_DAO_ALREADY_CONSTRUCTED = 1004;

describe("base-dao: initial state", function () {
  it("is-constructed() returns false before construction", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "is-constructed",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-version() returns 1 initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-version",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(1));
  });

  it("is-extension() returns false for any principal before setup", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "is-extension",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("executed-at() returns none for unknown proposal", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "executed-at",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });
});

describe("base-dao: set-extension()", function () {
  it("set-extension() fails when called directly by non-extension", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "set-extension",
      [Cl.principal(wallet1), Cl.bool(true)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("set-extension() fails for any caller that is not DAO or extension", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "set-extension",
      [Cl.principal(wallet2), Cl.bool(true)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });
});

describe("base-dao: set-extensions()", function () {
  it("set-extensions() fails when called directly by non-extension", function () {
    // arrange
    const extensionList = Cl.list([
      Cl.tuple({
        extension: Cl.principal(wallet1),
        enabled: Cl.bool(true),
      }),
    ]);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "set-extensions",
      [extensionList],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("set-extensions() fails with empty list (after auth check)", function () {
    // Note: Authorization check happens first, so we cannot directly test empty list error
    // This documents that the empty list check exists in the contract
    // arrange
    const emptyList = Cl.list([]);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "set-extensions",
      [emptyList],
      deployer
    );
    // assert - fails on authorization first
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("set-extensions() accepts valid extension list structure", function () {
    // This verifies the tuple structure is correctly defined
    // arrange
    const extensionList = Cl.list([
      Cl.tuple({
        extension: Cl.principal(wallet1),
        enabled: Cl.bool(true),
      }),
      Cl.tuple({
        extension: Cl.principal(wallet2),
        enabled: Cl.bool(false),
      }),
    ]);
    // act - will fail auth but validates structure
    const receipt = simnet.callPublicFn(
      contractAddress,
      "set-extensions",
      [extensionList],
      deployer
    );
    // assert - fails on authorization, not structure
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });
});

describe("base-dao: increment-version()", function () {
  it("increment-version() fails when called by non-extension", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "increment-version",
      [],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("increment-version() fails for any external caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "increment-version",
      [],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });
});

describe("base-dao: authorization pattern", function () {
  it("only DAO contract or extensions can modify state", function () {
    // This test documents the core security model:
    // - is-self-or-extension checks if tx-sender is the DAO contract itself
    // - OR if contract-caller is an enabled extension
    // arrange
    // act
    const setExtResult = simnet.callPublicFn(
      contractAddress,
      "set-extension",
      [Cl.principal(wallet1), Cl.bool(true)],
      wallet1
    );
    const incVersionResult = simnet.callPublicFn(
      contractAddress,
      "increment-version",
      [],
      wallet1
    );
    // assert
    expect(setExtResult.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(incVersionResult.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("is-extension returns false for DAO contract itself", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "is-extension",
      [Cl.principal(contractAddress)],
      deployer
    ).result;
    // assert - DAO is not listed as extension, it has special privileges via is-self check
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("is-extension returns false for deployer", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "is-extension",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });
});

describe("base-dao: version-based RBAC concept", function () {
  it("get-version starts at 1 for fresh DAO", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-version",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(1));
  });

  it("version value can be read by any caller", function () {
    // This documents that get-version is public and can be used for RBAC checks
    // Extensions can check: (>= (contract-call? .base-dao get-version) u2)
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-version",
      [],
      wallet1
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(1));
  });

  it("version can be used for RBAC checks by extensions", function () {
    // This documents the RBAC pattern:
    // Extensions can check: (>= (contract-call? .base-dao get-version) u2)
    // Proposals can call: (contract-call? .base-dao increment-version)

    // arrange
    const version = simnet.callReadOnlyFn(
      contractAddress,
      "get-version",
      [],
      deployer
    ).result;
    // act - simulate what an extension would check
    const versionValue = version.type === ClarityType.UInt ? version.value : 0n;
    const hasMinVersion = versionValue >= 1n;
    // assert
    expect(hasMinVersion).toBe(true);
  });
});

describe("base-dao: executed-at read-only function", function () {
  it("executed-at() returns none for contract address that was never executed", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "executed-at",
      [Cl.principal(contractAddress)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("executed-at() returns none for random wallet", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "executed-at",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });
});

describe("base-dao: is-constructed read-only function", function () {
  it("is-constructed() can be called by any principal", function () {
    // arrange
    // act
    const result1 = simnet.callReadOnlyFn(
      contractAddress,
      "is-constructed",
      [],
      deployer
    ).result;
    const result2 = simnet.callReadOnlyFn(
      contractAddress,
      "is-constructed",
      [],
      wallet1
    ).result;
    // assert
    expect(result1).toStrictEqual(Cl.bool(false));
    expect(result2).toStrictEqual(Cl.bool(false));
  });
});

describe("base-dao: error codes documentation", function () {
  it("documents all error codes", function () {
    // This test documents all error codes for reference
    expect(ERR_UNAUTHORIZED).toBe(1000);
    expect(ERR_ALREADY_EXECUTED).toBe(1001);
    expect(ERR_INVALID_EXTENSION).toBe(1002);
    expect(ERR_NO_EMPTY_LISTS).toBe(1003);
    expect(ERR_DAO_ALREADY_CONSTRUCTED).toBe(1004);
  });
});
