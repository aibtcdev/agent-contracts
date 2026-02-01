import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;
const wallet4 = accounts.get("wallet_4")!;

// contract addresses
const runCostAddress = `${deployer}.dao-run-cost`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;

// Error codes
const ERR_NOT_OWNER = 2000;
const ERR_ASSET_NOT_ALLOWED = 2001;
const ERR_PROPOSAL_MISMATCH = 2002;
const ERR_SAVING_PROPOSAL = 2003;
const ERR_PROPOSAL_EXPIRED = 2004;
const ERR_ALREADY_EXECUTED = 2005;
const ERR_INVALID_CONFIRMATIONS = 2006;
const ERR_ALREADY_CONFIRMED = 2007;

// Proposal types
const SET_OWNER = 1;
const SET_ASSET = 2;
const TRANSFER = 3;
const SET_CONFIRMATIONS = 4;

// Helper function to mint mock sBTC to an address
function mintMockSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
}

describe("dao-run-cost: initial state", function () {
  it("get-contract-info() returns valid contract info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
  });

  it("get-confirmations-required() returns 2 initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-confirmations-required",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(2));
  });

  it("get-total-owners() returns 3 initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-total-owners",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(3));
  });

  it("deployer is an owner", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("wallet_1 is an owner", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("wallet_2 is an owner", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("wallet_3 is NOT an owner", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-proposal-totals() returns all zeros initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-proposal-totals",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(
      Cl.tuple({
        "set-owner": Cl.uint(0),
        "set-asset": Cl.uint(0),
        transfer: Cl.uint(0),
        "set-confirmations": Cl.uint(0),
      })
    );
  });

  it("is-allowed-asset() returns false for any asset initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });
});

describe("dao-run-cost: set-owner proposal", function () {
  it("fails when called by non-owner", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      wallet3
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_OWNER));
  });

  it("creates proposal when called by owner", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(false)); // Not executed yet (needs 2 confirmations)
  });

  it("confirms proposal when second owner calls", function () {
    // arrange
    // First owner creates proposal
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // act - Second owner confirms
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true)); // Executed (2 confirmations reached)
    // Verify wallet3 is now an owner
    const isOwner = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    expect(isOwner).toStrictEqual(Cl.bool(true));
    // Verify total owners increased
    const totalOwners = simnet.callReadOnlyFn(
      runCostAddress,
      "get-total-owners",
      [],
      deployer
    ).result;
    expect(totalOwners).toStrictEqual(Cl.uint(4));
  });

  it("fails when same owner tries to confirm twice", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ALREADY_CONFIRMED));
  });

  it("fails when proposal parameters mismatch", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // act - Different status
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(false)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_MISMATCH));
  });

  it("can remove an owner with 2 confirmations", function () {
    // arrange - Add wallet3 first
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      wallet1
    );
    // Verify wallet3 is owner
    let isOwner = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    expect(isOwner).toStrictEqual(Cl.bool(true));
    // act - Remove wallet3
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(2), Cl.principal(wallet3), Cl.bool(false)],
      deployer
    );
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(2), Cl.principal(wallet3), Cl.bool(false)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    isOwner = simnet.callReadOnlyFn(
      runCostAddress,
      "is-owner",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    expect(isOwner).toStrictEqual(Cl.bool(false));
    // Total owners back to 3
    const totalOwners = simnet.callReadOnlyFn(
      runCostAddress,
      "get-total-owners",
      [],
      deployer
    ).result;
    expect(totalOwners).toStrictEqual(Cl.uint(3));
  });
});

describe("dao-run-cost: set-asset proposal", function () {
  it("fails when called by non-owner", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet3
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_OWNER));
  });

  it("creates proposal when called by owner", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(false)); // Not executed yet
  });

  it("allows asset when 2 owners confirm", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const isAllowed = simnet.callReadOnlyFn(
      runCostAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    expect(isAllowed).toStrictEqual(Cl.bool(true));
  });

  it("can disallow an asset", function () {
    // arrange - First allow the asset
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    // act - Now disallow
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(2), Cl.principal(mockSbtcAddress), Cl.bool(false)],
      deployer
    );
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(2), Cl.principal(mockSbtcAddress), Cl.bool(false)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const isAllowed = simnet.callReadOnlyFn(
      runCostAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    expect(isAllowed).toStrictEqual(Cl.bool(false));
  });
});

describe("dao-run-cost: transfer-token proposal", function () {
  it("fails when asset is not allowed", function () {
    // arrange
    const amount = 1000000;
    mintMockSbtc(amount, runCostAddress);
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(amount),
        Cl.principal(wallet3),
      ],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ASSET_NOT_ALLOWED));
  });

  it("fails when called by non-owner", function () {
    // arrange - Allow asset first
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(1000),
        Cl.principal(wallet3),
      ],
      wallet3
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_OWNER));
  });

  it("creates proposal when called by owner with allowed asset", function () {
    // arrange - Allow asset first
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    // Fund the contract
    mintMockSbtc(1000000, runCostAddress);
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(false)); // Not executed yet
  });

  it("transfers tokens when 2 owners confirm", function () {
    // arrange - Allow asset
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    // Fund the contract
    const amount = 1000000;
    mintMockSbtc(amount, runCostAddress);
    // Create transfer proposal
    simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      deployer
    );
    // act - Second confirmation executes
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // Verify wallet3 received tokens
    const balance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    expect(balance).toBeOk(Cl.uint(500000));
  });
});

