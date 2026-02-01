import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// contract info
const coreProposalsAddress = `${deployer}.core-proposals`;
const testProposalAddress = `${deployer}.test-proposal`;
const daoTokenAddress = `${deployer}.dao-token`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;

// Error codes from core-proposals
const ERR_INSUFFICIENT_BALANCE = 3002;
const ERR_PROPOSAL_NOT_FOUND = 3003;
const ERR_PROPOSAL_VOTING_ACTIVE = 3004;
const ERR_PROPOSAL_ALREADY_CONCLUDED = 3007;
const ERR_VOTE_TOO_SOON = 3008;
const ERR_VOTE_TOO_LATE = 3009;
const ERR_ALREADY_VOTED = 3010;
const ERR_PROPOSAL_NOT_CONCLUDED = 3012;

// Voting configuration constants (must match contract)
const VOTING_DELAY = 144;
const VOTING_PERIOD = 432;
const VOTING_QUORUM = 1500;
const VOTING_THRESHOLD = 6600;
const PROPOSAL_BOND = 0;

// Helper function to mint mock sBTC and deposit to get DAO tokens
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

describe("core-proposals: read-only functions", function () {
  it("get-voting-configuration() returns correct values", function () {
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-voting-configuration",
      [],
      deployer
    ).result;
    expect(result).toStrictEqual(
      Cl.tuple({
        "voting-delay": Cl.uint(VOTING_DELAY),
        "voting-period": Cl.uint(VOTING_PERIOD),
        "voting-quorum": Cl.uint(VOTING_QUORUM),
        "voting-threshold": Cl.uint(VOTING_THRESHOLD),
        "proposal-bond": Cl.uint(PROPOSAL_BOND),
      })
    );
  });

  it("get-proposal-count() returns 0 initially", function () {
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal-count",
      [],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.uint(0));
  });

  it("get-proposal() returns none for non-existent proposal", function () {
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(999)],
      deployer
    ).result;
    expect(result).toBeNone();
  });

  it("get-vote-record() returns none for non-existent vote", function () {
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-vote-record",
      [Cl.uint(0), Cl.principal(wallet1)],
      deployer
    ).result;
    expect(result).toBeNone();
  });

  it("is-proposal-active() returns false for non-existent proposal", function () {
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "is-proposal-active",
      [Cl.uint(999)],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-voting-power() returns 0 for account with no tokens", function () {
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-voting-power",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(result).toBeOk(Cl.uint(0));
  });
});

describe("core-proposals: create-proposal", function () {
  it("create-proposal() fails when caller has no tokens", function () {
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });

  it("create-proposal() succeeds when caller has tokens", function () {
    mintAndDeposit(1000000, wallet1);
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.some(Cl.stringAscii("Test proposal"))],
      wallet1
    );
    expect(receipt.result).toBeOk(Cl.uint(0)); // First proposal, ID = 0
  });

  it("create-proposal() increments proposal count", function () {
    mintAndDeposit(1000000, wallet2);
    // Get initial count
    const countBefore = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal-count",
      [],
      deployer
    ).result;
    // Create proposal
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet2
    );
    // Check count increased
    const countAfter = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal-count",
      [],
      deployer
    ).result;
    expect(countAfter.type).toBe(ClarityType.UInt);
    if (countBefore.type === ClarityType.UInt && countAfter.type === ClarityType.UInt) {
      expect(countAfter.value > countBefore.value).toBe(true);
    }
  });

  it("create-proposal() stores proposal data correctly", function () {
    mintAndDeposit(1000000, wallet3);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.some(Cl.stringAscii("Test"))],
      wallet3
    );
    // Get proposal ID
    expect(createReceipt.result.type).toBe(ClarityType.ResponseOk);
    if (createReceipt.result.type === ClarityType.ResponseOk) {
      const proposalId = (createReceipt.result.value as any).value;
      // Get proposal data
      const proposalData = simnet.callReadOnlyFn(
        coreProposalsAddress,
        "get-proposal",
        [Cl.uint(Number(proposalId))],
        deployer
      ).result;
      expect(proposalData.type).toBe(ClarityType.OptionalSome);
      if (proposalData.type === ClarityType.OptionalSome && proposalData.value.type === ClarityType.Tuple) {
        expect(proposalData.value.value.proposal).toStrictEqual(Cl.principal(testProposalAddress));
        expect(proposalData.value.value.proposer).toStrictEqual(Cl.principal(wallet3));
        expect(proposalData.value.value.concluded).toStrictEqual(Cl.bool(false));
        expect(proposalData.value.value.passed).toStrictEqual(Cl.bool(false));
        expect(proposalData.value.value.executed).toStrictEqual(Cl.bool(false));
      }
    }
  });
});

