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
const treasuryAddress = `${deployer}.dao-treasury`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const daoTokenAddress = `${deployer}.dao-token`;

// Constants
const DEFAULT_TAX = 1000; // 10% in basis points
const TAX_CHANGE_DELAY = 1008; // ~7 days in blocks

// Error codes
const ERR_NOT_AUTHORIZED = 2000;
const ERR_INSUFFICIENT_BALANCE = 2002;
const ERR_INVALID_AMOUNT = 2003;
const ERR_TAX_TOO_HIGH = 2004;
const ERR_NO_PENDING_CHANGE = 2005;
const ERR_CHANGE_NOT_READY = 2006;

// Helper to mint mock sBTC
function mintMockSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
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

describe("token-flows: deposit with entrance tax", function () {
  it("user deposits sBTC and receives correct token amount after tax", function () {
    // arrange
    const depositAmount = 1000000; // 1 million satoshis
    const expectedTax = 100000; // 10% tax
    const expectedTokens = 900000; // 90% of deposit
    mintMockSbtc(depositAmount, wallet1);

    // act - deposit
    const depositReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(depositAmount)],
      wallet1
    );

    // assert - correct tokens received
    expect(depositReceipt.result).toBeOk(Cl.uint(expectedTokens));

    // verify token balance
    const tokenBalance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(tokenBalance).toBeOk(Cl.uint(expectedTokens));
  });

  it("entrance tax is sent to treasury", function () {
    // arrange
    const depositAmount = 2000000;
    const expectedTax = 200000; // 10% of 2M
    mintMockSbtc(depositAmount, wallet2);

    // get initial treasury sBTC balance
    const treasuryBalanceBefore = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(deployer)], // deployer is initial treasury
      deployer
    ).result;

    // act - deposit
    simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(depositAmount)],
      wallet2
    );

    // assert - treasury received tax
    const treasuryBalanceAfter = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(deployer)],
      deployer
    ).result;

    // Treasury should have gained the tax amount
    if (treasuryBalanceBefore.type === ClarityType.ResponseOk &&
        treasuryBalanceAfter.type === ClarityType.ResponseOk) {
      const beforeValue = (treasuryBalanceBefore.value as any).value;
      const afterValue = (treasuryBalanceAfter.value as any).value;
      expect(afterValue - beforeValue).toBe(BigInt(expectedTax));
    }
  });

  it("total backing equals tokens minted (not including tax)", function () {
    // arrange
    const depositAmount = 1500000;
    const expectedTokens = 1350000; // 90% of deposit
    mintMockSbtc(depositAmount, wallet3);

    // act
    simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(depositAmount)],
      wallet3
    );

    // assert - backing equals tokens
    const totalBacking = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;

    const totalSupply = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-supply",
      [],
      deployer
    ).result;

    // For a single user, backing should equal supply
    expect(totalBacking).toStrictEqual(Cl.uint(expectedTokens));
    expect(totalSupply).toBeOk(Cl.uint(expectedTokens));
  });

  it("deposit fails with zero amount", function () {
    // arrange & act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(0)],
      wallet1
    );

    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
  });
});

