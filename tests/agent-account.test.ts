import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// contract info
const agentAccountAddress = `${deployer}.agent-account`;
const agentRegistryAddress = `${deployer}.agent-registry`;
const coreProposalsAddress = `${deployer}.core-proposals`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const daoTokenAddress = `${deployer}.dao-token`;
const testProposalAddress = `${deployer}.test-proposal`;

// The agent-account uses deployer as owner and wallet_2 as agent
// (set via initialize after deployment)
const accountOwner = deployer;
const accountAgent = wallet2;
const unauthorized = wallet3;

// Error codes
const ERR_CALLER_NOT_OWNER = 4000;
const ERR_OPERATION_NOT_ALLOWED = 4001;
const ERR_CONTRACT_NOT_APPROVED = 4002;
const ERR_INVALID_APPROVAL_TYPE = 4003;
const ERR_ZERO_AMOUNT = 4004;
const ERR_ALREADY_INITIALIZED = 4005;
const ERR_NOT_INITIALIZED = 4006;

// Permission flags
const PERMISSION_MANAGE_ASSETS = 1; // pow(2, 0)
const PERMISSION_USE_PROPOSALS = 2; // pow(2, 1)
const PERMISSION_APPROVE_REVOKE_CONTRACTS = 4; // pow(2, 2)
const PERMISSION_BUY_SELL_ASSETS = 8; // pow(2, 3)
const DEFAULT_PERMISSIONS = 7; // 1 + 2 + 4

// Contract approval types
const APPROVED_CONTRACT_VOTING = 1;
const APPROVED_CONTRACT_SWAP = 2;
const APPROVED_CONTRACT_TOKEN = 3;

// Helper: initialize the agent account with deployer as owner, wallet2 as agent
function initializeAgentAccount() {
  const receipt = simnet.callPublicFn(
    agentAccountAddress,
    "initialize",
    [Cl.principal(accountOwner), Cl.principal(accountAgent)],
    deployer
  );
  expect(receipt.result).toBeOk(Cl.bool(true));
}

describe("agent-account: initialization", function () {
  it("initialize() succeeds for deployer", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "initialize",
      [Cl.principal(accountOwner), Cl.principal(accountAgent)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("initialize() fails for non-deployer", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "initialize",
      [Cl.principal(accountOwner), Cl.principal(accountAgent)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CALLER_NOT_OWNER));
  });

  it("initialize() fails if called twice", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "initialize",
      [Cl.principal(accountOwner), Cl.principal(accountAgent)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ALREADY_INITIALIZED));
  });

  it("operations fail before initialization", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(1000000)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_INITIALIZED));
  });

  it("get-config() returns error before initialization", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "get-config",
      [],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_INITIALIZED));
  });

  it("get-config() returns ok after initialization", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "get-config",
      [],
      deployer
    );
    // assert
    expect(receipt.result.type).toBe(ClarityType.ResponseOk);
  });
});

describe("agent-account: initial state", function () {
  it("get-configuration() returns valid contract configuration before init", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-configuration",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
    expect(result).toStrictEqual(
      Cl.tuple({
        account: Cl.principal(agentAccountAddress),
        owner: Cl.none(),
        agent: Cl.none(),
        initialized: Cl.bool(false),
        deployer: Cl.principal(deployer),
        deployedBurnBlock: Cl.uint(3),
        deployedStacksBlock: Cl.uint(3),
      })
    );
  });

  it("get-configuration() returns principals after initialization", function () {
    // arrange
    initializeAgentAccount();
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-configuration",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
    expect(result).toStrictEqual(
      Cl.tuple({
        account: Cl.principal(agentAccountAddress),
        owner: Cl.some(Cl.principal(accountOwner)),
        agent: Cl.some(Cl.principal(accountAgent)),
        initialized: Cl.bool(true),
        deployer: Cl.principal(deployer),
        deployedBurnBlock: Cl.uint(3),
        deployedStacksBlock: Cl.uint(3),
      })
    );
  });

  it("get-agent-permissions() returns default permissions", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(DEFAULT_PERMISSIONS),
        canManageAssets: Cl.bool(true),
        canUseProposals: Cl.bool(true),
        canApproveRevokeContracts: Cl.bool(true),
        canBuySellAssets: Cl.bool(false)
      })
    );
  });

  it("get-permission-flags() returns correct flag values", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-permission-flags",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(
      Cl.tuple({
        manageAssets: Cl.uint(PERMISSION_MANAGE_ASSETS),
        useProposals: Cl.uint(PERMISSION_USE_PROPOSALS),
        approveRevokeContracts: Cl.uint(PERMISSION_APPROVE_REVOKE_CONTRACTS),
        buySellAssets: Cl.uint(PERMISSION_BUY_SELL_ASSETS),
        defaultPermissions: Cl.uint(DEFAULT_PERMISSIONS)
      })
    );
  });

  it("get-approval-types() returns correct type values", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-approval-types",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(
      Cl.tuple({
        voting: Cl.uint(APPROVED_CONTRACT_VOTING),
        swap: Cl.uint(APPROVED_CONTRACT_SWAP),
        token: Cl.uint(APPROVED_CONTRACT_TOKEN)
      })
    );
  });

  it("is-approved-contract() returns false for unapproved contracts", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });
});

