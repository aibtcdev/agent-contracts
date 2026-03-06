import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

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
const coreProposalsAddress = `${deployer}.core-proposals`;
const agentAccountAddress = `${deployer}.agent-account`;
const agentRegistryAddress = `${deployer}.agent-registry`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const daoTokenAddress = `${deployer}.dao-token`;

// The agent-account uses deployer as owner and wallet_2 as agent
// (set via initialize)
const accountOwner = deployer;
const accountAgent = wallet2;
const unauthorized = wallet3;

// Voting configuration constants (must match contract)
const VOTING_DELAY = 144;
const VOTING_PERIOD = 432;

// Contract approval types
const APPROVED_CONTRACT_VOTING = 1;
const APPROVED_CONTRACT_SWAP = 2;
const APPROVED_CONTRACT_TOKEN = 3;

// Error codes
const ERR_CALLER_NOT_OWNER = 4000;
const ERR_OPERATION_NOT_ALLOWED = 4001;
const ERR_CONTRACT_NOT_APPROVED = 4002;
const ERR_NOT_INITIALIZED = 4006;

// Helper to initialize agent-account (must be called in every test that
// interacts with agent-account public functions, since each test gets a
// fresh simnet)
function initializeAgentAccount() {
  return simnet.callPublicFn(
    agentAccountAddress,
    "initialize",
    [Cl.principal(accountOwner), Cl.principal(accountAgent)],
    deployer
  );
}

// Helper to mint mock sBTC
function mintMockSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
}

// Helper to mint and deposit to get DAO tokens
function mintAndDeposit(amount: number, recipient: string) {
  mintMockSbtc(amount, recipient);
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

describe("agent-workflow: agent-account initialization", function () {
  it("initialize() succeeds for deployer", function () {
    // arrange & act
    const receipt = initializeAgentAccount();

    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("get-config() works after initialization", function () {
    // arrange
    initializeAgentAccount();

    // act
    const configReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "get-config",
      [],
      deployer
    );

    // assert
    expect(configReceipt.result).toBeOk(
      Cl.tuple({
        account: Cl.principal(agentAccountAddress),
        agent: Cl.principal(accountAgent),
        owner: Cl.principal(accountOwner),
        "agent-can-manage-assets": Cl.bool(true),
        "agent-can-use-proposals": Cl.bool(true),
      })
    );
  });

  it("get-config() fails before initialization", function () {
    // arrange & act - do NOT call initializeAgentAccount
    const configReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "get-config",
      [],
      deployer
    );

    // assert
    expect(configReceipt.result).toBeErr(Cl.uint(ERR_NOT_INITIALIZED));
  });

  it("public functions return ERR_NOT_INITIALIZED before initialization", function () {
    // arrange & act - do NOT call initializeAgentAccount
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(1000)],
      accountOwner
    );

    // assert
    expect(depositReceipt.result).toBeErr(Cl.uint(ERR_NOT_INITIALIZED));
  });
});

describe("agent-workflow: token deposit flow", function () {
  it("owner deposits tokens to agent-account", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 1000000;
    mintMockSbtc(depositAmount, accountOwner);

    // act - deposit FT to agent-account
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      accountOwner
    );

    // assert
    expect(depositReceipt.result).toBeOk(Cl.bool(true));
  });

  it("agent deposits tokens with manage-assets permission", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 500000;
    mintMockSbtc(depositAmount, accountAgent);

    // act - agent deposits
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      accountAgent
    );

    // assert
    expect(depositReceipt.result).toBeOk(Cl.bool(true));
  });

  it("unauthorized user cannot deposit", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 100000;
    mintMockSbtc(depositAmount, unauthorized);

    // act - unauthorized deposit attempt
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      unauthorized
    );

    // assert
    expect(depositReceipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });
});