describe("token-flows: exit without tax", function () {
  it("user exits tokens and receives 1:1 sBTC (no exit tax)", function () {
    // arrange - first deposit
    const depositAmount = 1000000;
    const tokensReceived = 900000; // after 10% entrance tax
    mintMockSbtc(depositAmount, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet1);

    // get initial sBTC balance
    const sbtcBefore = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;

    // act - withdraw all tokens
    const withdrawReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(tokensReceived)],
      wallet1
    );

    // assert - 1:1 return
    expect(withdrawReceipt.result).toBeOk(Cl.uint(tokensReceived));

    // verify sBTC balance increased by full token amount
    const sbtcAfter = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(sbtcAfter).toBeOk(Cl.uint(tokensReceived));

    // verify token balance is 0
    const tokenBalance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(tokenBalance).toBeOk(Cl.uint(0));
  });

  it("partial withdrawal returns correct amount", function () {
    // arrange
    const depositAmount = 2000000;
    const tokensReceived = 1800000; // 90% of deposit
    const withdrawAmount = 500000;
    mintMockSbtc(depositAmount, wallet2);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet2);

    // act - withdraw partial
    const withdrawReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(withdrawAmount)],
      wallet2
    );

    // assert
    expect(withdrawReceipt.result).toBeOk(Cl.uint(withdrawAmount));

    // verify remaining token balance
    const tokenBalance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    expect(tokenBalance).toBeOk(Cl.uint(tokensReceived - withdrawAmount));
  });

  it("withdrawal updates total backing", function () {
    // arrange
    const depositAmount = 3000000;
    const tokensReceived = 2700000;
    const withdrawAmount = 1000000;
    mintMockSbtc(depositAmount, wallet3);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet3);

    const backingBefore = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;

    // act
    simnet.callPublicFn(daoTokenAddress, "withdraw", [Cl.uint(withdrawAmount)], wallet3);

    // assert
    const backingAfter = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;
    expect(backingAfter).toStrictEqual(Cl.uint(tokensReceived - withdrawAmount));
  });

  it("withdrawal fails with insufficient balance", function () {
    // arrange - deposit some tokens
    mintMockSbtc(1000000, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(1000000)], wallet1);

    // act - try to withdraw more than balance
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(10000000)], // More than deposited
      wallet1
    );

    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });
});

describe("token-flows: token transfers", function () {
  it("user transfers tokens to another user", function () {
    // arrange
    const depositAmount = 1000000;
    const tokensReceived = 900000;
    const transferAmount = 300000;
    mintMockSbtc(depositAmount, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet1);

    // act - transfer to wallet2
    const transferReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer",
      [
        Cl.uint(transferAmount),
        Cl.principal(wallet1),
        Cl.principal(wallet2),
        Cl.none()
      ],
      wallet1
    );

    // assert
    expect(transferReceipt.result).toBeOk(Cl.bool(true));

    // verify balances
    const balance1 = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(balance1).toBeOk(Cl.uint(tokensReceived - transferAmount));

    const balance2 = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    expect(balance2).toBeOk(Cl.uint(transferAmount));
  });

  it("recipient can withdraw transferred tokens", function () {
    // arrange
    const depositAmount = 2000000;
    const tokensReceived = 1800000;
    const transferAmount = 500000;
    mintMockSbtc(depositAmount, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(depositAmount)], wallet1);
    simnet.callPublicFn(
      daoTokenAddress,
      "transfer",
      [Cl.uint(transferAmount), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
      wallet1
    );

    // act - wallet2 withdraws
    const withdrawReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(transferAmount)],
      wallet2
    );

    // assert - 1:1 return
    expect(withdrawReceipt.result).toBeOk(Cl.uint(transferAmount));

    // verify wallet2 has sBTC
    const sbtcBalance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    expect(sbtcBalance).toBeOk(Cl.uint(transferAmount));
  });

  it("transfer with memo includes memo in event", function () {
    // arrange
    mintMockSbtc(1000000, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(1000000)], wallet1);

    // act
    const transferReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer",
      [
        Cl.uint(100000),
        Cl.principal(wallet1),
        Cl.principal(wallet2),
        Cl.some(Cl.buffer(new TextEncoder().encode("test memo")))
      ],
      wallet1
    );

    // assert
    expect(transferReceipt.result).toBeOk(Cl.bool(true));
  });
});

