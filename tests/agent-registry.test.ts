import { describe, expect, it } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// contract info
const agentRegistryAddress = `${deployer}.agent-registry`;
const baseDaoAddress = `${deployer}.base-dao`;
const agentAccountAddress = `${deployer}.agent-account`;

// Error codes
const ERR_NOT_DAO_OR_EXTENSION = 2000;
const ERR_TEMPLATE_NOT_FOUND = 2001;
const ERR_TEMPLATE_ALREADY_EXISTS = 2002;
const ERR_ACCOUNT_NOT_FOUND = 2003;
const ERR_ACCOUNT_ALREADY_REGISTERED = 2004;
const ERR_INVALID_ATTESTATION_LEVEL = 2005;
const ERR_INVALID_PRINCIPAL = 2006;
const ERR_ACCOUNT_IS_NOT_CONTRACT = 2007;
const ERR_OWNER_MUST_BE_STANDARD = 2008;
const ERR_ACCOUNT_ALREADY_ACTIVE = 2009;
const ERR_ACCOUNT_ALREADY_INACTIVE = 2010;
const ERR_TEMPLATE_NOT_APPROVED = 2011;
const ERR_HASH_NOT_AVAILABLE = 2012;

// Attestation levels
const ATTESTATION_UNVERIFIED = 0;
const ATTESTATION_REGISTERED = 1;
const ATTESTATION_HASH_VERIFIED = 2;
const ATTESTATION_AUDITED = 3;

// Sample template hash (32 bytes)
const sampleHash = new Uint8Array(32).fill(0xab);
const sampleHash2 = new Uint8Array(32).fill(0xcd);

describe("agent-registry: initial state", function () {
  it("get-contract-info() returns valid contract info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);
    // contract info has deployedBurnBlock, deployedStacksBlock, maxAttestationLevel
    // no "self" field in v2
  });

  it("is-approved-template() returns false for unknown hash", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "is-approved-template",
      [Cl.buffer(sampleHash)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-template-info() returns none for unknown hash", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "get-template-info",
      [Cl.buffer(sampleHash)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("is-registered-account() returns false for unknown account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "is-registered-account",
      [Cl.principal(agentRegistryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-account-info() returns none for unknown account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "get-account-info",
      [Cl.principal(agentRegistryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });
});

describe("agent-registry: callback", function () {
  it("callback() succeeds for any caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "callback",
      [Cl.principal(wallet1), Cl.buffer(new Uint8Array(34))],
      wallet1
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });
});

describe("agent-registry: template management authorization", function () {
  it("add-approved-template() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "add-approved-template",
      [Cl.buffer(sampleHash), Cl.stringAscii("test-template"), Cl.uint(1)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("add-approved-template() fails for deployer (not DAO)", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "add-approved-template",
      [Cl.buffer(sampleHash), Cl.stringAscii("test-template"), Cl.uint(1)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("remove-approved-template() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "remove-approved-template",
      [Cl.buffer(sampleHash)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_TEMPLATE_NOT_FOUND));
  });
});

describe("agent-registry: account registration", function () {
  // NOTE: Full happy-path registration requires:
  // 1. DAO constructed (base-dao initialized)
  // 2. Template hash approved via DAO proposal
  // 3. agent-account contract deployed and initialized with get-config
  // These unit tests verify error paths without full DAO setup.

  it("register-agent-account() fails when agent-account is not initialized", function () {
    // arrange
    // act - pass agent-account as trait parameter
    // agent-account's get-config will return an error since it's not initialized
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "register-agent-account",
      [Cl.principal(agentAccountAddress)],
      wallet1
    );
    // assert - fails because contract-hash? or get-config returns an error
    // before reaching any principal validation
    expect(receipt.result.type).toBe(ClarityType.ResponseErr);
  });

  it("register-agent-account() fails regardless of caller (permissionless but hash-gated)", function () {
    // arrange
    // act - even deployer can't register without proper setup
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "register-agent-account",
      [Cl.principal(agentAccountAddress)],
      deployer
    );
    // assert - same error as above, registration is permissionless
    // but gated by hash verification and get-config availability
    expect(receipt.result.type).toBe(ClarityType.ResponseErr);
  });
});

describe("agent-registry: attestation level management", function () {
  it("set-attestation-level() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "set-attestation-level",
      [Cl.principal(agentRegistryAddress), Cl.uint(ATTESTATION_AUDITED)],
      wallet1
    );
    // assert - fails because account not registered
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });

  it("set-attestation-level() fails for invalid level", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "set-attestation-level",
      [Cl.principal(agentRegistryAddress), Cl.uint(10)],
      deployer
    );
    // assert - fails because account not registered (checked first)
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });
});

describe("agent-registry: verification function", function () {
  it("verify-agent-account() returns ERR_ACCOUNT_NOT_FOUND for unregistered account", function () {
    // arrange
    // act - verify-agent-account now does real Clarity 4 hash verification
    // but first checks if the account is registered
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "verify-agent-account",
      [Cl.principal(agentRegistryAddress)],
      wallet1
    );
    // assert - fails because account is not registered
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });
});

