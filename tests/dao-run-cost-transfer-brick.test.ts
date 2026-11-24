import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// Regression test for: dao-run-cost `execute-transfer` used to mark a
// transfer proposal as executed BEFORE the token transfer ran, and swallowed
// a transfer failure as `(ok false)` instead of returning an error. Because
// the outer function returned `ok` (not `err`), Clarity did NOT roll the
// state change back, so the proposal was permanently bricked: it could never
// be executed again even after the multisig was funded. The only workaround
// was a brand-new nonce.
//
// The fix: `execute-transfer` now performs the token transfer FIRST and
// propagates a failure with `try!`, so a failed transfer returns `(err ...)`
// and rolls back every state change in the transaction. The proposal is only
// marked executed (and the execute event only printed) after the transfer
// succeeds, so it stays retryable once the multisig is funded.
//
// Run with:
//   cd agent-contracts && npx vitest run tests/dao-run-cost-transfer-brick.test.ts

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const runCostAddress = `${deployer}.dao-run-cost`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;

// ft-transfer? fails with (err u1) on insufficient balance.
const ERR_FT_INSUFFICIENT_BALANCE = 1;

function mintMockSbtc(amount: number, recipient: string) {
  return simnet.callPublicFn(
    mockSbtcAddress,
    "mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    deployer
  );
}

function allowMockSbtc() {
  simnet.callPublicFn(
    runCostAddress,
    "set-asset",
    [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
    deployer
  );
  const receipt = simnet.callPublicFn(
    runCostAddress,
    "set-asset",
    [Cl.uint(1), Cl.principal(mockSbtcAddress), Cl.bool(true)],
    wallet1
  );
  expect(receipt.result).toBeOk(Cl.bool(true));
}

function getTransferProposal(nonce: number) {
  return simnet.callReadOnlyFn(
    runCostAddress,
    "get-transfer-proposal",
    [Cl.uint(nonce)],
    deployer
  ).result;
}

function getMockSbtcBalance(who: string) {
  return simnet.callReadOnlyFn(
    mockSbtcAddress,
    "get-balance",
    [Cl.principal(who)],
    deployer
  ).result;
}

// The multisig holds 0 mock-sBTC on purpose: the 500,000 transfer MUST fail
// inside `execute-transfer` (ft-transfer? -> (err u1) on insufficient balance).
function proposeAndConfirmTransfer(nonce: number, amount: number) {
  simnet.callPublicFn(
    runCostAddress,
    "transfer-token",
    [
      Cl.uint(nonce),
      Cl.principal(mockSbtcAddress),
      Cl.uint(amount),
      Cl.principal(wallet3),
    ],
    deployer
  );
  return simnet.callPublicFn(
    runCostAddress,
    "transfer-token",
    [
      Cl.uint(nonce),
      Cl.principal(mockSbtcAddress),
      Cl.uint(amount),
      Cl.principal(wallet3),
    ],
    wallet1
  );
}

describe("dao-run-cost: failed transfer no longer bricks the proposal", function () {
  it("failed 2nd confirmation returns (err u1) and leaves the proposal unexecuted", function () {
    allowMockSbtc();
    // Multisig balance is 0; transfer of 500,000 cannot succeed.
    expect(getMockSbtcBalance(runCostAddress)).toBeOk(Cl.uint(0));

    const receipt = proposeAndConfirmTransfer(1, 500000);

    // The transfer failure is propagated as an error, so the whole
    // transaction rolls back instead of committing (ok false).
    expect(receipt.result).toBeErr(Cl.uint(ERR_FT_INSUFFICIENT_BALANCE));

    // No tokens moved.
    expect(getMockSbtcBalance(wallet3)).toBeOk(Cl.uint(0));

    // The proposal is NOT marked executed, so it stays retryable.
    const proposal = getTransferProposal(1);
    expect(proposal.type).toBe(ClarityType.OptionalSome);
    if (proposal.type === ClarityType.OptionalSome) {
      const executed = (proposal.value as any).value.executed;
      expect(executed.type).toBe(ClarityType.OptionalNone);
    }
  });

  it("funding the multisig afterwards revives the same proposal", function () {
    allowMockSbtc();
    const failed = proposeAndConfirmTransfer(1, 500000);
    expect(failed.result).toBeErr(Cl.uint(ERR_FT_INSUFFICIENT_BALANCE));
    expect(getMockSbtcBalance(wallet3)).toBeOk(Cl.uint(0));

    // Fund the multisig in full, then retry the SAME nonce with the 3rd owner.
    // (The failed confirmation rolled back, so this is the 2nd confirmation.)
    mintMockSbtc(1000000, runCostAddress);
    expect(getMockSbtcBalance(runCostAddress)).toBeOk(Cl.uint(1000000));

    const retry = simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(1),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      wallet2
    );
    expect(retry.result).toBeOk(Cl.bool(true));
    expect(getMockSbtcBalance(wallet3)).toBeOk(Cl.uint(500000));

    // And now the proposal IS marked executed.
    const proposal = getTransferProposal(1);
    expect(proposal.type).toBe(ClarityType.OptionalSome);
    if (proposal.type === ClarityType.OptionalSome) {
      const executed = (proposal.value as any).value.executed;
      expect(executed.type).toBe(ClarityType.OptionalSome);
    }
  });

  it("control: the same transfer under a FRESH nonce succeeds once funded", function () {
    allowMockSbtc();
    proposeAndConfirmTransfer(1, 500000);
    mintMockSbtc(1000000, runCostAddress);

    // New nonce, same amount/recipient: works fine — isolates the fix to the
    // failed first execution, not to the transfer logic itself.
    simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(2),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      deployer
    );
    const receipt = simnet.callPublicFn(
      runCostAddress,
      "transfer-token",
      [
        Cl.uint(2),
        Cl.principal(mockSbtcAddress),
        Cl.uint(500000),
        Cl.principal(wallet3),
      ],
      wallet1
    );
    expect(receipt.result).toBeOk(Cl.bool(true));
    expect(getMockSbtcBalance(wallet3)).toBeOk(Cl.uint(500000));
  });
});
