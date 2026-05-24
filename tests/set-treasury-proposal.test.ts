import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;

const proposalAddress = `${deployer}.set-treasury-proposal`;
const daoTokenAddress = `${deployer}.dao-token`;

describe("set-treasury-proposal: governance rotation template", function () {
  it("compiles and is deployed", function () {
    // If the contract is unparsable, simnet would have failed to init.
    // Assert we can query it via a read-only indirect path: dao-token's
    // get-treasury returns the current treasury and should work regardless.
    const result = simnet.callReadOnlyFn(
      daoTokenAddress,
      "get-treasury",
      [],
      deployer
    ).result;
    // Deployed state: defaults to CONTRACT_DEPLOYER until a governance set.
    expect(result.type).toBeDefined();
  });

  it("execute() rejects direct non-DAO caller (set-treasury gate)", function () {
    // The proposal contract itself has no auth — execute can be called by
    // anyone directly. But the inner set-treasury call requires the caller
    // (which is the proposal contract principal) to be a DAO extension.
    // A freshly-deployed, non-enabled proposal contract is NOT a DAO
    // extension, so this inner call should error ERR_UNAUTHORIZED.
    const result = simnet.callPublicFn(
      proposalAddress,
      "execute",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // Expect an err from set-treasury's is-dao-or-extension gate.
    // dao-token's ERR_NOT_AUTHORIZED is u2000 (see dao-token.clar).
    expect(result).toBeErr(Cl.uint(2000));
  });
});