describe("core-proposals: vote-on-proposal", function () {
  it("vote-on-proposal() fails for non-existent proposal", function () {
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(999), Cl.bool(true)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_NOT_FOUND));
  });

  it("vote-on-proposal() fails when caller has no tokens", function () {
    // First create a proposal
    mintAndDeposit(1000000, wallet1);
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    // Advance to voting period
    mineBlocks(VOTING_DELAY + 1);
    // Try to vote with wallet2 (no tokens)
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(0), Cl.bool(true)],
      wallet2
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });

  it("vote-on-proposal() fails before voting starts", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Try to vote immediately (before VOTING_DELAY passes)
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(true)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_VOTE_TOO_SOON));
  });

  it("vote-on-proposal() succeeds after voting starts", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Advance past voting delay
    mineBlocks(VOTING_DELAY + 1);
    // Vote
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(true)],
      wallet1
    );
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("vote-on-proposal() fails when already voted", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    mineBlocks(VOTING_DELAY + 1);
    // First vote
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(true)],
      wallet1
    );
    // Try to vote again
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(false)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_ALREADY_VOTED));
  });

  it("vote-on-proposal() fails after voting period ends", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Advance past voting delay + voting period
    mineBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
    // Try to vote
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(true)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_VOTE_TOO_LATE));
  });

  it("vote-on-proposal() updates proposal vote counts", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    mineBlocks(VOTING_DELAY + 1);
    // Vote FOR
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(true)],
      wallet1
    );
    // Check votes-for increased
    const proposalData = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(Number(proposalId))],
      deployer
    ).result;
    expect(proposalData.type).toBe(ClarityType.OptionalSome);
    if (proposalData.type === ClarityType.OptionalSome && proposalData.value.type === ClarityType.Tuple) {
      const votesFor = proposalData.value.value["votes-for"];
      expect(votesFor.type).toBe(ClarityType.UInt);
      expect((votesFor as any).value > 0n).toBe(true);
    }
  });
});

describe("core-proposals: is-proposal-active", function () {
  it("is-proposal-active() returns true during voting period", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Before voting starts
    let result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "is-proposal-active",
      [Cl.uint(Number(proposalId))],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.bool(false));
    // Advance to voting period
    mineBlocks(VOTING_DELAY + 1);
    result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "is-proposal-active",
      [Cl.uint(Number(proposalId))],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("is-proposal-active() returns false after voting ends", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Advance past voting period
    mineBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
    const result = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "is-proposal-active",
      [Cl.uint(Number(proposalId))],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.bool(false));
  });
});

describe("core-proposals: conclude-proposal", function () {
  it("conclude-proposal() fails while voting is active", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Advance to voting period but not past it
    mineBlocks(VOTING_DELAY + 1);
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_VOTING_ACTIVE));
  });

  it("conclude-proposal() fails for non-existent proposal", function () {
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(999), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_NOT_FOUND));
  });

  it("conclude-proposal() fails with wrong proposal contract", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    mineBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
    // Try with wrong contract
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(daoTokenAddress)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_NOT_FOUND));
  });

  it("conclude-proposal() succeeds after voting period", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    mineBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(receipt.result.type).toBe(ClarityType.ResponseOk);
  });

  it("conclude-proposal() fails when already concluded", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    mineBlocks(VOTING_DELAY + VOTING_PERIOD + 1);
    // Conclude first time
    simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    // Try to conclude again
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_ALREADY_CONCLUDED));
  });
});

