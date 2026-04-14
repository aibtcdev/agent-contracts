import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToJSON } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;

// contract addresses
const baseDaoAddress = `${deployer}.base-dao`;
const initProposalAddress = `${deployer}.init-proposal`;
const treasuryAddress = `${deployer}.dao-treasury`;
const epochAddress = `${deployer}.dao-epoch`;
const charterAddress = `${deployer}.dao-charter`;
const tokenOwnerAddress = `${deployer}.dao-token-owner`;
const coreProposalsAddress = `${deployer}.core-proposals`;
const agentRegistryAddress = `${deployer}.agent-registry`;
const mockSbtcAddress = `${deployer}.mock-sbtc`;
const daoTokenAddress = `${deployer}.dao-token`;

// Expected initial charter
const INITIAL_CHARTER =
  "Simplified Agent DAO - A collective for AI agents earning x402 income. Built for autonomous operation with human oversight.";

// Error codes from base-dao
const ERR_UNAUTHORIZED = 1000;
const ERR_DAO_ALREADY_CONSTRUCTED = 1004;

describe("init-proposal: pre-initialization state", function () {
  it("DAO is not constructed initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-constructed",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(false));
  });

  it("no extensions are enabled initially", function () {
    // arrange
    const extensions = [
      treasuryAddress,
      epochAddress,
      charterAddress,
      tokenOwnerAddress,
      coreProposalsAddress,
      agentRegistryAddress,
    ];
    // act & assert
    for (const ext of extensions) {
      const result = simnet.callReadOnlyFn(
        baseDaoAddress,
        "is-extension",
        [Cl.principal(ext)],
        deployer
      ).result;
      expect(result).toStrictEqual(Cl.bool(false));
    }
  });

  it("treasury does not allow any assets initially", function () {
    // arrange
    // act
    const mockSbtcAllowed = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    const daoTokenAllowed = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(daoTokenAddress)],
      deployer
    ).result;
    // assert
    expect(mockSbtcAllowed).toStrictEqual(Cl.bool(false));
    expect(daoTokenAllowed).toStrictEqual(Cl.bool(false));
  });

  it("charter has no content initially", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      charterAddress,
      "get-current-dao-charter-index",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });
});

describe("init-proposal: construct() execution", function () {
  it("construct() succeeds when called by deployer", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.bool(true));
  });

  it("construct() marks DAO as constructed", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-constructed",
      [],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("construct() fails when called by non-deployer", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      wallet1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("construct() cannot be called twice", function () {
    // arrange - construct once
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act - try to construct again
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_DAO_ALREADY_CONSTRUCTED));
  });
});

describe("init-proposal: extensions enabled", function () {
  it("all extensions are enabled after construct", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    const extensions = [
      treasuryAddress,
      epochAddress,
      charterAddress,
      tokenOwnerAddress,
      coreProposalsAddress,
      agentRegistryAddress,
    ];
    // act & assert
    for (const ext of extensions) {
      const result = simnet.callReadOnlyFn(
        baseDaoAddress,
        "is-extension",
        [Cl.principal(ext)],
        deployer
      ).result;
      expect(result).toStrictEqual(Cl.bool(true));
    }
  });

  it("treasury extension is enabled", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(treasuryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("epoch extension is enabled", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(epochAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("charter extension is enabled", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(charterAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("token-owner extension is enabled", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(tokenOwnerAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("core-proposals extension is enabled", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(coreProposalsAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("agent-registry extension is enabled", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "is-extension",
      [Cl.principal(agentRegistryAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });
});

describe("init-proposal: charter initialized", function () {
  it("charter is set after construct", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      charterAddress,
      "get-current-dao-charter",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.OptionalSome);
    if (result.type === ClarityType.OptionalSome) {
      const charterData = cvToJSON(result.value);
      expect(charterData.value.charter.value).toBe(INITIAL_CHARTER);
    }
  });

  it("charter index is 1 after construct", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      charterAddress,
      "get-current-dao-charter-index",
      [],
      deployer
    ).result;
    // assert
    expect(result).toBeSome(Cl.uint(1));
  });
});

describe("init-proposal: treasury assets allowed", function () {
  it("mock-sbtc is allowed in treasury after construct", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(mockSbtcAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });

  it("dao-token is allowed in treasury after construct", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      treasuryAddress,
      "is-allowed-asset",
      [Cl.principal(daoTokenAddress)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.bool(true));
  });
});

describe("init-proposal: print events", function () {
  it("construct emits init-proposal/execute event", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // assert - find the init-proposal event
    const initEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === initProposalAddress
    );
    expect(initEvent).toBeDefined();
    const eventData = cvToJSON(initEvent!.data.value);
    expect(eventData.value.notification.value).toBe("init-proposal/execute");
  });

  it("construct emits base-dao/construct event", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // assert - find the base-dao construct event
    const constructEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === baseDaoAddress &&
        cvToJSON(e.data.value).value?.notification?.value === "base-dao/construct"
    );
    expect(constructEvent).toBeDefined();
  });

  it("construct emits multiple set-extension events", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // assert - count set-extension events
    const setExtEvents = receipt.events.filter(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === baseDaoAddress &&
        cvToJSON(e.data.value).value?.notification?.value === "base-dao/set-extension"
    );
    // 6 core extensions enabled + 2 temporary init-proposal toggle events
    // (enable before DAO-gated setup calls, disable at the end to prevent
    // re-execution). See init-proposal.clar for the rationale.
    expect(setExtEvents.length).toBe(8);
  });
});

describe("init-proposal: proposal execution tracking", function () {
  it("init-proposal is marked as executed in base-dao", function () {
    // arrange
    simnet.callPublicFn(
      baseDaoAddress,
      "construct",
      [Cl.principal(initProposalAddress)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      baseDaoAddress,
      "executed-at",
      [Cl.principal(initProposalAddress)],
      deployer
    ).result;
    // assert - should return some block height
    expect(result.type).toBe(ClarityType.OptionalSome);
  });
});
