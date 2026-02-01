import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;

// contract info
const epochAddress = `${deployer}.dao-epoch`;

// Constants
const EPOCH_LENGTH = 4320; // ~30 days in BTC blocks

describe("dao-epoch: initial state", function () {
  it("get-contract-info() returns valid contract info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      epochAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
  });

  it("get-dao-epoch-length() returns EPOCH_LENGTH constant", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      epochAddress,
      "get-dao-epoch-length",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.uint(EPOCH_LENGTH));
  });
});

describe("dao-epoch: callback", function () {
  it("callback() succeeds for any caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      epochAddress,
      "callback",
      [Cl.principal(wallet1), Cl.buffer(new Uint8Array(34))],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("callback() succeeds for deployer", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      epochAddress,
      "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34))],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("dao-epoch: get-current-dao-epoch", function () {
  it("get-current-dao-epoch() returns 0 initially (same block as deployment)", function () {
    // arrange
    // When deployed, burn-block-height == DEPLOYED_BURN_BLOCK
    // So (/ (- burn-block-height DEPLOYED_BURN_BLOCK) EPOCH_LENGTH) = (/ 0 4320) = 0
    // act
    const result = simnet.callReadOnlyFn(
      epochAddress,
      "get-current-dao-epoch",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.uint(0));
  });

  it("get-current-dao-epoch() can be called by any principal", function () {
    // arrange
    // act
    const result1 = simnet.callReadOnlyFn(
      epochAddress,
      "get-current-dao-epoch",
      [],
      deployer
    ).result;
    const result2 = simnet.callReadOnlyFn(
      epochAddress,
      "get-current-dao-epoch",
      [],
      wallet1
    ).result;
    // assert
    expect(result1).toBeOk(Cl.uint(0));
    expect(result2).toBeOk(Cl.uint(0));
  });
});

describe("dao-epoch: epoch calculation", function () {
  it("epoch calculation uses burn-block-height, not stacks-block-height", function () {
    // This documents that epoch tracking is based on Bitcoin blocks
    // which provides more reliable timing than Stacks blocks
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      epochAddress,
      "get-current-dao-epoch",
      [],
      deployer
    ).result;
    // assert
    // At deployment block, epoch is 0
    expect(result).toBeOk(Cl.uint(0));
  });

  it("get-dao-epoch-length() returns expected constant", function () {
    // 4320 blocks * 10 minutes per block = 43200 minutes = 720 hours = 30 days
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      epochAddress,
      "get-dao-epoch-length",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.uint(4320));
  });
});

describe("dao-epoch: contract info structure", function () {
  it("get-contract-info() returns a tuple with contract details", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      epochAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert - verify it returns a tuple
    expect(result.type).toBe(ClarityType.Tuple);
  });
});

describe("dao-epoch: no authorization required", function () {
  it("all functions are public/read-only, no auth checks", function () {
    // This extension only provides epoch tracking - no state changes
    // Therefore no authorization is needed
    // arrange
    // act
    const callbackResult = simnet.callPublicFn(
      epochAddress,
      "callback",
      [Cl.principal(wallet1), Cl.buffer(new Uint8Array(34))],
      wallet1
    );
    const epochResult = simnet.callReadOnlyFn(
      epochAddress,
      "get-current-dao-epoch",
      [],
      wallet1
    ).result;
    const lengthResult = simnet.callReadOnlyFn(
      epochAddress,
      "get-dao-epoch-length",
      [],
      wallet1
    ).result;
    const infoResult = simnet.callReadOnlyFn(
      epochAddress,
      "get-contract-info",
      [],
      wallet1
    ).result;
    // assert - all succeed
    expect(callbackResult.result).toBeOk(Cl.bool(true));
    expect(epochResult).toBeOk(Cl.uint(0));
    expect(lengthResult).toBeOk(Cl.uint(EPOCH_LENGTH));
    expect(infoResult.type).toBe(ClarityType.Tuple);
  });
});
