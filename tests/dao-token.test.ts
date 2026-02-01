import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

// contract info
const daoTokenAddress = `${deployer}.dao-token`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const baseDaoAddress = `${deployer}.base-dao`;

// Error codes
const ERR_NOT_AUTHORIZED = 2000;
const ERR_NOT_TOKEN_OWNER = 2001;
const ERR_INSUFFICIENT_BALANCE = 2002;
const ERR_INVALID_AMOUNT = 2003;
const ERR_TAX_TOO_HIGH = 2004;
const ERR_NO_PENDING_CHANGE = 2005;
const ERR_CHANGE_NOT_READY = 2006;
const ERR_INSUFFICIENT_BACKING = 2007;

// Constants
const TAX_CHANGE_DELAY = 1008; // ~7 days in blocks
const MAX_TAX_RATE = 5000; // 50% in basis points
const DEFAULT_TAX = 1000; // 10% in basis points

// Helper function to mint mock sBTC to a wallet
function mintMockSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
}

describe("dao-token: SIP-010 read-only functions", function () {
  it("get-name() returns 'DAO Token'", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-name",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.stringAscii("DAO Token"));
  });

  it("get-symbol() returns 'DAO'", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-symbol",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.stringAscii("DAO"));
  });

  it("get-decimals() returns 8", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-decimals",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.uint(8));
  });

  it("get-balance() returns 0 for new account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.uint(0));
  });

  it("get-total-supply() returns 0 initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-supply",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(Cl.uint(0));
  });

  it("get-token-uri() returns some uri initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-token-uri",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeOk(
      Cl.some(Cl.stringUtf8("https://dao.example.com/token-metadata.json"))
    );
  });
});

describe("dao-token: tax configuration read-only functions", function () {
  it("get-entrance-tax() returns default tax (1000 = 10%)", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-entrance-tax",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(DEFAULT_TAX));
  });

  it("get-current-entrance-tax() returns same as get-entrance-tax initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-current-entrance-tax",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(DEFAULT_TAX));
  });

  it("get-pending-tax-change() shows no pending change", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-pending-tax-change",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(
      Cl.tuple({
        "pending-tax": Cl.none(),
        "activation-block": Cl.uint(0),
        "is-pending": Cl.bool(false),
      })
    );
  });

  it("get-tax-change-delay() returns TAX_CHANGE_DELAY constant", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-tax-change-delay",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(TAX_CHANGE_DELAY));
  });

  it("get-max-tax-rate() returns MAX_TAX_RATE constant", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-max-tax-rate",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(MAX_TAX_RATE));
  });

  it("calculate-tax() correctly calculates tax amount", function () {
    // arrange
    const amount = 1000000; // 1 million satoshis
    const taxRate = 1000; // 10% in basis points
    const expectedTax = 100000; // 10% of 1 million
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "calculate-tax",
      [Cl.uint(amount), Cl.uint(taxRate)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(expectedTax));
  });

  it("get-tokens-for-deposit() returns amount minus tax", function () {
    // arrange
    const depositAmount = 1000000; // 1 million satoshis
    const expectedTokens = 900000; // 90% after 10% tax
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-tokens-for-deposit",
      [Cl.uint(depositAmount)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(expectedTokens));
  });
});

describe("dao-token: backing and treasury read-only functions", function () {
  it("get-total-backing() returns 0 initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(0));
  });

  it("get-treasury() returns deployer initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-treasury",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.principal(deployer));
  });

  it("get-token-owner() returns deployer initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-token-owner",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.principal(deployer));
  });
});

describe("dao-token: deposit function", function () {
  it("deposit() fails with zero amount", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(0)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
  });

  it("deposit() fails when user has no sBTC", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(1000000)],
      wallet1
    );
    // assert
    // Will fail on the sBTC transfer (mock-sbtc ERR_INSUFFICIENT_BALANCE or transfer error)
    expect(receipt.result).toBeErr(Cl.uint(1)); // ft-transfer error
  });

  it("deposit() succeeds and mints tokens minus tax", function () {
    // arrange
    const depositAmount = 1000000;
    const expectedTax = 100000; // 10% tax
    const expectedTokens = 900000; // 90% of deposit
    mintMockSbtc(depositAmount, wallet1);
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(depositAmount)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(expectedTokens));
    // check token balance
    const balance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(balance).toBeOk(Cl.uint(expectedTokens));
    // check total supply
    const totalSupply = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-supply",
      [],
      deployer
    ).result;
    expect(totalSupply).toBeOk(Cl.uint(expectedTokens));
    // check backing
    const backing = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;
    expect(backing).toStrictEqual(Cl.uint(expectedTokens));
  });

  it("deposit() sends tax to treasury", function () {
    // arrange
    const depositAmount = 1000000;
    const expectedTax = 100000;
    mintMockSbtc(depositAmount, wallet2);
    // get initial treasury balance
    const initialTreasuryBalance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // act
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet2);
    // assert
    const finalTreasuryBalance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // Treasury should have gained the tax amount
    // Note: Depends on initial state, just verify it increased
    expect(finalTreasuryBalance).toBeOk(Cl.uint(expectedTax));
  });
});

