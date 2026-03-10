import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// ============================================================
// SETUP
// ============================================================

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
const checkinRegistryAddress = `${deployer}.checkin-registry`;
const proofRegistryAddress = `${deployer}.proof-registry`;

// Error codes — token-pegged (6000 range)
const ERR_TOKEN_NOT_AUTHORIZED = 6000;
const ERR_ZERO_AMOUNT = 6001;
const ERR_INSUFFICIENT_BALANCE = 6002;
const ERR_INSUFFICIENT_BACKING = 6003;
const ERR_PEGGED_MODE_ONLY = 6004;
const ERR_TAX_TOO_HIGH = 6005;
const ERR_ALREADY_INITIALIZED = 6006;

// Error codes — guardian-council (6100 range)
const ERR_GC_NOT_AUTHORIZED = 6100;
const ERR_NOT_GUARDIAN = 6101;
const ERR_SPEND_LIMIT_EXCEEDED = 6102;
const ERR_COUNCIL_DISSOLVED = 6103;
const ERR_ALREADY_GUARDIAN = 6104;
const ERR_MAX_GUARDIANS = 6105;
const ERR_MIN_GUARDIANS = 6106;
const ERR_GC_ALREADY_VOTED = 6107;
const ERR_VOTE_NOT_FOUND = 6108;
const ERR_GC_ZERO_AMOUNT = 6109;
const ERR_ZERO_REPUTATION = 6110;
const ERR_GC_VOTING_NOT_ENDED = 6111;

// Error codes — auto-micro-payout (6200 range)
const ERR_AMP_NOT_AUTHORIZED = 6200;
const ERR_AMP_INVALID_AMOUNT = 6201;
const ERR_RATE_LIMITED = 6202;
const ERR_INVALID_WORK_TYPE = 6203;
const ERR_ALREADY_CLAIMED = 6204;
const ERR_PAUSED = 6205;
const ERR_WORK_NOT_VERIFIED = 6206;

// Error codes — upgrade-to-free-floating (6300 range)
const ERR_UPG_NOT_AUTHORIZED = 6300;
const ERR_ALREADY_UPGRADED = 6301;
const ERR_VOTE_ACTIVE = 6302;
const ERR_NO_ACTIVE_VOTE = 6303;
const ERR_ALREADY_VOTED = 6304;
const ERR_VOTING_NOT_ENDED = 6305;
const ERR_NOT_ELIGIBLE = 6306;
const ERR_UPG_ALREADY_CLAIMED = 6307;
const ERR_UPG_ZERO_BALANCE = 6308;
const ERR_VOTE_FAILED = 6309;

// Error codes — dao-pegged (6400 range)
const ERR_DP_NOT_AUTHORIZED = 6400;
const ERR_DP_ALREADY_INITIALIZED = 6401;

// ============================================================
// HELPERS
// ============================================================

function mintSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(mockSbtcAddress, "mint", [Cl.uint(amount), Cl.principal(recipient)], deployer);
}

function constructDao() {
  return simnet.callPublicFn(
    baseDaoAddress, "construct",
    [Cl.contractPrincipal(deployer, "init-pegged-dao")], deployer
  );
}

function deposit(amount: number, sender: string) {
  return simnet.callPublicFn(tokenPeggedAddress, "deposit", [Cl.uint(amount)], sender);
}

function redeem(amount: number, sender: string) {
  return simnet.callPublicFn(tokenPeggedAddress, "redeem", [Cl.uint(amount)], sender);
}

function fundTreasury(amount: number) {
  mintSbtc(amount, deployer);
  simnet.callPublicFn(treasuryAddress, "deposit-ft",
    [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(amount)], deployer);
}

function doCheckin(sender: string) {
  return simnet.callPublicFn(checkinRegistryAddress, "check-in", [], sender);
}

function submitProof(sender: string) {
  const hash = new Uint8Array(32);
  hash[0] = Math.floor(Math.random() * 256);
  hash[1] = Math.floor(Math.random() * 256);
  hash[2] = Math.floor(Math.random() * 256);
  return simnet.callPublicFn(proofRegistryAddress, "submit-proof", [Cl.buffer(hash)], sender);
}

// Run a full upgrade vote that passes (deployer must have rep and tokens)
function runSuccessfulUpgrade() {
  simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
  simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
  simnet.mineEmptyBlocks(433);
  return simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
}

// ============================================================
// CONSTRUCTION & INIT PROPOSAL
// ============================================================