describe("agent-account: STX deposit/withdraw", function () {
  it("deposit-stx() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    const amount = 1000000; // 1 STX
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(amount)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // Verify the STX was transferred
    const balance = simnet.getAssetsMap().get("STX")?.get(agentAccountAddress);
    expect(balance).toBe(BigInt(amount));
  });

  it("deposit-stx() succeeds for agent with permission", function () {
    // arrange
    initializeAgentAccount();
    const amount = 500000;
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(amount)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("deposit-stx() fails for unauthorized caller", function () {
    // arrange
    initializeAgentAccount();
    const amount = 100000;
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(amount)],
      unauthorized
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });

  it("deposit-stx() fails for zero amount", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(0)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });

  it("withdraw-stx() succeeds for owner and sends to owner", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 2000000;
    const withdrawAmount = 1000000;
    simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(depositAmount)],
      accountOwner
    );
    const ownerBalanceBefore = simnet.getAssetsMap().get("STX")?.get(accountOwner) || BigInt(0);
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-stx",
      [Cl.uint(withdrawAmount)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const ownerBalanceAfter = simnet.getAssetsMap().get("STX")?.get(accountOwner) || BigInt(0);
    expect(ownerBalanceAfter - ownerBalanceBefore).toBe(BigInt(withdrawAmount));
  });

  it("withdraw-stx() succeeds for agent with permission", function () {
    // arrange
    initializeAgentAccount();
    const depositAmount = 2000000;
    const withdrawAmount = 500000;
    simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(depositAmount)],
      accountOwner
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-stx",
      [Cl.uint(withdrawAmount)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("withdraw-stx() fails for unauthorized caller", function () {
    // arrange
    initializeAgentAccount();
    const amount = 100000;
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-stx",
      [Cl.uint(amount)],
      unauthorized
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });
});