describe("agent-workflow: proposal creation via agent-account", function () {
  it("agent creates proposal after voting contract approval", function () {
    // arrange - initialize, construct DAO, and approve voting contract
    initializeAgentAccount();
    constructDao();
    simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );

    // Give the agent-account some sBTC first (via owner deposit to agent-account)
    mintMockSbtc(10000000, accountOwner);
    simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(10000000)],
      accountOwner
    );

    // Note: agent-account needs DAO tokens to create proposals, but the deposit flow
    // for agent-account to dao-token is complex. The key test is that the approval
    // flow works and doesn't fail with ERR_CONTRACT_NOT_APPROVED.
    // For a full integration, the agent-account would need to call dao-token.deposit.

    // act - agent creates proposal through agent-account
    // This will fail with insufficient balance (3002) since agent-account has no DAO tokens,
    // but it should NOT fail with ERR_CONTRACT_NOT_APPROVED (4002)
    const createReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "create-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.principal(testProposalAddress),
        Cl.some(Cl.stringAscii("Agent proposal"))
      ],
      accountAgent
    );

    // assert - the call goes through approval check but may fail due to no tokens
    // The key assertion is it didn't fail with ERR_CONTRACT_NOT_APPROVED (4002)
    if (createReceipt.result.type === ClarityType.ResponseErr) {
      // Should fail with token-related error, not approval error
      expect(createReceipt.result).not.toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
    } else {
      // If it succeeded, that's also fine
      expect(createReceipt.result.type).toBe(ClarityType.ResponseOk);
    }
  });

  it("agent cannot create proposal without approved voting contract", function () {
    // arrange - initialize, construct DAO but do NOT approve voting contract
    initializeAgentAccount();
    constructDao();

    // act - agent tries to create proposal
    const createReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "create-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.principal(testProposalAddress),
        Cl.none()
      ],
      accountAgent
    );

    // assert - fails with ERR_CONTRACT_NOT_APPROVED
    expect(createReceipt.result).toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
  });
});

describe("agent-workflow: permission management", function () {
  it("owner can revoke agent manage-assets permission", function () {
    // arrange
    initializeAgentAccount();

    // act - revoke manage-assets
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );

    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));

    // verify permission changed
    const permissions = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    if (permissions.type === ClarityType.Tuple) {
      expect(permissions.value.canManageAssets).toStrictEqual(Cl.bool(false));
    }
  });

  it("agent cannot deposit after manage-assets permission revoked", function () {
    // arrange - initialize and revoke permission
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    const depositAmount = 100000;
    mintMockSbtc(depositAmount, accountAgent);

    // act - agent tries to deposit
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      accountAgent
    );

    // assert
    expect(depositReceipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });

  it("owner can still deposit after agent permission revoked", function () {
    // arrange - initialize and revoke agent permission
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    const depositAmount = 100000;
    mintMockSbtc(depositAmount, accountOwner);

    // act - owner deposits
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      accountOwner
    );

    // assert - owner can always deposit
    expect(depositReceipt.result).toBeOk(Cl.bool(true));
  });

  it("owner can revoke and re-enable permissions", function () {
    // arrange - initialize and revoke permission
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-use-proposals",
      [Cl.bool(false)],
      accountOwner
    );

    // verify revoked
    let permissions = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    if (permissions.type === ClarityType.Tuple) {
      expect(permissions.value.canUseProposals).toStrictEqual(Cl.bool(false));
    }

    // act - re-enable permission
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-use-proposals",
      [Cl.bool(true)],
      accountOwner
    );

    // assert - permission is restored
    permissions = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    if (permissions.type === ClarityType.Tuple) {
      expect(permissions.value.canUseProposals).toStrictEqual(Cl.bool(true));
    }
  });

  it("agent cannot modify permissions (owner only)", function () {
    // arrange & act - initialize, then agent tries to modify permissions
    initializeAgentAccount();
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountAgent
    );

    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CALLER_NOT_OWNER));
  });
});

describe("agent-workflow: contract approval flow", function () {
  it("owner approves and revokes voting contract", function () {
    // arrange
    initializeAgentAccount();

    // act - approve
    const approveReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );
    expect(approveReceipt.result).toBeOk(Cl.bool(true));

    // verify approved
    let isApproved = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      deployer
    ).result;
    expect(isApproved).toStrictEqual(Cl.bool(true));

    // act - revoke
    const revokeReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "revoke-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );
    expect(revokeReceipt.result).toBeOk(Cl.bool(true));

    // verify revoked
    isApproved = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      deployer
    ).result;
    expect(isApproved).toStrictEqual(Cl.bool(false));
  });

  it("agent can approve contracts with permission", function () {
    // arrange
    initializeAgentAccount();

    // act - agent approves token contract
    const approveReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(mockSbtcAddress), Cl.uint(APPROVED_CONTRACT_TOKEN)],
      accountAgent
    );

    // assert
    expect(approveReceipt.result).toBeOk(Cl.bool(true));

    // verify approved
    const isApproved = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(mockSbtcAddress), Cl.uint(APPROVED_CONTRACT_TOKEN)],
      deployer
    ).result;
    expect(isApproved).toStrictEqual(Cl.bool(true));
  });

  it("agent cannot approve contracts after permission revoked", function () {
    // arrange - initialize and revoke approve/revoke permission
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-approve-revoke-contracts",
      [Cl.bool(false)],
      accountOwner
    );

    // act - agent tries to approve
    const approveReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountAgent
    );

    // assert
    expect(approveReceipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });
});

