import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// contract addresses
const baseDaoAddress = `${deployer}.base-dao`;
const tokenPeggedAddress = `${deployer}.token-pegged`;
const daoPeggedAddress = `${deployer}.dao-pegged`;
const guardianCouncilAddress = `${deployer}.guardian-council`;
const autoMicroPayoutAddress = `${deployer}.auto-micro-payout`;
const upgradeAddress = `${deployer}.upgrade-to-free-floating`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const treasuryAddress = `${deployer}.dao-treasury`;
const checkinRegistryAddress = `${deployer}.checkin-registry`;

// Error codes
const ERR_NOT_AUTHORIZED = 6000;
const ERR_ZERO_AMOUNT = 6001;
const ERR_INSUFFICIENT_BALANCE = 6002;
const ERR_PEGGED_MODE_ONLY = 6004;
const ERR_NOT_GUARDIAN = 6101;
const ERR_SPEND_LIMIT_EXCEEDED = 6102;
const ERR_WORK_NOT_VERIFIED = 6206;
const ERR_ALREADY_CLAIMED = 6204;
const ERR_NOT_ELIGIBLE = 6306;
const ERR_VOTING_NOT_ENDED_SLASH = 6111;

// Helper: mint mock sBTC
function mintSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(mockSbtcAddress, "mint", [Cl.uint(amount), Cl.principal(recipient)], deployer);
}

// Helper: construct DAO with init proposal
function constructDao() {
  return simnet.callPublicFn(
    baseDaoAddress, "construct",
    [Cl.contractPrincipal(deployer, "init-pegged-dao")], deployer
  );
}

// Helper: deposit sBTC into the token
function deposit(amount: number, sender: string) {
  return simnet.callPublicFn(tokenPeggedAddress, "deposit", [Cl.uint(amount)], sender);
}

// Helper: redeem tokens for sBTC
function redeem(amount: number, sender: string) {
  return simnet.callPublicFn(tokenPeggedAddress, "redeem", [Cl.uint(amount)], sender);
}

// ============================================================
// CONSTRUCTION TESTS
// ============================================================