describe("agent-account: FT deposit/withdraw", function () {
  it("deposit-ft() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    const amount = 1000;
    // First mint some mock-sbtc to owner
    simnet.callPublicFn(
      mockSbtcAddress,
      "mint",
      [Cl.uint(amount), Cl.principal(accountOwner)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("deposit-ft() succeeds for agent with permission", function () {
    // arrange
    initializeAgentAccount();
    const amount = 500;
    simnet.callPublicFn(
      mockSbtcAddress,
      "mint",
      [Cl.uint(amount), Cl.principal(accountAgent)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("deposit-ft() fails for unauthorized caller", function () {
    // arrange
    initializeAgentAccount();
    const amount = 100;
    simnet.callPublicFn(
      mockSbtcAddress,
      "mint",
      [Cl.uint(amount), Cl.principal(unauthorized)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      unauthorized
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });

  it("withdraw-ft() requires approved token contract", function () {
    // arrange
    initializeAgentAccount();
    const amount = 100;
    simnet.callPublicFn(
      mockSbtcAddress,
      "mint",
      [Cl.uint(amount), Cl.principal(accountOwner)],
      deployer
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      accountOwner
    );
    // act - try to withdraw without approving the token contract
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
  });

  it("withdraw-ft() succeeds after token contract is approved", function () {
    // arrange
    initializeAgentAccount();
    const amount = 100;
    simnet.callPublicFn(
      mockSbtcAddress,
      "mint",
      [Cl.uint(amount), Cl.principal(accountOwner)],
      deployer
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      accountOwner
    );
    // Approve the token contract first
    simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(mockSbtcAddress), Cl.uint(APPROVED_CONTRACT_TOKEN)],
      accountOwner
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "withdraw-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(amount)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("agent-account: contract approval/revocation", function () {
  it("approve-contract() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // Verify approval
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("approve-contract() succeeds for agent with permission", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(mockSbtcAddress), Cl.uint(APPROVED_CONTRACT_TOKEN)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("approve-contract() fails for unauthorized caller", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      unauthorized
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });

  it("approve-contract() fails for invalid type", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(99)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INVALID_APPROVAL_TYPE));
  });

  it("revoke-contract() removes approval", function () {
    // arrange
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "revoke-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );
    // assert - revoke-contract returns (ok true) on success
    expect(receipt.result).toBeOk(Cl.bool(true));
    // Verify revocation
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "is-approved-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.bool(false));
  });
});

describe("agent-account: permission management", function () {
  it("set-agent-can-manage-assets() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    // act - disable manage assets
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // Verify permission changed
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(6), // 2 + 4 = useProposals + approveRevoke
        canManageAssets: Cl.bool(false),
        canUseProposals: Cl.bool(true),
        canApproveRevokeContracts: Cl.bool(true),
        canBuySellAssets: Cl.bool(false)
      })
    );
  });

  it("set-agent-can-manage-assets() fails for non-owner", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CALLER_NOT_OWNER));
  });

  it("set-agent-can-use-proposals() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-use-proposals",
      [Cl.bool(false)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(5), // 1 + 4 = manageAssets + approveRevoke
        canManageAssets: Cl.bool(true),
        canUseProposals: Cl.bool(false),
        canApproveRevokeContracts: Cl.bool(true),
        canBuySellAssets: Cl.bool(false)
      })
    );
  });

  it("set-agent-can-approve-revoke-contracts() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-approve-revoke-contracts",
      [Cl.bool(false)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(3), // 1 + 2 = manageAssets + useProposals
        canManageAssets: Cl.bool(true),
        canUseProposals: Cl.bool(true),
        canApproveRevokeContracts: Cl.bool(false),
        canBuySellAssets: Cl.bool(false)
      })
    );
  });

  it("set-agent-can-buy-sell-assets() succeeds for owner", function () {
    // arrange
    initializeAgentAccount();
    // act - enable buy/sell (disabled by default)
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-buy-sell-assets",
      [Cl.bool(true)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(15), // 1 + 2 + 4 + 8
        canManageAssets: Cl.bool(true),
        canUseProposals: Cl.bool(true),
        canApproveRevokeContracts: Cl.bool(true),
        canBuySellAssets: Cl.bool(true)
      })
    );
  });

  it("agent cannot deposit after permission is revoked", function () {
    // arrange
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(100000)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });

  it("agent can deposit after permission is re-enabled", function () {
    // arrange
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(true)],
      accountOwner
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(100000)],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("owner can always deposit regardless of agent permissions", function () {
    // arrange - disable agent manage assets
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    // act - owner should still work
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "deposit-stx",
      [Cl.uint(100000)],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("agent-account: get-config trait implementation", function () {
  it("get-config() returns ok response after initialization", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "get-config",
      [],
      deployer
    );
    // assert
    expect(receipt.result.type).toBe(ClarityType.ResponseOk);
  });
});

describe("agent-account: proposal interaction", function () {
  it("create-proposal() fails without approved voting contract", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "create-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.principal(testProposalAddress),
        Cl.none()
      ],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
  });

  it("vote-on-proposal() fails without approved voting contract", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "vote-on-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.uint(0),
        Cl.bool(true)
      ],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
  });

  it("conclude-proposal() fails without approved voting contract", function () {
    // arrange
    initializeAgentAccount();
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "conclude-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.uint(0),
        Cl.principal(testProposalAddress)
      ],
      accountOwner
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_CONTRACT_NOT_APPROVED));
  });

  it("agent cannot use proposals after permission is revoked", function () {
    // arrange
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "approve-contract",
      [Cl.principal(coreProposalsAddress), Cl.uint(APPROVED_CONTRACT_VOTING)],
      accountOwner
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-use-proposals",
      [Cl.bool(false)],
      accountOwner
    );
    // act
    const receipt = simnet.callPublicFn(
      agentAccountAddress,
      "vote-on-proposal",
      [
        Cl.principal(coreProposalsAddress),
        Cl.uint(0),
        Cl.bool(true)
      ],
      accountAgent
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_OPERATION_NOT_ALLOWED));
  });
});