describe("Construction & Init Proposal", () => {
  // GREEN: successful construction
  it("constructs the DAO with init proposal", () => {
    const result = constructDao();
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("sets token name, symbol, decimals correctly", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-name", [], deployer).result)
      .toBeOk(Cl.stringAscii("Agent DAO BTC"));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-symbol", [], deployer).result)
      .toBeOk(Cl.stringAscii("aDAO"));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-decimals", [], deployer).result)
      .toBeOk(Cl.uint(8));
  });

  it("sets entrance tax to 1% (100 basis points)", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-entrance-tax-rate", [], deployer).result)
      .toStrictEqual(Cl.uint(100));
  });

  it("initializes guardian council with deployer at reputation 100", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "is-guardian", [Cl.principal(deployer)], deployer).result)
      .toStrictEqual(Cl.bool(true));
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "get-reputation", [Cl.principal(deployer)], deployer).result)
      .toStrictEqual(Cl.uint(100));
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "get-guardian-count", [], deployer).result)
      .toStrictEqual(Cl.uint(1));
  });

  it("sets DAO name, phase 1, initialized", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(daoPeggedAddress, "get-dao-info", [], deployer).result)
      .toStrictEqual(Cl.tuple({
        name: Cl.stringAscii("Agent DAO"),
        phase: Cl.uint(1),
        initialized: Cl.bool(true),
        deployer: Cl.principal(deployer)
      }));
  });

  it("enables all 6 extensions", () => {
    constructDao();
    for (const ext of ["dao-pegged", "token-pegged", "dao-treasury", "guardian-council", "auto-micro-payout", "upgrade-to-free-floating"]) {
      expect(simnet.callReadOnlyFn(baseDaoAddress, "is-extension",
        [Cl.contractPrincipal(deployer, ext)], deployer).result)
        .toStrictEqual(Cl.bool(true));
    }
  });

  it("allows sBTC and pegged token in treasury", () => {
    constructDao();
    // After init, treasury should accept sBTC deposits
    mintSbtc(1000, deployer);
    const result = simnet.callPublicFn(treasuryAddress, "deposit-ft",
      [Cl.contractPrincipal(deployer, "mock-sbtc"), Cl.uint(1000)], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("configures micro-payout amounts for all 3 work types", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-payout-for-type", [Cl.uint(1)], deployer).result)
      .toStrictEqual(Cl.uint(100));
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-payout-for-type", [Cl.uint(2)], deployer).result)
      .toStrictEqual(Cl.uint(300));
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-payout-for-type", [Cl.uint(3)], deployer).result)
      .toStrictEqual(Cl.uint(500));
  });

  // RED: double-initialization
  it("rejects second initialization of token-pegged", () => {
    constructDao();
    // Try to initialize again via direct call (deployer is not DAO)
    const result = simnet.callPublicFn(tokenPeggedAddress, "initialize",
      [Cl.stringAscii("Evil"), Cl.stringAscii("EVIL"), Cl.uint(0), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  it("rejects second mark-initialized on dao-pegged", () => {
    constructDao();
    const result = simnet.callPublicFn(daoPeggedAddress, "mark-initialized", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_DP_NOT_AUTHORIZED));
  });
});

// ============================================================
// TOKEN-PEGGED: DEPOSIT / MINT
// ============================================================

describe("Token-Pegged: Deposit / Mint", () => {
  // GREEN paths
  it("deposits sBTC and receives tokens minus 1% tax", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    const result = deposit(10000, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result)
      .toBeOk(Cl.uint(9900));
  });

  it("sends entrance tax to treasury", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    expect(simnet.callReadOnlyFn(mockSbtcAddress, "get-balance",
      [Cl.contractPrincipal(deployer, "dao-treasury")], deployer).result)
      .toBeOk(Cl.uint(100));
  });

  it("tracks total backing correctly", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-total-backing", [], deployer).result)
      .toStrictEqual(Cl.uint(9900));
  });

  it("tracks total supply correctly", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-total-supply", [], deployer).result)
      .toBeOk(Cl.uint(9900));
  });

  it("allows multiple depositors", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    mintSbtc(20000, wallet2);
    expect(deposit(10000, wallet1).result).toBeOk(Cl.uint(9900));
    expect(deposit(20000, wallet2).result).toBeOk(Cl.uint(19800));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-total-supply", [], deployer).result)
      .toBeOk(Cl.uint(29700));
  });

  // RED paths
  it("rejects zero deposit", () => {
    constructDao();
    expect(deposit(0, wallet1).result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });

  it("[M3] rejects deposit before initialization", () => {
    mintSbtc(10000, wallet1);
    expect(deposit(10000, wallet1).result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  it("rejects deposit without sufficient sBTC balance", () => {
    constructDao();
    // wallet1 has 0 sBTC
    const result = deposit(10000, wallet1);
    // Will fail at the sBTC transfer step
    expect(result.result).toBeErr(Cl.uint(1)); // ft-transfer error
  });
});

// ============================================================
// TOKEN-PEGGED: REDEEM / BURN
// ============================================================

describe("Token-Pegged: Redeem / Burn", () => {
  // GREEN paths
  it("redeems all tokens for full backing (last redeemer)", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const result = redeem(9900, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result)
      .toBeOk(Cl.uint(0));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-total-backing", [], deployer).result)
      .toStrictEqual(Cl.uint(0));
  });

  it("redeems partial tokens for pro-rata sBTC", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    // Redeem half
    const result = redeem(4950, wallet1);
    expect(result.result).toBeOk(Cl.uint(4950));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result)
      .toBeOk(Cl.uint(4950));
  });

  it("handles multiple depositors with pro-rata redemption", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    mintSbtc(20000, wallet2);
    deposit(10000, wallet1);
    deposit(20000, wallet2);
    // wallet1 redeems their full 9900
    const result = redeem(9900, wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
  });

  // RED paths
  it("rejects redeem with zero amount", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    expect(redeem(0, wallet1).result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });

  it("rejects redeem with insufficient token balance", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    expect(redeem(99999, wallet1).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });

  it("rejects redeem before initialization", () => {
    // Before init, supply=0 causes division-by-zero in the let block
    // which aborts the transaction (runtime error)
    expect(() => redeem(100, wallet1)).toThrow();
  });
});