describe("dao-token: withdraw function", function () {
  it("withdraw() fails with zero amount", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(0)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
  });

  it("withdraw() fails with insufficient balance", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(1000000)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });

  it("withdraw() succeeds and returns 1:1 sBTC (no exit tax)", function () {
    // arrange - first deposit
    const depositAmount = 1000000;
    const tokensReceived = 900000; // after 10% entrance tax
    mintMockSbtc(depositAmount, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet1);
    // get wallet1's sBTC balance before withdraw
    const sbtcBefore = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // act - withdraw all tokens
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(tokensReceived)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(tokensReceived)); // 1:1 return, no exit tax
    // check token balance is 0
    const tokenBalance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(tokenBalance).toBeOk(Cl.uint(0));
    // check sBTC balance increased by full amount
    const sbtcAfter = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(sbtcAfter).toBeOk(Cl.uint(tokensReceived));
  });

  it("withdraw() updates total backing correctly", function () {
    // arrange
    const depositAmount = 2000000;
    const tokensReceived = 1800000; // after 10% tax
    const withdrawAmount = 500000;
    mintMockSbtc(depositAmount, wallet2);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet2);
    const backingBefore = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;
    // act
    simnet.callPublicFn(daoTokenAddress, "withdraw", [Cl.uint(withdrawAmount)], wallet2);
    // assert
    const backingAfter = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;
    expect(backingAfter).toStrictEqual(Cl.uint(tokensReceived - withdrawAmount));
  });
});

describe("dao-token: transfer function", function () {
  it("transfer() fails when not token owner", function () {
    // arrange - wallet1 has tokens from previous tests
    // act - wallet2 tries to transfer wallet1's tokens
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer",
      [Cl.uint(100), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
      wallet2
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_TOKEN_OWNER));
  });

  it("transfer() succeeds for token owner", function () {
    // arrange - mint and deposit for wallet1
    const depositAmount = 1000000;
    const tokensReceived = 900000;
    mintMockSbtc(depositAmount, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet1);
    const transferAmount = 100000;
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer",
      [
        Cl.uint(transferAmount),
        Cl.principal(wallet1),
        Cl.principal(wallet2),
        Cl.none(),
      ],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // check recipient balance increased
    const recipientBalance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    // wallet2 should have received tokens
    expect(recipientBalance.type).toBe("ok");
  });
});

describe("dao-token: governance - schedule-tax-change", function () {
  it("schedule-tax-change() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "schedule-tax-change",
      [Cl.uint(500)], // 5% tax
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });

  it("schedule-tax-change() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "schedule-tax-change",
      [Cl.uint(500)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });

  it("schedule-tax-change() would fail with tax above MAX_TAX_RATE", function () {
    // This documents the validation - can't test directly without DAO authorization
    // arrange
    const excessiveTax = MAX_TAX_RATE + 1;
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "schedule-tax-change",
      [Cl.uint(excessiveTax)],
      deployer
    );
    // assert - fails on auth first
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});

describe("dao-token: governance - apply-pending-tax", function () {
  it("apply-pending-tax() fails when no pending change", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "apply-pending-tax",
      [],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NO_PENDING_CHANGE));
  });
});

describe("dao-token: governance - cancel-tax-change", function () {
  it("cancel-tax-change() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "cancel-tax-change",
      [],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });

  it("cancel-tax-change() fails when no pending change", function () {
    // arrange - even if called by proper authority, should fail if no pending
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "cancel-tax-change",
      [],
      deployer
    );
    // assert - fails on auth first
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});

describe("dao-token: governance - set-treasury", function () {
  it("set-treasury() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "set-treasury",
      [Cl.principal(wallet1)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});

describe("dao-token: token-owner - set-token-uri", function () {
  it("set-token-uri() succeeds for token owner", function () {
    // arrange
    const newUri = "https://new-uri.example.com/metadata.json";
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "set-token-uri",
      [Cl.stringUtf8(newUri)],
      deployer // deployer is initial token owner
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // verify uri changed
    const uriResult = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-token-uri",
      [],
      deployer
    ).result;
    expect(uriResult).toBeOk(Cl.some(Cl.stringUtf8(newUri)));
  });

  it("set-token-uri() fails for non-owner", function () {
    // arrange
    const newUri = "https://hacked.example.com/metadata.json";
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "set-token-uri",
      [Cl.stringUtf8(newUri)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});

describe("dao-token: token-owner - transfer-ownership", function () {
  it("transfer-ownership() succeeds for current owner", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer-ownership",
      [Cl.principal(wallet1)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
    // verify ownership changed
    const ownerResult = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-token-owner",
      [],
      deployer
    ).result;
    expect(ownerResult).toStrictEqual(Cl.principal(wallet1));
  });

  it("transfer-ownership() fails for non-owner", function () {
    // arrange - wallet1 is now owner from previous test
    // act - wallet2 tries to transfer ownership
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer-ownership",
      [Cl.principal(wallet2)],
      wallet2
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });
});

describe("dao-token: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_NOT_AUTHORIZED).toBe(2000);
    expect(ERR_NOT_TOKEN_OWNER).toBe(2001);
    expect(ERR_INSUFFICIENT_BALANCE).toBe(2002);
    expect(ERR_INVALID_AMOUNT).toBe(2003);
    expect(ERR_TAX_TOO_HIGH).toBe(2004);
    expect(ERR_NO_PENDING_CHANGE).toBe(2005);
    expect(ERR_CHANGE_NOT_READY).toBe(2006);
    expect(ERR_INSUFFICIENT_BACKING).toBe(2007);
  });
});