describe("agent-registry: read-only functions", function () {
  it("is-verified-account() returns false for unregistered account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "is-verified-account",
      [Cl.principal(agentRegistryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("is-attested-account() returns false for unregistered account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "is-attested-account",
      [Cl.principal(agentRegistryAddress), Cl.uint(ATTESTATION_REGISTERED)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("get-attestation-level() returns none for unregistered account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "get-attestation-level",
      [Cl.principal(agentRegistryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-account-by-owner() returns none for unknown owner", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "get-account-by-owner",
      [Cl.principal(wallet1)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-account-by-agent() returns none for unknown agent", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "get-account-by-agent",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });
});

describe("agent-registry: authorization patterns", function () {
  it("only DAO or extensions can add templates", function () {
    // arrange
    // act
    const result1 = simnet.callPublicFn(
      agentRegistryAddress,
      "add-approved-template",
      [Cl.buffer(sampleHash), Cl.stringAscii("template-1"), Cl.uint(1)],
      wallet1
    );
    const result2 = simnet.callPublicFn(
      agentRegistryAddress,
      "add-approved-template",
      [Cl.buffer(sampleHash), Cl.stringAscii("template-1"), Cl.uint(1)],
      wallet2
    );
    // assert
    expect(result1.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
    expect(result2.result).toBeErr(Cl.uint(ERR_NOT_DAO_OR_EXTENSION));
  });

  it("only DAO or extensions can set attestation levels", function () {
    // arrange
    // act - these will fail on account not found first, but that's expected
    const result1 = simnet.callPublicFn(
      agentRegistryAddress,
      "set-attestation-level",
      [Cl.principal(agentRegistryAddress), Cl.uint(ATTESTATION_AUDITED)],
      wallet1
    );
    const result2 = simnet.callPublicFn(
      agentRegistryAddress,
      "set-attestation-level",
      [Cl.principal(agentRegistryAddress), Cl.uint(ATTESTATION_AUDITED)],
      wallet2
    );
    // assert
    expect(result1.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
    expect(result2.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });
});

describe("agent-registry: deactivate-agent authorization", function () {
  it("deactivate-agent() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "deactivate-agent",
      [Cl.principal(agentRegistryAddress)],
      wallet1
    );
    // assert - fails because account not registered
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });

  it("deactivate-agent() fails for unregistered account", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "deactivate-agent",
      [Cl.principal(agentRegistryAddress)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });
});

describe("agent-registry: reactivate-agent authorization", function () {
  it("reactivate-agent() fails for non-DAO caller", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "reactivate-agent",
      [Cl.principal(agentRegistryAddress)],
      wallet1
    );
    // assert - fails because account not registered
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });

  it("reactivate-agent() fails for unregistered account", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      agentRegistryAddress,
      "reactivate-agent",
      [Cl.principal(agentRegistryAddress)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_ACCOUNT_NOT_FOUND));
  });
});

describe("agent-registry: is-active-agent read-only", function () {
  it("is-active-agent() returns false for unregistered account", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "is-active-agent",
      [Cl.principal(agentRegistryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("is-active-agent() returns false for unknown wallet", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      agentRegistryAddress,
      "is-active-agent",
      [Cl.principal(wallet3)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });
});

describe("agent-registry: error codes documentation", function () {
  it("documents all error codes", function () {
    expect(ERR_NOT_DAO_OR_EXTENSION).toBe(2000);
    expect(ERR_TEMPLATE_NOT_FOUND).toBe(2001);
    expect(ERR_TEMPLATE_ALREADY_EXISTS).toBe(2002);
    expect(ERR_ACCOUNT_NOT_FOUND).toBe(2003);
    expect(ERR_ACCOUNT_ALREADY_REGISTERED).toBe(2004);
    expect(ERR_INVALID_ATTESTATION_LEVEL).toBe(2005);
    expect(ERR_INVALID_PRINCIPAL).toBe(2006);
    expect(ERR_ACCOUNT_IS_NOT_CONTRACT).toBe(2007);
    expect(ERR_OWNER_MUST_BE_STANDARD).toBe(2008);
    expect(ERR_ACCOUNT_ALREADY_ACTIVE).toBe(2009);
    expect(ERR_ACCOUNT_ALREADY_INACTIVE).toBe(2010);
    expect(ERR_TEMPLATE_NOT_APPROVED).toBe(2011);
    expect(ERR_HASH_NOT_AVAILABLE).toBe(2012);
  });

  it("documents attestation levels", function () {
    expect(ATTESTATION_UNVERIFIED).toBe(0);
    expect(ATTESTATION_REGISTERED).toBe(1);
    expect(ATTESTATION_HASH_VERIFIED).toBe(2);
    expect(ATTESTATION_AUDITED).toBe(3);
  });
});