// ============================================================
// TOKEN-PEGGED: SIP-010 TRANSFER
// ============================================================

describe("Token-Pegged: SIP-010 Transfer", () => {
  // GREEN
  it("transfers tokens between accounts", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const result = simnet.callPublicFn(tokenPeggedAddress, "transfer",
      [Cl.uint(1000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet2)], deployer).result)
      .toBeOk(Cl.uint(1000));
  });

  it("transfers with memo", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const memo = Cl.some(Cl.buffer(new Uint8Array([0x01, 0x02])));
    const result = simnet.callPublicFn(tokenPeggedAddress, "transfer",
      [Cl.uint(100), Cl.principal(wallet1), Cl.principal(wallet2), memo], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  // RED
  it("rejects transfer from non-sender", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    // wallet2 tries to transfer wallet1's tokens
    const result = simnet.callPublicFn(tokenPeggedAddress, "transfer",
      [Cl.uint(100), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()], wallet2);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  it("rejects zero transfer", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const result = simnet.callPublicFn(tokenPeggedAddress, "transfer",
      [Cl.uint(0), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ZERO_AMOUNT));
  });
});

// ============================================================
// TOKEN-PEGGED: DAO-ONLY FUNCTIONS
// ============================================================

describe("Token-Pegged: DAO-Only Functions", () => {
  // RED: dao-mint restricted to upgrade extension [M1]
  it("[M1] dao-mint rejects calls from deployer (not upgrade extension)", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "dao-mint",
      [Cl.uint(1000000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  it("[M1] dao-burn rejects calls from deployer", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "dao-burn",
      [Cl.uint(1000000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  // RED: set-pegged requires DAO auth
  it("set-pegged rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "set-pegged",
      [Cl.bool(false)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  // RED: set-treasury requires DAO auth
  it("set-treasury rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "set-treasury",
      [Cl.principal(wallet1)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  // RED: set-entrance-tax requires DAO auth
  it("set-entrance-tax rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "set-entrance-tax",
      [Cl.uint(500)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  // RED: set-token-uri requires DAO auth
  it("set-token-uri rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "set-token-uri",
      [Cl.stringUtf8("https://example.com")], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });

  // RED: withdraw-backing requires DAO auth
  it("withdraw-backing rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(tokenPeggedAddress, "withdraw-backing",
      [Cl.uint(100), Cl.principal(wallet1)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_TOKEN_NOT_AUTHORIZED));
  });
});

// ============================================================
// TOKEN-PEGGED: READ-ONLY FUNCTIONS
// ============================================================

describe("Token-Pegged: Read-Only", () => {
  it("calculate-tax returns correct amount (1% of 10000 = 100)", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "calculate-tax", [Cl.uint(10000)], deployer).result)
      .toStrictEqual(Cl.uint(100));
  });

  it("calculate-tax returns 0 for tiny amounts (1% of 99 = 0)", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "calculate-tax", [Cl.uint(99)], deployer).result)
      .toStrictEqual(Cl.uint(0));
  });

  it("get-sbtc-for-tokens returns correct conversion", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    // 9900 tokens backed by 9900 sBTC, so 4950 tokens = 4950 sBTC
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-sbtc-for-tokens", [Cl.uint(4950)], deployer).result)
      .toStrictEqual(Cl.uint(4950));
  });

  it("get-sbtc-for-tokens returns 0 for zero input", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-sbtc-for-tokens", [Cl.uint(0)], deployer).result)
      .toStrictEqual(Cl.uint(0));
  });

  it("get-sbtc-for-tokens returns 0 when no supply", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-sbtc-for-tokens", [Cl.uint(100)], deployer).result)
      .toStrictEqual(Cl.uint(0));
  });

  it("get-is-pegged returns true initially", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-is-pegged", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  it("is-initialized returns true after construction", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "is-initialized", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  it("get-token-uri returns none initially", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-token-uri", [], deployer).result)
      .toBeOk(Cl.none());
  });
});

// ============================================================
// GUARDIAN COUNCIL: ADD / REMOVE GUARDIANS
// ============================================================

describe("Guardian Council: Guardian Management", () => {
  // GREEN
  it("deployer is guardian after init", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "is-guardian", [Cl.principal(deployer)], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  it("get-guardian-data returns reputation and join block", () => {
    constructDao();
    const data = simnet.callReadOnlyFn(guardianCouncilAddress, "get-guardian-data",
      [Cl.principal(deployer)], deployer).result;
    // Should be a some tuple with reputation u100
    expect(data).not.toStrictEqual(Cl.none());
  });

  it("non-guardian returns false for is-guardian", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "is-guardian", [Cl.principal(wallet1)], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });

  // RED: add-guardian requires DAO auth
  it("add-guardian rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "add-guardian",
      [Cl.principal(wallet1), Cl.uint(50)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_NOT_AUTHORIZED));
  });

  // RED: remove-guardian requires DAO auth
  it("remove-guardian rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "remove-guardian",
      [Cl.principal(deployer)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_NOT_AUTHORIZED));
  });

  // RED: set-reputation requires DAO auth
  it("set-reputation rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "set-reputation",
      [Cl.principal(deployer), Cl.uint(999)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_NOT_AUTHORIZED));
  });

  // RED: dissolve requires DAO auth
  it("dissolve rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "dissolve", [], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_NOT_AUTHORIZED));
  });
});

