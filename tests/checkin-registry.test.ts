import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToJSON, cvToValue } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!;

// contract info
const contractAddress = `${deployer}.checkin-registry`;
const contractName = "checkin-registry";

// Error codes - Fun numbers for AI agents!
const ERR_CHECKIN_NOT_FOUND = 101; // Binary intro "101"
const ERR_INVALID_USER = 127; // Max signed byte
const ERR_NO_CHECKINS = 169; // 13 squared, unlucky squared

describe(`checkin-registry: check-in()`, function () {
  it("check-in() succeeds and returns index 0 for first check-in", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(0));
  });

  it("check-in() increments index for subsequent check-ins", function () {
    // arrange
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(1));
  });

  it("check-in() emits correct print event", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      deployer
    );
    // assert
    const printEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === contractAddress
    );
    expect(printEvent).toBeDefined();

    const printData = cvToJSON(printEvent!.data.value);
    expect(printData.value.notification.value).toBe(
      "checkin-registry/check-in"
    );
    expect(printData.value.payload.value.user.value).toBe(deployer);
    expect(printData.value.payload.value.index.value).toBe("0");
    expect(printData.value.payload.value["stacks-block-height"]).toBeDefined();
    expect(printData.value.payload.value["burn-block-height"]).toBeDefined();
    expect(printData.value.payload.value["id-header-hash"]).toBeDefined();
    expect(printData.value.payload.value.timestamp).toBeDefined();
  });

  it("check-in() works for multiple users independently", function () {
    // arrange
    // First user checks in
    const receipt1 = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      address1
    );
    // Second user checks in
    const receipt2 = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      address2
    );
    // First user checks in again
    const receipt3 = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      address1
    );

    // assert
    // First user's first check-in should be index 0
    expect(receipt1.result).toBeOk(Cl.uint(0));
    // Second user's first check-in should be index 0
    expect(receipt2.result).toBeOk(Cl.uint(0));
    // First user's second check-in should be index 1
    expect(receipt3.result).toBeOk(Cl.uint(1));
  });

  it("check-in() stores correct block metadata", function () {
    // arrange
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      deployer
    );

    // Get the stored check-in
    const checkin = simnet.callReadOnlyFn(
      contractAddress,
      "get-checkin",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;

    // assert
    expect(receipt.result).toBeOk(Cl.uint(0));
    expect(checkin.type).toBe(ClarityType.OptionalSome);

    if (checkin.type === ClarityType.OptionalSome) {
      const data = checkin.value;
      expect(data.type).toBe(ClarityType.Tuple);
      if (data.type === ClarityType.Tuple) {
        const tupleData = data.value;
        // Verify all required fields exist
        expect(tupleData["stacks-block-height"]).toBeDefined();
        expect(tupleData["burn-block-height"]).toBeDefined();
        expect(tupleData["id-header-hash"]).toBeDefined();
        expect(tupleData["timestamp"]).toBeDefined();
      }
    }
  });
});

describe(`checkin-registry: get-checkin()`, function () {
  it("get-checkin() returns none for non-existent check-in", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-checkin",
      [Cl.principal(deployer), Cl.uint(999)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-checkin() returns data for existing check-in", function () {
    // arrange
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-checkin",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.OptionalSome);
  });
});

describe(`checkin-registry: get-user-checkin-count()`, function () {
  it("get-user-checkin-count() returns 0 for user with no check-ins", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-checkin-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(0));
  });

  it("get-user-checkin-count() returns correct count after check-ins", function () {
    // arrange
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-checkin-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(3));
  });
});

describe(`checkin-registry: get-last-checkin()`, function () {
  it("get-last-checkin() returns none for user with no check-ins", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-checkin",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-last-checkin() returns the most recent check-in", function () {
    // arrange
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    // Mine some blocks
    simnet.mineEmptyBlocks(5);
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);
    simnet.mineEmptyBlocks(3);
    simnet.callPublicFn(contractAddress, "check-in", [], deployer);

    // act
    const lastCheckin = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-checkin",
      [Cl.principal(deployer)],
      deployer
    ).result;

    // Get the specific check-in at index 2 for comparison
    const checkinAtIndex2 = simnet.callReadOnlyFn(
      contractAddress,
      "get-checkin",
      [Cl.principal(deployer), Cl.uint(2)],
      deployer
    ).result;

    // assert
    expect(lastCheckin.type).toBe(ClarityType.OptionalSome);
    expect(checkinAtIndex2.type).toBe(ClarityType.OptionalSome);

    // The last check-in should match the one at index 2
    if (
      lastCheckin.type === ClarityType.OptionalSome &&
      checkinAtIndex2.type === ClarityType.OptionalSome
    ) {
      expect(lastCheckin.value).toStrictEqual(checkinAtIndex2.value);
    }
  });
});

describe(`checkin-registry: get-contract-info()`, function () {
  it("get-contract-info() returns expected deployment info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);

    if (result.type === ClarityType.Tuple) {
      const tupleData = result.value;
      expect(tupleData.self).toStrictEqual(Cl.principal(contractAddress));
      expect(tupleData["deployed-at-burn-block"]).toBeDefined();
      expect(tupleData["deployed-at-stacks-block"]).toBeDefined();
    }
  });
});

describe(`checkin-registry: integration scenarios`, function () {
  it("complete workflow: multiple users checking in over time", function () {
    // User 1 checks in
    const user1Checkin1 = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      address1
    );
    expect(user1Checkin1.result).toBeOk(Cl.uint(0));

    // User 2 checks in
    const user2Checkin1 = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      address2
    );
    expect(user2Checkin1.result).toBeOk(Cl.uint(0));

    // Mine some blocks
    simnet.mineEmptyBlocks(10);

    // User 1 checks in again
    const user1Checkin2 = simnet.callPublicFn(
      contractAddress,
      "check-in",
      [],
      address1
    );
    expect(user1Checkin2.result).toBeOk(Cl.uint(1));

    // Verify counts
    const user1Count = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-checkin-count",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(user1Count).toStrictEqual(Cl.uint(2));

    const user2Count = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-checkin-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2Count).toStrictEqual(Cl.uint(1));

    // Verify last check-in for each user
    const user1Last = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-checkin",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(user1Last.type).toBe(ClarityType.OptionalSome);

    const user2Last = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-checkin",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2Last.type).toBe(ClarityType.OptionalSome);

    // Verify individual check-ins exist
    const user1FirstCheckin = simnet.callReadOnlyFn(
      contractAddress,
      "get-checkin",
      [Cl.principal(address1), Cl.uint(0)],
      deployer
    ).result;
    expect(user1FirstCheckin.type).toBe(ClarityType.OptionalSome);

    const user1SecondCheckin = simnet.callReadOnlyFn(
      contractAddress,
      "get-checkin",
      [Cl.principal(address1), Cl.uint(1)],
      deployer
    ).result;
    expect(user1SecondCheckin.type).toBe(ClarityType.OptionalSome);
  });
});