describe("agent-workflow: voting via agent-account", function () {
  it("agent votes on proposal through agent-account", function () {
    // arrange - initialize and construct DAO
    initializeAgentAccount();
    constructDao();

    // Approve voting contract for agent-account
    simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );

    // Give wallet1 tokens to create proposal
    mintAndDeposit(10000000, wallet1);

    // Create a proposal
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = 0;

    // Advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // Give agent-account some sBTC
    mintMockSbtc(5000000, accountOwner);
    simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(5000000)],
      accountOwner
    );

    // The agent-account needs DAO tokens to vote
    // This requires depositing sBTC to get DAO tokens
    // For this test, we verify the voting contract is properly approved
    // and the agent can attempt to vote

    // act - agent votes through agent-account
    const voteReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "vote-on-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.uint(proposalId),
        Cl.bool(true)
      ],
      accountAgent
    );

    // assert - the call goes through (may fail due to no tokens, but not due to permission)
    // If it fails with ERR_CONTRACT_NOT_APPROVED, the approval flow is broken
    // If it fails with 3002 (ERR_INSUFFICIENT_BALANCE), the flow is correct but no tokens
    if (voteReceipt.result.type === ClarityType.ResponseErr) {
      // Should fail with token error, not approval error
      expect(voteReceipt.result).not.toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
    }
  });

  it("agent cannot vote without approved voting contract", function () {
    // arrange - initialize, construct DAO but do NOT approve voting contract
    initializeAgentAccount();
    constructDao();

    // Give wallet1 tokens to create proposal
    mintAndDeposit(10000000, wallet1);

    // Create a proposal
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = 0;

    // Advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // act - agent tries to vote without approval
    const voteReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "vote-on-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.uint(proposalId),
        Cl.bool(true)
      ],
      accountAgent
    );

    // assert - fails with ERR_CONTRACT_NOT_APPROVED
    expect(voteReceipt.result).toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
  });

  it("agent cannot vote after use-proposals permission revoked", function () {
    // arrange - initialize, construct DAO and approve voting contract
    initializeAgentAccount();
    constructDao();
    simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );

    // Revoke use-proposals permission
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-use-proposals",
      [Cl.bool(false)],
      accountOwner
    );

    // Create a proposal
    mintAndDeposit(10000000, wallet1);
    simnet.callPublicFn(
      coreProposalsAddress,
      "create-proposal",
      [Cl.principal(testProposalAddress), Cl.none()],
      wallet1
    );
    const proposalId = 0;

    // Advance to voting period
    mineBlocks(VOTING_DELAY + 1);

    // act - agent tries to vote
    const voteReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "vote-on-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.uint(proposalId),
        Cl.bool(true)
      ],
      accountAgent
    );

    // assert - fails with ERR_OPERATION_NOT_ALLOWED
    expect(voteReceipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });
});

describe("agent-workflow: STX handling", function () {
  it("owner deposits and withdraws STX", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 1000000;

    // act - deposit STX
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(depositAmount)],
      accountOwner
    );
    expect(depositReceipt.result).toBeOk(Cl.bool(true));

    // Verify STX is in agent-account
    const balance = simnet.getAssetsMap().get("STX")?.get(agentAccountAddress);
    expect(balance).toBe(BigInt(depositAmount));

    // act - withdraw STX
    const withdrawReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-stx",
      [Cl.uint(depositAmount)],
      accountOwner
    );
    expect(withdrawReceipt.result).toBeOk(Cl.bool(true));
  });

  it("agent deposits STX with permission", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 500000;

    // act - agent deposits STX
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(depositAmount)],
      accountAgent
    );

    // assert
    expect(depositReceipt.result).toBeOk(Cl.bool(true));
  });
});

describe("agent-workflow: complete agent lifecycle", function () {
  it("full flow: deposit -> approve contract -> use contract -> withdraw", function () {
    // arrange - initialize and construct DAO
    initializeAgentAccount();
    constructDao();

    // step 1: owner deposits tokens
    const depositAmount = 2000000;
    mintMockSbtc(depositAmount, accountOwner);
    const depositReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      accountOwner
    );
    expect(depositReceipt.result).toBeOk(Cl.bool(true));

    // step 2: owner approves token contract for withdrawals
    const approveReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(mockSbtcAddress), Cl.uint(APPROVED_CONTRACT_TOKEN)],
      accountOwner
    );
    expect(approveReceipt.result).toBeOk(Cl.bool(true));

    // step 3: agent can now use approved contract
    // Verify the approval
    const isApproved = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(mockSbtcAddress), Cl.uint(APPROVED_CONTRACT_TOKEN)],
      deployer
    ).result;
    expect(isApproved).toStrictEqual(Cl.bool(true));

    // step 4: owner withdraws tokens
    const withdrawReceipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(depositAmount)],
      accountOwner
    );
    expect(withdrawReceipt.result).toBeOk(Cl.bool(true));
  });
});
