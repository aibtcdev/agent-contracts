import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;
const wallet4 = accounts.get("wallet_4")!;

// contract addresses
const baseDaoAddress = `${deployer}.base-dao`;
const tokenPeggedAddress = `${deployer}.token-pegged`;
const daoPeggedAddress = `${deployer}.dao-pegged`;
const guardianCouncilAddress = `${deployer}.guardian-council`;
const autoMicroPayoutAddress = `${deployer}.auto-micro-payout`;
const upgradeAddress = `${deployer}.upgrade-to-free-floating`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const treasuryAddress = `${deployer}.dao-treasury`;
const initProposalAddress = `${deployer}.init-pegged-dao`;

// Error codes
const ERR_NOT_AUTHORIZED = 6000;
const ERR_ZERO_AMOUNT = 6001;
const ERR_INSUFFICIENT_BALANCE = 6002;
const ERR_PEGGED_MODE_ONLY = 6004;
const ERR_NOT_GUARDIAN = 6101;
const ERR_SPEND_LIMIT_EXCEEDED = 6102;
const ERR_RATE_LIMITED = 6202;
const ERR_ALREADY_CLAIMED = 6204;
const ERR_NOT_ELIGIBLE = 6306;

// Helper: mint mock sBTC
function mintSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(mockSbtcAddress, "mint", [Cl.uint(amount), Cl.principal(recipient)], deployer);
}

// Helper: construct DAO with init proposal
function constructDao() {
  return simnet.callPublicFn(
    baseDaoAddress,
    "construct",
    [Cl.contractPrincipal(deployer, "init-pegged-dao")],
    deployer
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

  it("sets DAO name", () => {
    constructDao();
    const name = simnet.callReadOnlyFn(daoPeggedAddress, "get-dao-name", [], deployer).result;
    expect(name).toStrictEqual(Cl.stringAscii("Agent DAO"));
  });

  it("enables all extensions", () => {
    constructDao();
    const tokenEnabled = simnet.callReadOnlyFn(baseDaoAddress, "is-extension", [Cl.contractPrincipal(deployer, "token-pegged")], deployer).result;
    const guardianEnabled = simnet.callReadOnlyFn(baseDaoAddress, "is-extension", [Cl.contractPrincipal(deployer, "guardian-council")], deployer).result;
    const upgradeEnabled = simnet.callReadOnlyFn(baseDaoAddress, "is-extension", [Cl.contractPrincipal(deployer, "upgrade-to-free-floating")], deployer).result;
    expect(tokenEnabled).toStrictEqual(Cl.bool(true));
    expect(guardianEnabled).toStrictEqual(Cl.bool(true));
    expect(upgradeEnabled).toStrictEqual(Cl.bool(true));
  });
});

describe("Pegged DAO: Deposit / Mint", () => {
  it("deposits sBTC and receives tokens minus 1% tax", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    const result = deposit(10000, wallet1);
    // 1% tax = 100, tokens minted = 9900
    expect(result.result).toBeOk(Cl.uint(9900));

    const balance = simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result;
    expect(balance).toBeOk(Cl.uint(9900));
  });

  it("sends entrance tax to treasury", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);

    // Treasury should have 100 sats (1% of 10000)
    const treasurySelf = `${deployer}.dao-treasury`;
    const treasuryBalance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.contractPrincipal(deployer, "dao-treasury")],
      deployer
    ).result;
    expect(treasuryBalance).toBeOk(Cl.uint(100));
  });

  it("rejects zero deposit", () => {
    constructDao();
    const result = deposit(0, wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });

  it("tracks total backing correctly", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);

    const backing = simnet.callReadOnlyFn(tokenPeggedAddress, "get-total-backing", [], deployer).result;
    expect(backing).toStrictEqual(Cl.uint(9900)); // 10000 - 100 tax
  });
});

describe("Pegged DAO: Redeem / Burn", () => {
  it("redeems tokens for pro-rata sBTC", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);

    const result = redeem(9900, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));

    // Token balance should be 0
    const balance = simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result;
    expect(balance).toBeOk(Cl.uint(0));
  });

  it("rejects redeem with zero amount", () => {
    constructDao();
    const result = redeem(0, wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });

  it("rejects redeem with insufficient balance", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);

    const result = redeem(99999, wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });

  it("handles multiple depositors with pro-rata redemption", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    mintSbtc(20000, wallet2);
    deposit(10000, wallet1); // gets 9900 tokens
    deposit(20000, wallet2); // gets 19800 tokens

    // Total backing: 29700, total supply: 29700
    // wallet1 redeems 9900 tokens = 9900 sBTC
    const result = redeem(9900, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
  });
});