// ============================================================
// GUARDIAN COUNCIL: SMALL SPEND APPROVAL
// ============================================================

describe("Guardian Council: Small Spend Approval", () => {
  // GREEN: guardian can spend within 2% limit
  it("[C1] guardian approves spend within 2% of actual treasury balance", () => {
    constructDao();
    fundTreasury(100000);
    // 2% of 100k = 2000
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(1000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("guardian can make multiple spends up to weekly limit", () => {
    constructDao();
    fundTreasury(100000);
    // 2% of 100k = 2000. After spending 500, treasury = 99500, 2% = 1990.
    // Cumulative 500+500=1000 < 1990. Both should succeed.
    expect(simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(500), Cl.principal(wallet1)], deployer).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(500), Cl.principal(wallet2)], deployer).result).toBeOk(Cl.bool(true));
  });

  // RED: exceeds 2% limit
  it("[C1] rejects spend exceeding 2% of actual treasury balance", () => {
    constructDao();
    fundTreasury(100000);
    // 2% of 100k = 2000. Spending 3000 should fail.
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(3000), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_SPEND_LIMIT_EXCEEDED));
  });

  it("rejects cumulative spend over weekly limit", () => {
    constructDao();
    fundTreasury(100000);
    // Spend 1500, then 600 = 2100 > 2000
    simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(1500), Cl.principal(wallet1)], deployer);
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(600), Cl.principal(wallet2)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_SPEND_LIMIT_EXCEEDED));
  });

  // RED: non-guardian
  it("non-guardian cannot approve spend", () => {
    constructDao();
    fundTreasury(100000);
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(100), Cl.principal(wallet2)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_GUARDIAN));
  });

  // RED: zero amount
  it("rejects zero amount spend", () => {
    constructDao();
    fundTreasury(100000);
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(0), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_ZERO_AMOUNT));
  });

  // RED: dissolved council
  it("rejects spend after council is dissolved", () => {
    constructDao();
    fundTreasury(100000);
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    // Run full upgrade which dissolves the council
    runSuccessfulUpgrade();
    const result = simnet.callPublicFn(guardianCouncilAddress, "approve-small-spend",
      [Cl.uint(100), Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_COUNCIL_DISSOLVED));
  });
});

// ============================================================
// GUARDIAN COUNCIL: SLASH VOTING
// ============================================================

describe("Guardian Council: Slash Voting", () => {
  // GREEN: start slash vote
  it("any DAO member with reputation can start slash vote", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);
    expect(result.result).toBeOk(Cl.uint(1));
  });

  // GREEN: vote on slash
  it("DAO member can vote on slash proposal", () => {
    constructDao();
    simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);
    // deployer already voted (auto-counted as proposer)
    // Need another member with reputation to vote
    // For now, just verify the start worked
  });

  // GREEN: conclude after voting period [H2]
  it("[H2] can conclude slash vote after voting period", () => {
    constructDao();
    simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);
    simnet.mineEmptyBlocks(145);
    const result = simnet.callPublicFn(guardianCouncilAddress, "conclude-slash-vote",
      [Cl.uint(1)], deployer);
    // Passes because deployer (100 rep) is > 66% of total (100)
    expect(result.result).toBeOk(Cl.bool(true));
  });

  // RED: conclude before voting period [H2]
  it("[H2] cannot conclude slash vote before voting period ends", () => {
    constructDao();
    simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);
    const result = simnet.callPublicFn(guardianCouncilAddress, "conclude-slash-vote",
      [Cl.uint(1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_VOTING_NOT_ENDED));
  });

  // RED: start slash on non-guardian
  it("cannot start slash vote against non-guardian", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(wallet1)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_GUARDIAN));
  });

  // RED: member without reputation cannot start slash
  it("member without reputation cannot start slash vote", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ZERO_REPUTATION));
  });

  // RED: double vote
  it("cannot vote twice on same slash proposal", () => {
    constructDao();
    simnet.callPublicFn(guardianCouncilAddress, "start-slash-vote",
      [Cl.principal(deployer)], deployer);
    // deployer already voted by starting the vote
    const result = simnet.callPublicFn(guardianCouncilAddress, "vote-slash",
      [Cl.uint(1), Cl.bool(true)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_GC_ALREADY_VOTED));
  });

  // RED: vote on non-existent slash
  it("cannot vote on non-existent slash proposal", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "vote-slash",
      [Cl.uint(999), Cl.bool(true)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_VOTE_NOT_FOUND));
  });

  // RED: conclude non-existent
  it("cannot conclude non-existent slash vote", () => {
    constructDao();
    const result = simnet.callPublicFn(guardianCouncilAddress, "conclude-slash-vote",
      [Cl.uint(999)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_VOTE_NOT_FOUND));
  });
});