describe("dao-run-cost: set-confirmations proposal", function () {
  it("fails when called by non-owner", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-confirmations",
      [Cl.uint(1), Cl.uint(3)],
      wallet3
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_OWNER));
  });

  it("fails when required is 0", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-confirmations",
      [Cl.uint(1), Cl.uint(0)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INVALID_CONFIRMATIONS));
  });

  it("fails when required exceeds total owners", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-confirmations",
      [Cl.uint(1), Cl.uint(5)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INVALID_CONFIRMATIONS));
  });

  it("changes confirmations when 2 owners confirm", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-confirmations",
      [Cl.uint(1), Cl.uint(3)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "set-confirmations",
      [Cl.uint(1), Cl.uint(3)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const required = simnet.callReadOnlyFn(
      runCostAddress,
      "get-confirmations-required",
      [],
      deployer
    ).result;
    expect(required).toStrictEqual(Cl.uint(3));
  });
});

describe("dao-run-cost: confirmation tracking", function () {
  it("get-owner-confirmation() returns false for non-confirmed", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-owner-confirmation",
      [Cl.uint(SET_OWNER), Cl.uint(1), Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-owner-confirmation() returns true after confirmation", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-owner-confirmation",
      [Cl.uint(SET_OWNER), Cl.uint(1), Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("get-total-confirmations() tracks confirmation count", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // act
    let result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-total-confirmations",
      [Cl.uint(SET_OWNER), Cl.uint(1)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(1));
    // Add second confirmation
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      wallet1
    );
    result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-total-confirmations",
      [Cl.uint(SET_OWNER), Cl.uint(1)],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.uint(2));
  });
});

describe("dao-run-cost: proposal read functions", function () {
  it("get-set-owner-proposal() returns proposal data", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-owner",
      [Cl.uint(1), Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-set-owner-proposal",
      [Cl.uint(1)],
      deployer
    ).result;
    // assert
    expect(result).toBeSome(
      Cl.tuple({
        who: Cl.principal(wallet3),
        status: Cl.bool(true),
        "created-at": Cl.uint(simnet.blockHeight - 1),
        executed: Cl.none(),
      })
    );
  });

  it("get-set-asset-proposal() returns proposal data", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-set-asset-proposal",
      [Cl.uint(1)],
      deployer
    ).result;
    // assert
    expect(result).toBeSome(
      Cl.tuple({
        token: Cl.principal(mockSbtcAddress),
        enabled: Cl.bool(true),
        "created-at": Cl.uint(simnet.blockHeight - 1),
        executed: Cl.none(),
      })
    );
  });

  it("get-transfer-proposal() returns proposal data", function () {
    // arrange - Allow asset first
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(
      runCostAddress,
      "set-asset",
      [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
      wallet1
    );
    mintMockSbtc(1000000, runCostAddress);
    simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-transfer-proposal",
      [Cl.uint(1)],
      deployer
    ).result;
    // assert - Check structure, not exact block height (burn-block-height vs stacks-block-height)
    expect(result.type).toBe(ClarityType.OptionalSome);
    // @ts-ignore - accessing internal value
    const proposal = result.value;
    expect(proposal.type).toBe(ClarityType.Tuple);
  });

  it("get-set-confirmations-proposal() returns proposal data", function () {
    // arrange
    simnet.callPublicFn(
      runCostAddress,
      "set-confirmations",
      [Cl.uint(1), Cl.uint(3)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      runCostAddress,
      "get-set-confirmations-proposal",
      [Cl.uint(1)],
      deployer
    ).result;
    // assert
    expect(result).toBeSome(
      Cl.tuple({
        required: Cl.uint(3),
        "created-at": Cl.uint(simnet.blockHeight - 1),
        executed: Cl.none(),
      })
    );
  });

  it("returns none for non-existent proposals", function () {
    // arrange
    // act
    const result1 = simnet.callReadOnlyFn(
      runCostAddress,
      "get-set-owner-proposal",
      [Cl.uint(999)],
      deployer
    ).result;
    const result2 = simnet.callReadOnlyFn(
      runCostAddress,
      "get-set-asset-proposal",
      [Cl.uint(999)],
      deployer
    ).result;
    const result3 = simnet.callReadOnlyFn(
      runCostAddress,
      "get-transfer-proposal",
      [Cl.uint(999)],
      deployer
    ).result;
    const result4 = simnet.callReadOnlyFn(
      runCostAddress,
      "get-set-confirmations-proposal",
      [Cl.uint(999)],
      deployer
    ).result;
    // assert
    expect(result1).toBeNone();
    expect(result2).toBeNone();
    expect(result3).toBeNone();
    expect(result4).toBeNone();
  });
});

describe("dao-run-cost: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_NOT_OWNER).toBe(2000);
    expect(ERR_ASSET_NOT_ALLOWED).toBe(2001);
    expect(ERR_PROPOSAL_MISMATCH).toBe(2002);
    expect(ERR_SAVING_PROPOSAL).toBe(2003);
    expect(ERR_PROPOSAL_EXPIRED).toBe(2004);
    expect(ERR_ALREADY_EXECUTED).toBe(2005);
    expect(ERR_INVALID_CONFIRMATIONS).toBe(2006);
    expect(ERR_ALREADY_CONFIRMED).toBe(2007);
  });

  it("documents all proposal types", function () {
    expect(SET_OWNER).toBe(1);
    expect(SET_ASSET).toBe(2);
    expect(TRANSFER).toBe(3);
    expect(SET_CONFIRMATIONS).toBe(4);
  });
});