describe("core-proposals: execute-proposal", function () {
  it("execute-proposal() fails for non-concluded proposal", function () {
    mintAndDeposit(1000000, wallet1);
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;
    // Don't conclude, try to execute
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "execute-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROPOSAL_NOT_CONCLUDED));
  });
});

describe("core-proposals: callback", function () {
  it("callback() always returns ok", function () {
    const receipt = simnet.callPublicFn(
      coreProposalsAddress,
      "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34).fill(0))],
      deployer
    );
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("core-proposals: full lifecycle - passing proposal", function () {
  it("proposal passes with sufficient votes for and meets quorum/threshold", function () {
    // Give voter tokens
    mintAndDeposit(10000000, wallet1);

    // Create proposal
    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.some(Cl.stringAscii("Passing proposal"))],
      wallet1
    );
    expect(createReceipt.result.type).toBe(ClarityType.ResponseOk);
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;

    // Advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // Vote in favor
    const voteReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(true)],
      wallet1
    );
    expect(voteReceipt.result).toBeOk(Cl.bool(true));

    // Advance past voting period
    mineBlocks(VOTING_PERIOD + 1);

    // Conclude
    const concludeReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(concludeReceipt.result).toBeOk(Cl.bool(true)); // Passed

    // Verify proposal state
    const proposalData = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(Number(proposalId))],
      deployer
    ).result;
    if (proposalData.type === ClarityType.OptionalSome && proposalData.value.type === ClarityType.Tuple) {
      expect(proposalData.value.value.concluded).toStrictEqual(Cl.bool(true));
      expect(proposalData.value.value.passed).toStrictEqual(Cl.bool(true));
    }
  });
});

describe("core-proposals: full lifecycle - failing proposal", function () {
  it("proposal fails with votes against", function () {
    mintAndDeposit(10000000, wallet1);

    const createReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.some(Cl.stringAscii("Failing proposal"))],
      wallet1
    );
    const proposalId = createReceipt.result.type === ClarityType.ResponseOk
      ? (createReceipt.result.value as any).value
      : 0n;

    mineBlocks(VOTING_DELAY + 1);

    // Vote against
    simnet.callPublicFn(
      coreProposalsAddress,
      "vote-on-proposal",
      [Cl.uint(Number(proposalId)), Cl.bool(false)],
      wallet1
    );

    mineBlocks(VOTING_PERIOD + 1);

    const concludeReceipt = simnet.callPublicFn(
      coreProposalsAddress,
      "conclude-proposal",
      [Cl.uint(Number(proposalId)), Cl.principal(testProposalAddress)],
      wallet1
    );
    expect(concludeReceipt.result).toBeOk(Cl.bool(false)); // Did not pass

    // Verify proposal state
    const proposalData = simnet.callReadOnlyFn(
      coreProposalsAddress,
      "get-proposal",
      [Cl.uint(Number(proposalId))],
      deployer
    ).result;
    if (proposalData.type === ClarityType.OptionalSome && proposalData.value.type === ClarityType.Tuple) {
      expect(proposalData.value.value.concluded).toStrictEqual(Cl.bool(true));
      expect(proposalData.value.value.passed).toStrictEqual(Cl.bool(false));
    }
  });
});

describe("core-proposals: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_INSUFFICIENT_BALANCE).toBe(3002);
    expect(ERR_PROPOSAL_NOT_FOUND).toBe(3003);
    expect(ERR_PROPOSAL_VOTING_ACTIVE).toBe(3004);
    expect(ERR_PROPOSAL_ALREADY_CONCLUDED).toBe(3007);
    expect(ERR_VOTE_TOO_SOON).toBe(3008);
    expect(ERR_VOTE_TOO_LATE).toBe(3009);
    expect(ERR_ALREADY_VOTED).toBe(3010);
    expect(ERR_PROPOSAL_NOT_CONCLUDED).toBe(3012);
  });
});