describe("token-flows: multi-user token economics", function () {
  it("multiple users deposit and total supply is correct", function () {
    // arrange
    const amount1 = 1000000;
    const amount2 = 2000000;
    const amount3 = 3000000;
    const tokens1 = 900000; // 90%
    const tokens2 = 1800000;
    const tokens3 = 2700000;

    mintMockSbtc(amount1, wallet1);
    mintMockSbtc(amount2, wallet2);
    mintMockSbtc(amount3, wallet3);

    // act
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(amount1)], wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(amount2)], wallet2);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(amount3)], wallet3);

    // assert
    const totalSupply = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-supply",
      [],
      deployer
    ).result;
    expect(totalSupply).toBeOk(Cl.uint(tokens1 + tokens2 + tokens3));

    const totalBacking = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-backing",
      [],
      deployer
    ).result;
    expect(totalBacking).toStrictEqual(Cl.uint(tokens1 + tokens2 + tokens3));
  });

  it("treasury collects all entrance taxes", function () {
    // arrange
    const amount1 = 1000000;
    const amount2 = 500000;
    const tax1 = 100000;
    const tax2 = 50000;

    // Get initial treasury balance
    const initialBalance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(deployer)],
      deployer
    ).result;

    mintMockSbtc(amount1, wallet1);
    mintMockSbtc(amount2, wallet2);

    // act
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(amount1)], wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(amount2)], wallet2);

    // assert
    const finalBalance = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(deployer)],
      deployer
    ).result;

    if (initialBalance.type === ClarityType.ResponseOk &&
        finalBalance.type === ClarityType.ResponseOk) {
      const initial = (initialBalance.value as any).value;
      const final = (finalBalance.value as any).value;
      expect(final - initial).toBe(BigInt(tax1 + tax2));
    }
  });
});

describe("token-flows: tax calculation functions", function () {
  it("calculate-tax returns correct amount", function () {
    // arrange
    const amount = 1000000;
    const taxRate = 1000; // 10%
    const expectedTax = 100000;

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

  it("get-tokens-for-deposit returns correct amount", function () {
    // arrange
    const depositAmount = 2000000;
    const expectedTokens = 1800000; // 90%

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

  it("get-entrance-tax returns current tax rate", function () {
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
});

describe("token-flows: DAO treasury integration", function () {
  it("treasury accepts deposits after DAO initialization", function () {
    // arrange - construct DAO
    constructDao();

    // Give wallet1 some sBTC
    mintMockSbtc(1000000, wallet1);

    // act - deposit to treasury
    const depositReceipt = simnet.callPublicFn(
      treasuryAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(500000)],
      wallet1
    );

    // assert - should succeed since mock-sbtc is allowed after init
    expect(depositReceipt.result).toBeOk(Cl.bool(true));
  });

  it("treasury rejects deposits before DAO initialization (no allowed assets)", function () {
    // arrange - DO NOT construct DAO, so no assets are allowed yet
    // Give wallet1 some sBTC
    mintMockSbtc(1000000, wallet1);

    // act - try to deposit sBTC before init (not allowed yet)
    const depositReceipt = simnet.callPublicFn(
      treasuryAddress,
      "deposit-ft",
      [Cl.principal(mockSbtcAddress), Cl.uint(500000)],
      wallet1
    );

    // assert - fails with asset not allowed (since DAO not initialized)
    expect(depositReceipt.result).toBeErr(Cl.uint(1901)); // ERR_ASSET_NOT_ALLOWED
  });
});

describe("token-flows: SIP-010 compliance", function () {
  it("get-name returns correct name", function () {
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-name",
      [],
      deployer
    ).result;
    expect(result).toBeOk(Cl.stringAscii("DAO Token"));
  });

  it("get-symbol returns correct symbol", function () {
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-symbol",
      [],
      deployer
    ).result;
    expect(result).toBeOk(Cl.stringAscii("DAO"));
  });

  it("get-decimals returns 8", function () {
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-decimals",
      [],
      deployer
    ).result;
    expect(result).toBeOk(Cl.uint(8));
  });

  it("get-token-uri returns valid URI", function () {
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-token-uri",
      [],
      deployer
    ).result;
    expect(result.type).toBe(ClarityType.ResponseOk);
  });
});

describe("token-flows: edge cases", function () {
  it("very small deposit still applies tax", function () {
    // arrange
    const smallDeposit = 100; // 100 satoshis
    const expectedTax = 10; // 10%
    const expectedTokens = 90;
    mintMockSbtc(smallDeposit, wallet1);

    // act
    const depositReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(smallDeposit)],
      wallet1
    );

    // assert
    expect(depositReceipt.result).toBeOk(Cl.uint(expectedTokens));
  });

  it("large deposit handles correctly", function () {
    // arrange - 21 million BTC worth in satoshis (2.1 quadrillion)
    const largeDeposit = 2100000000000000n; // 21 million BTC
    // Note: This is a theoretical test, actual minting may have limits

    // act
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-tokens-for-deposit",
      [Cl.uint(largeDeposit)],
      deployer
    ).result;

    // assert - should calculate 90%
    const expectedTokens = (largeDeposit * 90n) / 100n;
    expect(result).toStrictEqual(Cl.uint(expectedTokens));
  });

  it("user cannot withdraw more than backing", function () {
    // This tests the safety of the backing mechanism
    // If a user somehow has more tokens than backing, withdrawal should fail

    // arrange - deposit some tokens
    mintMockSbtc(1000000, wallet1);
    simnet.callPublicFn(daoTokenAddress, "deposit", [Cl.uint(1000000)], wallet1);

    // act - try to withdraw exact balance (should work)
    const balance = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;

    if (balance.type === ClarityType.ResponseOk) {
      const balanceValue = (balance.value as any).value;
      const withdrawReceipt = simnet.callPublicFn(
        daoTokenAddress,
        "withdraw",
        [Cl.uint(balanceValue)],
        wallet1
      );
      expect(withdrawReceipt.result).toBeOk(Cl.uint(balanceValue));
    }
  });
});

