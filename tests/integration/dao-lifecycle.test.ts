import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToJSON } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// contract addresses
const baseDaoAddress = `${deployer}.base-dao`;
const initProposalAddress = `${deployer}.init-proposal`;
const testProposalAddress = `${deployer}.test-proposal`;
const treasuryAddress = `${deployer}.dao-treasury`;
const epochAddress = `${deployer}.dao-epoch`;
const charterAddress = `${deployer}.dao-charter`;
const tokenOwnerAddress = `${deployer}.dao-token-owner`;
const coreProposalsAddress = `${deployer}.core-proposals`;
const agentRegistryAddress = `${deployer}.agent-registry`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const daoTokenAddress = `${deployer}.dao-token`;

// Voting configuration constants (must match contract)
const VOTING_DELAY = 144;
const VOTING_PERIOD = 432;

// Helper to mint mock sBTC and deposit to get DAO tokens
function mintAndDeposit(amount: number, recipient: string) {
  simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
  return simnet.callPublicFn(
    daoTokenAddress,
    "deposit",
    [Cl.uint(amount)],
    recipient
  );
}

// Helper to advance blocks
function mineBlocks(count: number) {
  simnet.mineEmptyBlocks(count);
}

// Helper to construct DAO
function constructDao() {
  return simnet.callPublicFn(
    baseDaoAddress,
    "construct",
    [Cl.principal(initProposalAddress)],
    deployer
  );
}

describe("dao-lifecycle: full initialization flow", function () {
  it("should complete initialization with all extensions enabled", function () {
    // arrange
    // act - construct DAO with init-proposal
    const constructResult = constructDao();

    // assert - construction succeeded
    expect(constructResult.result).toBeOk(Cl.bool(true));

    // assert - DAO is marked as constructed
    const isConstructed = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-constructed",
      [],
      deployer
    ).result;
    expect(isConstructed).toStrictEqual(Cl.bool(true));

    // assert - all extensions are enabled
    const extensions = [
      treasuryAddress,
      epochAddress,
      charterAddress,
      tokenOwnerAddress,
      coreProposalsAddress,
      agentRegistryAddress,
    ];

    for (const ext of extensions) {
      const isEnabled = simnet.callReadOnlyFn(
        baseDaoAddress,
        "is-extension",
        [Cl.principal(ext)],
        deployer
      ).result;
      expect(isEnabled).toStrictEqual(Cl.bool(true));
    }
  });

  it("should set initial charter during initialization", function () {
    // arrange & act
    constructDao();

    // assert - charter is set
    const charter = simnet.callReadOnlyFn(
      charterAddress,
      "get-current-dao-charter",
      [],
      deployer
    ).result;

    expect(charter.type).toBe(ClarityType.OptionalSome);
    if (charter.type === ClarityType.OptionalSome) {
      const charterData = cvToJSON(charter.value);
      expect(charterData.value.charter.value).toContain("Simplified Agent DAO");
    }
  });

  it("should allow assets in treasury during initialization", function () {
    // arrange & act
    constructDao();

    // assert - mock-sbtc is allowed
    const sbtcAllowed = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    expect(sbtcAllowed).toStrictEqual(Cl.bool(true));

    // assert - dao-token is allowed
    const tokenAllowed = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(daoTokenAddress)],
      deployer
    ).result;
    expect(tokenAllowed).toStrictEqual(Cl.bool(true));
  });

  it("should track init-proposal execution", function () {
    // arrange & act
    constructDao();

    // assert - init-proposal is marked as executed
    const executedAt = simnet.callReadOnlyFn(
      baseDaoAddress,
      "executed-at",
      [Cl.principal(initProposalAddress)],
      deployer
    ).result;

    expect(executedAt.type).toBe(ClarityType.OptionalSome);
  });

  it("should have version 1 after initialization", function () {
    // arrange & act
    constructDao();

    // assert - version is 1
    const version = simnet.callReadOnlyFn(
      baseDaoAddress,
      "get-version",
      [],
      deployer
    ).result;
    expect(version).toStrictEqual(Cl.uint(1));
  });
});