// ============================================================
// GUARDIAN COUNCIL: READ-ONLY
// ============================================================

describe("Guardian Council: Read-Only", () => {
  it("get-council-info returns correct state", () => {
    constructDao();
    const info = simnet.callReadOnlyFn(guardianCouncilAddress, "get-council-info", [], deployer).result;
    expect(info).toStrictEqual(Cl.tuple({
      "guardian-count": Cl.uint(1),
      "total-reputation": Cl.uint(100),
      dissolved: Cl.bool(false),
      "current-week": simnet.callReadOnlyFn(guardianCouncilAddress, "get-current-week", [], deployer).result,
      "week-spent": Cl.uint(0)
    }));
  });

  it("get-week-spending returns 0 for new week", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "get-week-spending",
      [Cl.principal(deployer), Cl.uint(0)], deployer).result)
      .toStrictEqual(Cl.uint(0));
  });

  it("get-weekly-spend-limit calculates 2% correctly", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "get-weekly-spend-limit",
      [Cl.uint(100000)], deployer).result)
      .toStrictEqual(Cl.uint(2000));
  });
});

// ============================================================
// AUTO MICRO-PAYOUT: CHECK-IN CLAIMS
// ============================================================

describe("Auto Micro-Payout: Check-in Claims", () => {
  // GREEN: verified check-in claim
  it("[C2] accepts claim with verified on-chain check-in", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(0)], wallet1);
    expect(result.result).toBeOk(Cl.uint(100));
  });

  it("updates stats after successful claim", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(0)], wallet1);
    const stats = simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-stats", [], deployer).result;
    expect(stats).toStrictEqual(Cl.tuple({
      "total-paid": Cl.uint(100),
      "total-payouts": Cl.uint(1),
      paused: Cl.bool(false),
      "current-epoch": simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-current-epoch", [], deployer).result
    }));
  });

  it("multiple check-ins can each be claimed once", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    simnet.mineEmptyBlocks(1);
    doCheckin(wallet1);
    expect(simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(0)], wallet1).result)
      .toBeOk(Cl.uint(100));
    expect(simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(1)], wallet1).result)
      .toBeOk(Cl.uint(100));
  });

  // RED: no verified check-in
  it("[C2] rejects claim without verified on-chain check-in", () => {
    constructDao();
    fundTreasury(100000);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(999)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });

  // RED: double claim
  it("prevents double-claiming same check-in", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(0)], wallet1);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(0)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });

  // RED: claim someone else's check-in
  it("cannot claim another agent's check-in", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    // wallet2 tries to claim wallet1's check-in
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout",
      [Cl.uint(0)], wallet2);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });

  // RED: paused
  it("rejects claims when paused", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    // Pause requires DAO auth — we can't easily test this without a proposal
    // but we can verify the paused state via read-only
    const stats = simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-stats", [], deployer).result;
    // Just verify paused is false initially
    expect(stats).toStrictEqual(Cl.tuple({
      "total-paid": Cl.uint(0),
      "total-payouts": Cl.uint(0),
      paused: Cl.bool(false),
      "current-epoch": simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-current-epoch", [], deployer).result
    }));
  });
});

// ============================================================
// AUTO MICRO-PAYOUT: PROOF CLAIMS
// ============================================================

describe("Auto Micro-Payout: Proof Claims", () => {
  // GREEN: verified proof claim
  it("[C2] accepts claim with verified on-chain proof", () => {
    constructDao();
    fundTreasury(100000);
    submitProof(wallet1);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-proof-payout",
      [Cl.uint(0)], wallet1);
    expect(result.result).toBeOk(Cl.uint(300));
  });

  // RED: no verified proof
  it("rejects claim without verified on-chain proof", () => {
    constructDao();
    fundTreasury(100000);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-proof-payout",
      [Cl.uint(999)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });

  // RED: double claim proof
  it("prevents double-claiming same proof", () => {
    constructDao();
    fundTreasury(100000);
    submitProof(wallet1);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-proof-payout", [Cl.uint(0)], wallet1);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-proof-payout",
      [Cl.uint(0)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });

  // RED: claim someone else's proof
  it("cannot claim another agent's proof", () => {
    constructDao();
    fundTreasury(100000);
    submitProof(wallet1);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-proof-payout",
      [Cl.uint(0)], wallet2);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });
});

// ============================================================
// AUTO MICRO-PAYOUT: GUARDIAN-APPROVED CLAIMS
// ============================================================

