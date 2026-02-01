import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

// contract info
const daoTokenOwnerAddress = `${deployer}.dao-token-owner`;

// Error codes
const ERR_NOT_DAO_OR_EXTENSION = 1800;
const ERR_NO_PENDING_CHANGE = 1801;
const ERR_CHANGE_NOT_READY = 1802;
const ERR_PENDING_CHANGE_EXISTS = 1803;

// Constants
const OWNERSHIP_CHANGE_DELAY = 1008; // ~7 days in Stacks blocks

describe("dao-token-owner: initial state", function () {
  it("get-contract-info() returns valid contract info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenOwnerAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
  });

  it("get-pending-ownership-change() returns valid tuple initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenOwnerAddress,
      "get-pending-ownership-change",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
  });

  it("get-ownership-change-delay() returns correct delay", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenOwnerAddress,
      "get-ownership-change-delay",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(OWNERSHIP_CHANGE_DELAY));
  });
});

describe("dao-token-owner: callback", function () {
  it("callback() succeeds for any caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "callback",
      [Cl.principal(wallet1), Cl.buffer(new Uint8Array(34))],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("dao-token-owner: set-token-uri authorization", function () {
  it("set-token-uri() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "set-token-uri",
      [Cl.stringUtf8("https://example.com/metadata.json")],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("set-token-uri() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "set-token-uri",
      [Cl.stringUtf8("https://example.com/metadata.json")],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });
});

describe("dao-token-owner: transfer-ownership authorization", function () {
  it("transfer-ownership() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "transfer-ownership",
      [Cl.principal(wallet2)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("transfer-ownership() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "transfer-ownership",
      [Cl.principal(wallet2)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });
});

describe("dao-token-owner: schedule-ownership-transfer authorization", function () {
  it("schedule-ownership-transfer() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "schedule-ownership-transfer",
      [Cl.principal(wallet2)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("schedule-ownership-transfer() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "schedule-ownership-transfer",
      [Cl.principal(wallet2)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });
});

describe("dao-token-owner: apply-pending-ownership", function () {
  it("apply-pending-ownership() fails when no pending change exists", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "apply-pending-ownership",
      [],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NO_PENDING_CHANGE));
  });

  it("apply-pending-ownership() fails when called by any user with no pending change", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "apply-pending-ownership",
      [],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NO_PENDING_CHANGE));
  });
});

describe("dao-token-owner: cancel-ownership-transfer authorization", function () {
  it("cancel-ownership-transfer() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "cancel-ownership-transfer",
      [],
      wallet1
    );
    // assert - fails on auth first, then would fail on no pending change
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("cancel-ownership-transfer() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenOwnerAddress,
      "cancel-ownership-transfer",
      [],
      deployer
    );
    // assert - fails on auth first
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });
});

describe("dao-token-owner: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_NOT_DAO_OR_EXTENSION).toBe(1800);
    expect(ERR_NO_PENDING_CHANGE).toBe(1801);
    expect(ERR_CHANGE_NOT_READY).toBe(1802);
    expect(ERR_PENDING_CHANGE_EXISTS).toBe(1803);
  });

  it("documents ownership change delay constant", function () {
    expect(OWNERSHIP_CHANGE_DELAY).toBe(1008);
  });
});