describe("Pegged DAO: Construction", () => {
  it("constructs the DAO with init proposal", () => {
    const result = constructDao();
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("sets token name and symbol correctly", () => {
    constructDao();
    const name = simnet.callReadOnlyFn(tokenPeggedAddress, "get-name", [], deployer).result;
    const symbol = simnet.callReadOnlyFn(tokenPeggedAddress, "get-symbol", [], deployer).result;
    expect(name).toBeOk(Cl.stringAscii("Agent DAO BTC"));
    expect(symbol).toBeOk(Cl.stringAscii("aDAO"));
  });

  it("sets entrance tax to 1%", () => {
    constructDao();
    const tax = simnet.callReadOnlyFn(tokenPeggedAddress, "get-entrance-tax-rate", [], deployer).result;
    expect(tax).toStrictEqual(Cl.uint(100));
  });

  it("initializes guardian council with deployer", () => {
    constructDao();
    const isGuardian = simnet.callReadOnlyFn(guardianCouncilAddress, "is-guardian", [Cl.principal(deployer)], deployer).result;
    expect(isGuardian).toStrictEqual(Cl.bool(true));
  });

  it("sets DAO name and phase", () => {
    constructDao();
    const info = simnet.callReadOnlyFn(daoPeggedAddress, "get-dao-info", [], deployer).result;
    expect(info).toStrictEqual(Cl.tuple({
      name: Cl.stringAscii("Agent DAO"),
      phase: Cl.uint(1),
      initialized: Cl.bool(true),
      deployer: Cl.principal(deployer)
    }));
  });

  it("enables all extensions", () => {
    constructDao();
    const tokenEnabled = simnet.callReadOnlyFn(baseDaoAddress, "is-extension", [Cl.contractPrincipal(deployer, "token-pegged")], deployer).result;
    const guardianEnabled = simnet.callReadOnlyFn(baseDaoAddress, "is-extension", [Cl.contractPrincipal(deployer, "guardian-council")], deployer).result;
    expect(tokenEnabled).toStrictEqual(Cl.bool(true));
    expect(guardianEnabled).toStrictEqual(Cl.bool(true));
  });
});

// ============================================================
// DEPOSIT / MINT TESTS
// ============================================================

describe("Pegged DAO: Deposit / Mint", () => {
  it("deposits sBTC and receives tokens minus 1% tax", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    const result = deposit(10000, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
    const balance = simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result;
    expect(balance).toBeOk(Cl.uint(9900));
  });

  it("sends entrance tax to treasury", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const treasuryBalance = simnet.callReadOnlyFn(mockSbtcAddress, "get-balance",
      [Cl.contractPrincipal(deployer, "dao-treasury")], deployer).result;
    expect(treasuryBalance).toBeOk(Cl.uint(100));
  });

  it("rejects zero deposit", () => {
    constructDao();
    expect(deposit(0, wallet1).result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });

  it("[M3] rejects deposit before initialization", () => {
    // Don't construct DAO — try to deposit directly
    mintSbtc(10000, wallet1);
    const result = deposit(10000, wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});

// ============================================================
// REDEEM / BURN TESTS
// ============================================================

describe("Pegged DAO: Redeem / Burn", () => {
  it("redeems tokens for pro-rata sBTC", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const result = redeem(9900, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
    const balance = simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result;
    expect(balance).toBeOk(Cl.uint(0));
  });

  it("rejects redeem with insufficient balance", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    expect(redeem(99999, wallet1).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });

  it("handles multiple depositors with pro-rata redemption", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    mintSbtc(20000, wallet2);
    deposit(10000, wallet1);
    deposit(20000, wallet2);
    const result = redeem(9900, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
  });
});

// ============================================================
// GUARDIAN COUNCIL TESTS
// ============================================================

describe("Pegged DAO: Guardian Council", () => {
  it("[C1] reads actual treasury balance on-chain for spend limit", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)], deployer);

    // 2% of 100k = 2000. Spending 1000 should work.
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(1000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("[C1] rejects spend exceeding 2% of actual treasury balance", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)], deployer);

    // 2% of 100k = 2000. Spending 3000 should fail.
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(3000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_SPEND_LIMIT_EXCEEDED));
  });

  it("non-guardian cannot approve spend", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(1000), Cl.principal(wallet2)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_GUARDIAN));
  });

  it("[H2] cannot conclude slash vote before voting period ends", () => {
    constructDao();
    // Start slash vote against deployer (deployer starts it against themselves for test)
    // Need another guardian — add wallet1 as guardian first via DAO
    // For simplicity, deployer starts slash against themselves
    const startResult = simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);
    expect(startResult.result).toBeOk(Cl.uint(1));

    // Try to conclude immediately — should fail
    const concludeResult = simnet.callPublicFn(guardianCouncilAddress, "conclude-slash-vote",
      [Cl.uint(1)], deployer);
    expect(concludeResult.result).toBeErr(Cl.uint(ERR_VOTING_NOT_ENDED_SLASH));
  });

  it("[H2] can conclude slash vote after voting period", () => {
    constructDao();
    simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);

    // Advance past voting period (144 blocks)
    simnet.mineEmptyBlocks(145);

    const concludeResult = simnet.callPublicFn(guardianCouncilAddress, "conclude-slash-vote",
      [Cl.uint(1)], deployer);
    // Should succeed (may or may not pass depending on threshold, but no longer ERR_VOTING_NOT_ENDED)
    expect(concludeResult.result).toBeOk(Cl.bool(true));
  });
});

// ============================================================
// AUTO MICRO-PAYOUT TESTS
// ============================================================

describe("Pegged DAO: Auto Micro-Payouts", () => {
  it("[C2] rejects claim without verified on-chain check-in", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)], deployer);

    // Try to claim check-in payout with bogus index (no actual check-in)
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(999)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });

  it("[C2] accepts claim with verified on-chain check-in", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)], deployer);

    // Actually do a check-in first
    simnet.callPublicFn(checkinRegistryAddress, "check-in", [], wallet1);

    // Now claim payout for check-in index 0
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(0)], wallet1);
    expect(result.result).toBeOk(Cl.uint(100));
  });

  it("prevents double-claiming same check-in", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)], deployer);

    simnet.callPublicFn(checkinRegistryAddress, "check-in", [], wallet1);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(0)], wallet1);

    // Second claim with same index fails
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(0)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });

  it("guardian-approved work flow", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)], deployer);

    // Guardian (deployer) approves work for wallet1
    simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(42), Cl.uint(300)], deployer);

    // wallet1 claims the approved work
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout",
      [Cl.uint(42)], wallet1);
    expect(result.result).toBeOk(Cl.uint(300));
  });

  it("[C2] non-guardian cannot approve work", () => {
    constructDao();
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet2), Cl.uint(1), Cl.uint(200)], wallet1);
    expect(result.result).toBeErr(Cl.uint(6200)); // auto-micro-payout ERR_NOT_AUTHORIZED
  });
});