describe("dao-lifecycle: full proposal lifecycle", function () {
  it("should complete create -> vote -> conclude -> execute flow", function () {
    // arrange - construct DAO and give wallet1 tokens
    constructDao();
    mintAndDeposit(10000000, wallet1);

    // act - create proposal
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.some(Cl.stringAscii("Test proposal"))],
      wallet1
    );
    expect(createReceipt.result).toBeOk(Cl.uint(0));
    const proposalId = 0;

    // verify proposal is stored
    const proposalData = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    expect(proposalData.type).toBe(ClarityType.OptionalSome);

    // act - advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // verify proposal is active
    const isActive = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "is-proposal-active",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    expect(isActive).toStrictEqual(Cl.bool(true));

    // act - vote for proposal
    const voteReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(proposalId), Cl.bool(true)],
      wallet1
    );
    expect(voteReceipt.result).toBeOk(Cl.bool(true));

    // verify vote is recorded
    const voteRecord = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-vote-record",
      [Cl.uint(proposalId), Cl.principal(wallet1)],
      deployer
    ).result;
    expect(voteRecord.type).toBe(ClarityType.OptionalSome);

    // act - advance past voting period
    mineBlocks(VOTING_PERIOD + 1);

    // verify proposal is no longer active
    const isActiveAfter = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "is-proposal-active",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    expect(isActiveAfter).toStrictEqual(Cl.bool(false));

    // act - conclude proposal
    const concludeReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(proposalId), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(concludeReceipt.result).toBeOk(Cl.bool(true));

    // verify proposal is concluded and passed
    const proposalAfter = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    if (proposalAfter.type === ClarityType.OptionalSome && proposalAfter.value.type === ClarityType.Tuple) {
      expect(proposalAfter.value.value.concluded).toStrictEqual(Cl.bool(true));
      expect(proposalAfter.value.value.passed).toStrictEqual(Cl.bool(true));
    }

    // act - execute proposal
    const executeReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "execute-proposal",
      [Cl.uint(proposalId), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(executeReceipt.result).toBeOk(Cl.bool(true));

    // verify proposal is executed
    const proposalFinal = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    if (proposalFinal.type === ClarityType.OptionalSome && proposalFinal.value.type === ClarityType.Tuple) {
      expect(proposalFinal.value.value.executed).toStrictEqual(Cl.bool(true));
    }

    // verify test-proposal was executed
    const wasExecuted = simnet.callReadOnlyFn(
      testProposalAddress,
      "was-executed",
      [],
      deployer
    ).result;
    expect(wasExecuted).toStrictEqual(Cl.bool(true));
  });

  it("should fail proposal with votes against", function () {
    // arrange - construct DAO and give wallet1 tokens
    constructDao();
    mintAndDeposit(10000000, wallet1);

    // act - create proposal
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.some(Cl.stringAscii("Failing proposal"))],
      wallet1
    );
    const proposalId = 0;

    // advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // vote against
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(proposalId), Cl.bool(false)],
      wallet1
    );

    // advance past voting period
    mineBlocks(VOTING_PERIOD + 1);

    // conclude proposal
    const concludeReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(proposalId), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(concludeReceipt.result).toBeOk(Cl.bool(false)); // Did not pass

    // verify proposal did not pass
    const proposalData = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    if (proposalData.type === ClarityType.OptionalSome && proposalData.value.type === ClarityType.Tuple) {
      expect(proposalData.value.value.concluded).toStrictEqual(Cl.bool(true));
      expect(proposalData.value.value.passed).toStrictEqual(Cl.bool(false));
    }
  });

  it("should allow multiple voters on same proposal", function () {
    // arrange - construct DAO and give multiple wallets tokens
    constructDao();
    mintAndDeposit(5000000, wallet1);
    mintAndDeposit(3000000, wallet2);
    mintAndDeposit(2000000, wallet3);

    // create proposal
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = 0;

    // advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // all three wallets vote
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(proposalId), Cl.bool(true)],
      wallet1
    );
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(proposalId), Cl.bool(true)],
      wallet2
    );
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(proposalId), Cl.bool(false)],
      wallet3
    );

    // verify all votes are recorded
    for (const voter of [wallet1, wallet2, wallet3]) {
      const voteRecord = simnet.callReadOnlyFn(
        coreProposalsAddress,
        "get-vote-record",
        [Cl.uint(proposalId), Cl.principal(voter)],
        deployer
      ).result;
      expect(voteRecord.type).toBe(ClarityType.OptionalSome);
    }

    // check proposal vote counts
    const proposalData = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(proposalId)],
      deployer
    ).result;
    if (proposalData.type === ClarityType.OptionalSome && proposalData.value.type === ClarityType.Tuple) {
      const votesFor = proposalData.value.value["votes-for"] as any;
      const votesAgainst = proposalData.value.value["votes-against"] as any;
      // wallet1 + wallet2 voted for, wallet3 voted against
      expect(votesFor.value > 0n).toBe(true);
      expect(votesAgainst.value > 0n).toBe(true);
    }
  });
});

describe("dao-lifecycle: extension authorization", function () {
  it("should allow extensions to call protected functions after init", function () {
    // arrange - construct DAO
    constructDao();

    // Extensions are now enabled and can call protected functions
    // Verify core-proposals is an extension
    const isExtension = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(coreProposalsAddress)],
      deployer
    ).result;
    expect(isExtension).toStrictEqual(Cl.bool(true));
  });

  it("should block non-extension calls to protected functions", function () {
    // arrange - construct DAO
    constructDao();

    // act - try to call set-extension as wallet1 (not an extension)
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "set-extension",
      [Cl.principal(wallet1), Cl.bool(true)],
      wallet1
    );

    // assert - fails with ERR_UNAUTHORIZED
    expect(receipt.result).toBeErr(Cl.uint(1000));
  });

  it("should block direct treasury access for non-extensions", function () {
    // arrange - construct DAO
    constructDao();

    // act - try to allow an asset as wallet1
    const receipt = simnet.callPublicFn(
      treasuryAddress,
      "allow-asset",
      [Cl.principal(wallet1), Cl.bool(true)],
      wallet1
    );

    // assert - fails with ERR_NOT_DAO_OR_EXTENSION
    expect(receipt.result).toBeErr(Cl.uint(1900));
  });
});

describe("dao-lifecycle: proposal count tracking", function () {
  it("should track proposal count across multiple proposals", function () {
    // arrange - construct DAO and fund wallets
    constructDao();
    mintAndDeposit(5000000, wallet1);
    mintAndDeposit(5000000, wallet2);

    // initial count
    const countBefore = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal-count",
      [],
      deployer
    ).result;
    expect(countBefore).toStrictEqual(Cl.uint(0));

    // create first proposal
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );

    // check count
    const countAfter1 = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal-count",
      [],
      deployer
    ).result;
    expect(countAfter1).toStrictEqual(Cl.uint(1));

    // create second proposal
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet2
    );

    // check count
    const countAfter2 = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal-count",
      [],
      deployer
    ).result;
    expect(countAfter2).toStrictEqual(Cl.uint(2));
  });
});

describe("dao-lifecycle: prevent double construction", function () {
  it("should prevent constructing DAO twice", function () {
    // arrange - construct once
    constructDao();

    // act - try to construct again
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );

    // assert - fails with ERR_DAO_ALREADY_CONSTRUCTED
    expect(receipt.result).toBeErr(Cl.uint(1004));
  });
});