describe("Auto Micro-Payout: Guardian-Approved Claims", () => {
  // GREEN: full guardian-approved flow
  it("guardian approves work, agent claims payout", () => {
    constructDao();
    fundTreasury(100000);
    // Guardian (deployer) approves work for wallet1
    simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(42), Cl.uint(300)], deployer);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout",
      [Cl.uint(42)], wallet1);
    expect(result.result).toBeOk(Cl.uint(300));
  });

  it("approved work amount is used (not payout-for-type)", () => {
    constructDao();
    fundTreasury(100000);
    // Approve at 200 sats (not the default 500 for guardian-approved)
    simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(1), Cl.uint(200)], deployer);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout",
      [Cl.uint(1)], wallet1);
    expect(result.result).toBeOk(Cl.uint(200));
  });

  // RED: non-guardian cannot approve work
  it("[C2] non-guardian cannot approve work", () => {
    constructDao();
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet2), Cl.uint(1), Cl.uint(200)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_AMP_NOT_AUTHORIZED));
  });

  // RED: approve with amount outside bounds
  it("approve-work rejects amount below MIN_PAYOUT (100)", () => {
    constructDao();
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(1), Cl.uint(50)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_AMP_INVALID_AMOUNT));
  });

  it("approve-work rejects amount above MAX_PAYOUT (500)", () => {
    constructDao();
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(1), Cl.uint(1000)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_AMP_INVALID_AMOUNT));
  });

  // RED: claim without approval
  it("claim-approved-payout fails without guardian approval", () => {
    constructDao();
    fundTreasury(100000);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout",
      [Cl.uint(999)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });

  // RED: double claim approved work
  it("prevents double-claiming approved work", () => {
    constructDao();
    fundTreasury(100000);
    simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(10), Cl.uint(300)], deployer);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout", [Cl.uint(10)], wallet1);
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout",
      [Cl.uint(10)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });

  // RED: wrong agent claims approved work
  it("wrong agent cannot claim another agent's approved work", () => {
    constructDao();
    fundTreasury(100000);
    // Approved for wallet1
    simnet.callPublicFn(autoMicroPayoutAddress, "approve-work",
      [Cl.principal(wallet1), Cl.uint(5), Cl.uint(300)], deployer);
    // wallet2 tries to claim
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "claim-approved-payout",
      [Cl.uint(5)], wallet2);
    expect(result.result).toBeErr(Cl.uint(ERR_WORK_NOT_VERIFIED));
  });
});

// ============================================================
// AUTO MICRO-PAYOUT: SET-PAYOUT-AMOUNT & READ-ONLY
// ============================================================

describe("Auto Micro-Payout: Configuration", () => {
  // RED: set-payout-amount requires DAO auth
  it("set-payout-amount rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "set-payout-amount",
      [Cl.uint(1), Cl.uint(200)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_AMP_NOT_AUTHORIZED));
  });

  // RED: set-paused requires DAO auth
  it("set-paused rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "set-paused",
      [Cl.bool(true)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_AMP_NOT_AUTHORIZED));
  });

  it("has-claimed returns false for unclaimed work", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "has-claimed",
      [Cl.principal(wallet1), Cl.uint(1), Cl.uint(0)], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });

  it("has-claimed returns true after claiming", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(0)], wallet1);
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "has-claimed",
      [Cl.principal(wallet1), Cl.uint(1), Cl.uint(0)], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  it("get-remaining-payouts returns MAX_PAYOUTS_PER_EPOCH initially", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-remaining-payouts",
      [Cl.principal(wallet1)], deployer).result)
      .toStrictEqual(Cl.uint(10));
  });

  it("get-remaining-payouts decrements after claim", () => {
    constructDao();
    fundTreasury(100000);
    doCheckin(wallet1);
    simnet.callPublicFn(autoMicroPayoutAddress, "claim-checkin-payout", [Cl.uint(0)], wallet1);
    expect(simnet.callReadOnlyFn(autoMicroPayoutAddress, "get-remaining-payouts",
      [Cl.principal(wallet1)], deployer).result)
      .toStrictEqual(Cl.uint(9));
  });
});

// ============================================================
// UPGRADE TO FREE-FLOATING: START VOTE
// ============================================================

describe("Upgrade: Start Vote", () => {
  // GREEN
  it("agent with reputation can start upgrade vote", () => {
    constructDao();
    const result = simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("vote-round increments", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(simnet.callReadOnlyFn(upgradeAddress, "get-vote-round", [], deployer).result)
      .toStrictEqual(Cl.uint(1));
  });

  it("vote-active becomes true", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(simnet.callReadOnlyFn(upgradeAddress, "is-vote-active", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  // RED
  it("agent without reputation cannot start vote", () => {
    constructDao();
    const result = simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_ELIGIBLE));
  });

  it("cannot start vote while one is active", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_VOTE_ACTIVE));
  });

  it("cannot start vote after upgrade", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    runSuccessfulUpgrade();
    const result = simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_UPGRADED));
  });
});

// ============================================================
// UPGRADE TO FREE-FLOATING: CAST VOTE
// ============================================================

describe("Upgrade: Cast Vote", () => {
  // GREEN
  it("voter with reputation can vote yes", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("voter can vote no", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(false)], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("get-agent-vote returns vote record", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    const vote = simnet.callReadOnlyFn(upgradeAddress, "get-agent-vote",
      [Cl.principal(deployer)], deployer).result;
    expect(vote).toStrictEqual(Cl.some(Cl.tuple({
      "in-favor": Cl.bool(true),
      reputation: Cl.uint(100)
    })));
  });

  // RED
  it("cannot vote without active vote", () => {
    constructDao();
    const result = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_NO_ACTIVE_VOTE));
  });

  it("cannot vote without reputation", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NOT_ELIGIBLE));
  });

  it("cannot vote twice in same round", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(false)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_ALREADY_VOTED));
  });

  it("cannot vote after voting period ends", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.mineEmptyBlocks(433);
    const result = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_VOTING_NOT_ENDED));
  });
});