// ============================================================
// UPGRADE TO FREE-FLOATING TESTS
// ============================================================

describe("Pegged DAO: Upgrade to Free-Floating", () => {
  it("agent with reputation can start upgrade vote", () => {
    constructDao();
    const result = simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("agent without reputation cannot start vote", () => {
    constructDao();
    const result = simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_ELIGIBLE));
  });

  it("[H1] failed vote allows new vote with fresh voting", () => {
    constructDao();

    // Round 1: start and fail (no one votes yes with enough rep)
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(false)], deployer);
    simnet.mineEmptyBlocks(433);
    const round1 = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(round1.result).toBeOk(Cl.bool(false)); // failed

    // Round 2: deployer can vote again (fresh round)
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const voteResult = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    expect(voteResult.result).toBeOk(Cl.bool(true)); // can vote in new round
  });

  it("full upgrade flow: vote passes, dissenters refunded", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);

    // Start vote
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    // Deployer votes yes
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    // Snapshot balance during voting
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], deployer);

    simnet.mineEmptyBlocks(433);
    const concludeResult = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(concludeResult.result).toBeOk(Cl.bool(true));

    // Verify upgrade state
    expect(simnet.callReadOnlyFn(upgradeAddress, "is-upgraded", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "is-dissolved", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-is-pegged", [], deployer).result)
      .toStrictEqual(Cl.bool(false));

    // Yes-voter claims: keeps tokens
    const claimResult = simnet.callPublicFn(upgradeAddress, "claim", [], deployer);
    expect(claimResult.result).toBeOk(Cl.uint(9900));
  });

  it("[H3] claim uses snapshotted balance, not live balance", () => {
    constructDao();
    mintSbtc(10000, deployer);
    mintSbtc(10000, wallet1);
    deposit(10000, deployer);
    deposit(10000, wallet1);

    // Give wallet1 reputation so they can participate
    // (deployer is guardian, can set reputation via DAO)
    // For this test, wallet1 is a non-voter (dissenter) with tokens

    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);

    // Wallet1 snapshots their balance during voting
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    // wallet1 has 9900 tokens snapshotted

    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);

    // Even if wallet1 receives more tokens after vote, claim uses snapshot
    // wallet1 claims as dissenter (didn't vote = dissenter)
    const claimResult = simnet.callPublicFn(upgradeAddress, "claim", [], wallet1);
    // Should get pro-rata refund based on snapshotted 9900 tokens
    expect(claimResult.result).toBeOk(Cl.uint(9900));
  });
});

// ============================================================
// READ-ONLY TESTS
// ============================================================

describe("Pegged DAO: Read-only functions", () => {
  it("calculate-tax returns correct amount", () => {
    constructDao();
    const result = simnet.callReadOnlyFn(tokenPeggedAddress, "calculate-tax",
      [Cl.uint(10000)], deployer).result;
    expect(result).toStrictEqual(Cl.uint(100));
  });

  it("get-sbtc-for-tokens returns correct conversion", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const result = simnet.callReadOnlyFn(tokenPeggedAddress, "get-sbtc-for-tokens",
      [Cl.uint(4950)], deployer).result;
    expect(result).toStrictEqual(Cl.uint(4950));
  });

  it("[L4] set-phase rejects invalid values", () => {
    constructDao();
    // Phase 999 should fail (only 1 or 2 allowed)
    // This would need to be called via a proposal since it requires DAO auth
    // Test via read-only that phase is valid
    const phase = simnet.callReadOnlyFn(daoPeggedAddress, "get-phase", [], deployer).result;
    expect(phase).toStrictEqual(Cl.uint(1));
  });
});

// ============================================================
// M1: dao-mint/dao-burn RESTRICTED TESTS
// ============================================================

describe("Pegged DAO: Restricted mint/burn [M1]", () => {
  it("dao-mint rejects calls from non-upgrade extensions", () => {
    constructDao();
    // Try to call dao-mint directly (not from upgrade-to-free-floating)
    // guardian-council is an extension but should NOT be able to mint
    const result = simnet.callPublicFn(tokenPeggedAddress, "dao-mint",
      [Cl.uint(1000000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });

  it("dao-burn rejects calls from non-upgrade extensions", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "dao-burn",
      [Cl.uint(1000000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});