describe("agent-account: bit operations", function () {
  it("permissions use correct bit patterns", function () {
    // arrange
    // act - get permission flags
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-permission-flags",
      [],
      deployer
    ).result;
    // assert - using Clarity comparisons
    expect(result).toStrictEqual(
      Cl.tuple({
        manageAssets: Cl.uint(PERMISSION_MANAGE_ASSETS),
        useProposals: Cl.uint(PERMISSION_USE_PROPOSALS),
        approveRevokeContracts: Cl.uint(PERMISSION_APPROVE_REVOKE_CONTRACTS),
        buySellAssets: Cl.uint(PERMISSION_BUY_SELL_ASSETS),
        defaultPermissions: Cl.uint(DEFAULT_PERMISSIONS)
      })
    );
  });

  it("default permissions is sum of first 3 flags", function () {
    // arrange
    const expected = PERMISSION_MANAGE_ASSETS +
                     PERMISSION_USE_PROPOSALS +
                     PERMISSION_APPROVE_REVOKE_CONTRACTS;
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-permission-flags",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
    // Verify default permissions equals 7
    expect(expected).toBe(DEFAULT_PERMISSIONS);
  });

  it("enabling buy-sell adds bit correctly", function () {
    // arrange
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-buy-sell-assets",
      [Cl.bool(true)],
      accountOwner
    );
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    // assert - raw permissions should be 15 (1 + 2 + 4 + 8)
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(15),
        canManageAssets: Cl.bool(true),
        canUseProposals: Cl.bool(true),
        canApproveRevokeContracts: Cl.bool(true),
        canBuySellAssets: Cl.bool(true)
      })
    );
  });

  it("disabling all permissions results in 0", function () {
    // arrange
    initializeAgentAccount();
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-manage-assets",
      [Cl.bool(false)],
      accountOwner
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-use-proposals",
      [Cl.bool(false)],
      accountOwner
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-approve-revoke-contracts",
      [Cl.bool(false)],
      accountOwner
    );
    simnet.callPublicFn(
      agentAccountAddress,
      "set-agent-can-buy-sell-assets",
      [Cl.bool(false)],
      accountOwner
    );
    // act
    const result = simnet.callReadOnlyFn(
      agentAccountAddress,
      "get-agent-permissions",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(
      Cl.tuple({
        rawPermissions: Cl.uint(0),
        canManageAssets: Cl.bool(false),
        canUseProposals: Cl.bool(false),
        canApproveRevokeContracts: Cl.bool(false),
        canBuySellAssets: Cl.bool(false)
      })
    );
  });
});

describe("agent-account: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_CALLER_NOT_OWNER).toBe(4000);
    expect(ERR_OPERATION_NOT_ALLOWED).toBe(4001);
    expect(ERR_CONTRACT_NOT_APPROVED).toBe(4002);
    expect(ERR_INVALID_APPROVAL_TYPE).toBe(4003);
    expect(ERR_ZERO_AMOUNT).toBe(4004);
    expect(ERR_ALREADY_INITIALIZED).toBe(4005);
    expect(ERR_NOT_INITIALIZED).toBe(4006);
  });

  it("documents permission flags", function () {
    expect(PERMISSION_MANAGE_ASSETS).toBe(1);
    expect(PERMISSION_USE_PROPOSALS).toBe(2);
    expect(PERMISSION_APPROVE_REVOKE_CONTRACTS).toBe(4);
    expect(PERMISSION_BUY_SELL_ASSETS).toBe(8);
    expect(DEFAULT_PERMISSIONS).toBe(7);
  });

  it("documents contract approval types", function () {
    expect(APPROVED_CONTRACT_VOTING).toBe(1);
    expect(APPROVED_CONTRACT_SWAP).toBe(2);
    expect(APPROVED_CONTRACT_TOKEN).toBe(3);
  });
});