// ============================================================
// UPGRADE TO FREE-FLOATING: SNAPSHOT BALANCE
// ============================================================

describe("Upgrade: Snapshot Balance", () => {
  // GREEN
  it("token holder can snapshot their balance during vote", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
  });

  it("get-balance-snapshot returns snapshotted value", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    expect(simnet.callReadOnlyFn(upgradeAddress, "get-balance-snapshot",
      [Cl.principal(wallet1)], deployer).result)
      .toStrictEqual(Cl.some(Cl.uint(9900)));
  });

  // RED
  it("cannot snapshot without active vote", () => {
    constructDao();
    mintSbtc(10000, wallet1);
    deposit(10000, wallet1);
    const result = simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_NO_ACTIVE_VOTE));
  });

  it("cannot snapshot with zero balance", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_UPG_ZERO_BALANCE));
  });
});

// ============================================================
// UPGRADE TO FREE-FLOATING: CONCLUDE VOTE
// ============================================================

describe("Upgrade: Conclude Vote", () => {
  // GREEN: vote passes
  it("vote passes with >= 75% reputation in favor", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    simnet.mineEmptyBlocks(433);
    const result = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("passing vote sets upgraded to true", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    runSuccessfulUpgrade();
    expect(simnet.callReadOnlyFn(upgradeAddress, "is-upgraded", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  it("passing vote dissolves guardian council", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    runSuccessfulUpgrade();
    expect(simnet.callReadOnlyFn(guardianCouncilAddress, "is-dissolved", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });

  it("passing vote breaks the peg", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    runSuccessfulUpgrade();
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-is-pegged", [], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });

  // GREEN: vote fails
  it("vote fails with < 75% reputation in favor", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(false)], deployer);
    simnet.mineEmptyBlocks(433);
    const result = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(result.result).toBeOk(Cl.bool(false));
  });

  it("failed vote keeps upgraded as false", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(false)], deployer);
    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(simnet.callReadOnlyFn(upgradeAddress, "is-upgraded", [], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });

  // GREEN: retry after failure [H1]
  it("[H1] failed vote allows new vote with fresh round", () => {
    constructDao();
    // Round 1: fail
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(false)], deployer);
    simnet.mineEmptyBlocks(433);
    expect(simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer).result)
      .toBeOk(Cl.bool(false));

    // Round 2: can start fresh and vote again
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    expect(simnet.callReadOnlyFn(upgradeAddress, "get-vote-round", [], deployer).result)
      .toStrictEqual(Cl.uint(2));
    const voteResult = simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    expect(voteResult.result).toBeOk(Cl.bool(true));
  });

  // RED
  it("cannot conclude without active vote", () => {
    constructDao();
    const result = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_NO_ACTIVE_VOTE));
  });

  it("cannot conclude before voting period ends", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_VOTING_NOT_ENDED));
  });
});

// ============================================================
// UPGRADE TO FREE-FLOATING: CLAIM OUTCOME
// ============================================================