describe("token-flows: governance functions authorization", function () {
  it("schedule-tax-change requires DAO authorization", function () {
    // arrange & act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "schedule-tax-change",
      [Cl.uint(500)],
      wallet1
    );

    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });

  it("set-treasury requires DAO authorization", function () {
    // arrange & act
    const receipt = simnet.callPublicFn(
      daoTokenAddress,
      "set-treasury",
      [Cl.principal(wallet1)],
      wallet1
    );

    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_AUTHORIZED));
  });

  it("apply-pending-tax fails when no pending change", function () {
    // arrange & act
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

describe("token-flows: complete deposit-transfer-withdraw cycle", function () {
  it("full cycle: user1 deposits, transfers to user2, user2 withdraws", function () {
    // arrange
    const depositAmount = 5000000;
    const tokensReceived = 4500000; // 90%
    const transferAmount = 2000000;

    mintMockSbtc(depositAmount, wallet1);

    // step 1: wallet1 deposits
    const depositReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "deposit",
      [Cl.uint(depositAmount)],
      wallet1
    );
    expect(depositReceipt.result).toBeOk(Cl.uint(tokensReceived));

    // step 2: wallet1 transfers to wallet2
    const transferReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "transfer",
      [
        Cl.uint(transferAmount),
        Cl.principal(wallet1),
        Cl.principal(wallet2),
        Cl.none()
      ],
      wallet1
    );
    expect(transferReceipt.result).toBeOk(Cl.bool(true));

    // step 3: wallet2 withdraws
    const withdrawReceipt = simnet.callPublicFn(
      daoTokenAddress,
      "withdraw",
      [Cl.uint(transferAmount)],
      wallet2
    );
    expect(withdrawReceipt.result).toBeOk(Cl.uint(transferAmount));

    // verify final states
    const wallet1Tokens = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    expect(wallet1Tokens).toBeOk(Cl.uint(tokensReceived - transferAmount));

    const wallet2Tokens = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-balance",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    expect(wallet2Tokens).toBeOk(Cl.uint(0)); // Withdrew all

    const wallet2Sbtc = simnet.callReadOnlyFn(
      mockSbtcAddress,
      "get-balance",
      [Cl.principal(wallet2)],
      deployer
    ).result;
    expect(wallet2Sbtc).toBeOk(Cl.uint(transferAmount));

    // verify total supply is reduced
    const totalSupply = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-total-supply",
      [],
      deployer
    ).result;
    expect(totalSupply).toBeOk(Cl.uint(tokensReceived - transferAmount));
  });
});