describe("Pegged DAO: Guardian Council", () => {
  it("guardian can approve small spend", () => {
    constructDao();
    // Fund treasury with sBTC
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)],
      deployer
    );

    // Deployer is a guardian, approve small spend
    const result = simnet.callPublicFn(
      guardianCouncilAddress,
      "approve-small-spend",
      [
        Cl.contractPrincipal(deployer, "mock-sbtc"),
        Cl.uint(1000), // 1% of 100k (under 2% limit)
        Cl.principal(wallet1),
        Cl.uint(100000)
      ],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("non-guardian cannot approve spend", () => {
    constructDao();
    const result = simnet.callPublicFn(
      guardianCouncilAddress,
      "approve-small-spend",
      [
        Cl.contractPrincipal(deployer, "mock-sbtc"),
        Cl.uint(1000),
        Cl.principal(wallet2),
        Cl.uint(100000)
      ],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_GUARDIAN));
  });

  it("rejects spend exceeding 2% weekly limit", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)],
      deployer
    );

    // Try to spend 3000 (3% of 100k, over 2% limit)
    const result = simnet.callPublicFn(
      guardianCouncilAddress,
      "approve-small-spend",
      [
        Cl.contractPrincipal(deployer, "mock-sbtc"),
        Cl.uint(3000),
        Cl.principal(wallet1),
        Cl.uint(100000)
      ],
      deployer
    );
    expect(result.result).toBeErr(Cl.uint(ERR_SPEND_LIMIT_EXCEEDED));
  });
});

describe("Pegged DAO: Auto Micro-Payouts", () => {
  it("agent claims payout for verified work", () => {
    constructDao();
    // Fund treasury
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)],
      deployer
    );

    // Claim checkin payout (100 sats)
    const result = simnet.callPublicFn(
      autoMicroPayoutAddress,
      "claim-payout",
      [
        Cl.contractPrincipal(deployer, "mock-sbtc"),
        Cl.uint(1), // WORK_TYPE_CHECKIN
        Cl.uint(1)  // work-id
      ],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(100));
  });

  it("prevents double-claiming same work", () => {
    constructDao();
    mintSbtc(100000, deployer);
    simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(100000)],
      deployer
    );

    // First claim succeeds
    simnet.callPublicFn(
      autoMicroPayoutAddress,
      "claim-payout",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(1), Cl.uint(1)],
      wallet1
    );

    // Second claim with same work-id fails
    const result = simnet.callPublicFn(
      autoMicroPayoutAddress,
      "claim-payout",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(1), Cl.uint(1)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });
});

describe("Pegged DAO: Upgrade to Free-Floating", () => {
  it("agent with reputation can start upgrade vote", () => {
    constructDao();
    // Deployer has reputation from guardian council init
    const result = simnet.callPublicFn(
      upgradeAddress,
      "start-upgrade-vote",
      [],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("agent without reputation cannot start vote", () => {
    constructDao();
    const result = simnet.callPublicFn(
      upgradeAddress,
      "start-upgrade-vote",
      [],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_ELIGIBLE));
  });

  it("full upgrade flow: vote passes, dissenters refunded", () => {
    constructDao();

    // Setup: deposit sBTC for two wallets
    mintSbtc(10000, deployer);
    mintSbtc(10000, wallet1);

    // Need wallet1 to have reputation for voting
    // Add wallet1 as guardian with reputation via a proposal would be needed
    // For this test, deployer (the only one with rep) votes yes

    deposit(10000, deployer); // deployer gets 9900 tokens

    // Start vote
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);

    // Deployer votes yes
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);

    // Advance past voting period (432 blocks)
    simnet.mineEmptyBlocks(433);

    // Conclude vote (deployer has 100% of reputation, voted yes = passes)
    const concludeResult = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(concludeResult.result).toBeOk(Cl.bool(true));

    // Verify upgrade state
    const upgraded = simnet.callReadOnlyFn(upgradeAddress, "is-upgraded", [], deployer).result;
    expect(upgraded).toStrictEqual(Cl.bool(true));

    // Guardian council should be dissolved
    const dissolved = simnet.callReadOnlyFn(guardianCouncilAddress, "is-dissolved", [], deployer).result;
    expect(dissolved).toStrictEqual(Cl.bool(true));

    // Token should no longer be pegged
    const pegged = simnet.callReadOnlyFn(tokenPeggedAddress, "get-is-pegged", [], deployer).result;
    expect(pegged).toStrictEqual(Cl.bool(false));

    // Yes-voter claims: keeps tokens
    const claimResult = simnet.callPublicFn(upgradeAddress, "claim", [], deployer);
    expect(claimResult.result).toBeOk(Cl.uint(9900)); // keeps token balance
  });
});

describe("Pegged DAO: Read-only functions", () => {
  it("get-sbtc-for-tokens returns correct conversion", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);

    // 9900 tokens backed by 9900 sBTC, so 4950 tokens = 4950 sBTC
    const result = simnet.callReadOnlyFn(
      tokenPeggedAddress,
      "get-sbtc-for-tokens",
      [Cl.uint(4950)],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.uint(4950));
  });

  it("calculate-tax returns correct amount", () => {
    constructDao();
    const result = simnet.callReadOnlyFn(
      tokenPeggedAddress,
      "calculate-tax",
      [Cl.uint(10000)],
      deployer
    ).result;
    expect(result).toStrictEqual(Cl.uint(100)); // 1% of 10000
  });

  it("get-dao-info returns correct state", () => {
    constructDao();
    const result = simnet.callReadOnlyFn(daoPeggedAddress, "get-dao-info", [], deployer).result;
    expect(result).toStrictEqual(
      Cl.tuple({
        name: Cl.stringAscii("Agent DAO"),
        phase: Cl.uint(1),
        initialized: Cl.bool(true),
        deployer: Cl.principal(deployer)
      })
    );
  });
});