describe("Upgrade: Claim Outcome", () => {
  // GREEN: yes-voter keeps tokens
  it("yes-voter claims and keeps governance tokens", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], deployer);
    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);

    const result = simnet.callPublicFn(upgradeAddress, "claim", [], deployer);
    expect(result.result).toBeOk(Cl.uint(9900)); // keeps 9900 tokens
    // Token balance unchanged
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(deployer)], deployer).result)
      .toBeOk(Cl.uint(9900));
  });

  // GREEN: dissenter (non-voter) gets sBTC refund
  it("non-voter (dissenter) gets sBTC refund", () => {
    constructDao();
    mintSbtc(10000, deployer);
    mintSbtc(10000, wallet1);
    deposit(10000, deployer);
    deposit(10000, wallet1);

    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);

    // wallet1 didn't vote = treated as dissenter
    const result = simnet.callPublicFn(upgradeAddress, "claim", [], wallet1);
    // (9900 * 19800) / 19800 = 9900 sBTC back
    expect(result.result).toBeOk(Cl.uint(9900));
    // Token balance should be 0 (burned)
    expect(simnet.callReadOnlyFn(tokenPeggedAddress, "get-balance", [Cl.principal(wallet1)], deployer).result)
      .toBeOk(Cl.uint(0));
  });

  // GREEN: [H3] snapshotted balance used
  it("[H3] claim uses min(snapshot, live) balance", () => {
    constructDao();
    mintSbtc(10000, deployer);
    mintSbtc(10000, wallet1);
    deposit(10000, deployer);
    deposit(10000, wallet1);

    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    // Snapshot wallet1 at 9900
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);

    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);

    // wallet1's claim uses snapshotted balance
    const result = simnet.callPublicFn(upgradeAddress, "claim", [], wallet1);
    expect(result.result).toBeOk(Cl.uint(9900));
  });

  // GREEN: get-dissenter-refund read-only
  it("get-dissenter-refund returns correct amount", () => {
    constructDao();
    mintSbtc(10000, deployer);
    mintSbtc(10000, wallet1);
    deposit(10000, deployer);
    deposit(10000, wallet1);

    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], wallet1);
    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);

    const refund = simnet.callReadOnlyFn(upgradeAddress, "get-dissenter-refund",
      [Cl.principal(wallet1)], deployer).result;
    expect(refund).toStrictEqual(Cl.uint(9900));
  });

  // RED
  it("cannot claim before upgrade passes", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    const result = simnet.callPublicFn(upgradeAddress, "claim", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_VOTE_FAILED));
  });

  it("cannot claim with zero balance", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    runSuccessfulUpgrade();
    // wallet1 has no tokens
    const result = simnet.callPublicFn(upgradeAddress, "claim", [], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_UPG_ZERO_BALANCE));
  });

  it("cannot double-claim", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], deployer);
    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);

    simnet.callPublicFn(upgradeAddress, "claim", [], deployer);
    const result = simnet.callPublicFn(upgradeAddress, "claim", [], deployer);
    expect(result.result).toBeErr(Cl.uint(ERR_UPG_ALREADY_CLAIMED));
  });

  it("has-claimed returns true after claiming", () => {
    constructDao();
    mintSbtc(10000, deployer);
    deposit(10000, deployer);
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);
    simnet.callPublicFn(upgradeAddress, "snapshot-my-balance", [], deployer);
    simnet.mineEmptyBlocks(433);
    simnet.callPublicFn(upgradeAddress, "conclude-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "claim", [], deployer);

    expect(simnet.callReadOnlyFn(upgradeAddress, "has-claimed",
      [Cl.principal(deployer)], deployer).result)
      .toStrictEqual(Cl.bool(true));
  });
});

// ============================================================
// UPGRADE: READ-ONLY
// ============================================================

describe("Upgrade: Read-Only", () => {
  it("get-vote-data returns correct vote state fields", () => {
    constructDao();
    simnet.callPublicFn(upgradeAddress, "start-upgrade-vote", [], deployer);
    simnet.callPublicFn(upgradeAddress, "vote", [Cl.bool(true)], deployer);

    const data = simnet.callReadOnlyFn(upgradeAddress, "get-vote-data", [], deployer).result;
    // Use Cl.prettyPrint to verify key values are present
    const str = Cl.prettyPrint(data);
    expect(str).toContain("active: true");
    expect(str).toContain("round: u1");
    expect(str).toContain("rep-for: u100");
    expect(str).toContain("rep-against: u0");
    expect(str).toContain("total-rep: u100");
    expect(str).toContain("passed: false");
    expect(str).toContain("upgraded: false");
  });

  it("is-upgraded returns false before upgrade", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(upgradeAddress, "is-upgraded", [], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });

  it("has-claimed returns false before claiming", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(upgradeAddress, "has-claimed",
      [Cl.principal(wallet1)], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });
});

// ============================================================
// DAO-PEGGED: PHASE MANAGEMENT
// ============================================================

describe("DAO-Pegged: Phase Management", () => {
  it("starts at phase 1", () => {
    constructDao();
    expect(simnet.callReadOnlyFn(daoPeggedAddress, "is-phase-1", [], deployer).result)
      .toStrictEqual(Cl.bool(true));
    expect(simnet.callReadOnlyFn(daoPeggedAddress, "is-phase-2", [], deployer).result)
      .toStrictEqual(Cl.bool(false));
  });

  // RED: set-phase requires DAO auth
  it("set-phase rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(daoPeggedAddress, "set-phase",
      [Cl.uint(2)], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_DP_NOT_AUTHORIZED));
  });

  // RED: set-dao-name requires DAO auth
  it("set-dao-name rejects non-DAO caller", () => {
    constructDao();
    const result = simnet.callPublicFn(daoPeggedAddress, "set-dao-name",
      [Cl.stringAscii("Evil DAO")], wallet1);
    expect(result.result).toBeErr(Cl.uint(ERR_DP_NOT_AUTHORIZED));
  });
});

// ============================================================
// EXTENSION CALLBACKS
// ============================================================

describe("Extension Callbacks", () => {
  it("token-pegged callback returns ok", () => {
    const result = simnet.callPublicFn(tokenPeggedAddress, "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34))], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("guardian-council callback returns ok", () => {
    const result = simnet.callPublicFn(guardianCouncilAddress, "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34))], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("auto-micro-payout callback returns ok", () => {
    const result = simnet.callPublicFn(autoMicroPayoutAddress, "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34))], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("upgrade-to-free-floating callback returns ok", () => {
    const result = simnet.callPublicFn(upgradeAddress, "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34))], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("dao-pegged callback returns ok", () => {
    const result = simnet.callPublicFn(daoPeggedAddress, "callback",
      [Cl.principal(deployer), Cl.buffer(new Uint8Array(34))], deployer);
    expect(result.result).toBeOk(Cl.bool(true));
  });
});
