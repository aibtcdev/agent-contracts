import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToJSON } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!;

// contract info
const manifestoContract = `${deployer}.manifesto`;
const checkinContract = `${deployer}.checkin-registry`;
const proofContract = `${deployer}.proof-registry`;

// Error codes - Fun numbers for AI agents!
const ERR_TEXT_TOO_LONG = 301; // HTTP "Moved Permanently" - manifesto outgrew container
const ERR_MANIFESTO_NOT_FOUND = 314; // Pi approximation - irrational, doesn't exist
const ERR_CHECKIN_FAILED = 333; // Half of 666 - semi-evil
const ERR_TEXT_EMPTY = 337; // Leet adjacent "eet" - can't manifest nothing
const ERR_PROOF_FAILED = 342; // 42 + 300 - meaning of everything failed
const ERR_NO_MANIFESTOS = 369; // Tesla's 3-6-9 - no vibrational manifestos
const ERR_HASH_ALREADY_EXISTS = 255; // From proof-registry

// Helper to create test hashes
function createTestHash(seed: number): Uint8Array {
  const hash = new Uint8Array(32);
  hash[0] = seed;
  hash[31] = seed;
  return hash;
}

// Helper to create test text
function createTestText(length: number, prefix: string = "Manifesto"): string {
  const base = `${prefix}: `;
  const padding = "x".repeat(Math.max(0, length - base.length));
  return base + padding;
}

describe(`manifesto: submit-manifesto()`, function () {
  it("submit-manifesto() succeeds and returns index 0 for first manifesto", function () {
    // arrange
    const testHash = createTestHash(1);
    const testText = "My first manifesto: I believe in decentralization.";
    // act
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(0));
  });

  it("submit-manifesto() increments index for subsequent manifestos", function () {
    // arrange
    const hash1 = createTestHash(10);
    const hash2 = createTestHash(11);
    const text1 = "First manifesto text.";
    const text2 = "Second manifesto text.";
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash1), Cl.stringUtf8(text1)],
      deployer
    );
    // act
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash2), Cl.stringUtf8(text2)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(1));
  });

  it("submit-manifesto() creates check-in in registry", function () {
    // arrange
    const testHash = createTestHash(20);
    const testText = "My manifesto creates a check-in.";
    // act
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // assert - verify check-in exists
    const checkinCount = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    expect(checkinCount).toStrictEqual(Cl.uint(1));

    const checkin = simnet.callReadOnlyFn(
      checkinContract,
      "get-checkin",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    expect(checkin.type).toBe(ClarityType.OptionalSome);
  });

  it("submit-manifesto() creates proof in registry", function () {
    // arrange
    const testHash = createTestHash(30);
    const testText = "My manifesto creates a proof.";
    // act
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // assert - verify proof exists
    const proofCount = simnet.callReadOnlyFn(
      proofContract,
      "get-user-proof-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    expect(proofCount).toStrictEqual(Cl.uint(1));

    const proof = simnet.callReadOnlyFn(
      proofContract,
      "get-proof",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    expect(proof.type).toBe(ClarityType.OptionalSome);
  });

  it("submit-manifesto() stores manifesto text correctly", function () {
    // arrange
    const testHash = createTestHash(40);
    const testText = "This is the manifesto text that should be stored.";
    // act
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // assert - verify text is stored
    const manifesto = simnet.callReadOnlyFn(
      manifestoContract,
      "get-manifesto",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    expect(manifesto.type).toBe(ClarityType.OptionalSome);

    if (manifesto.type === ClarityType.OptionalSome) {
      const data = manifesto.value;
      if (data.type === ClarityType.Tuple) {
        expect(data.value.text).toStrictEqual(Cl.stringUtf8(testText));
      }
    }
  });

  it("submit-manifesto() emits correct print event", function () {
    // arrange
    const testHash = createTestHash(50);
    const testText = "Manifesto with print event.";
    // act
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // assert
    const printEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === manifestoContract
    );
    expect(printEvent).toBeDefined();

    const printData = cvToJSON(printEvent!.data.value);
    expect(printData.value.notification.value).toBe(
      "manifesto/submit-manifesto"
    );
    expect(printData.value.payload.value.user.value).toBe(deployer);
    expect(printData.value.payload.value.index.value).toBe("0");
    expect(printData.value.payload.value.hash).toBeDefined();
    expect(printData.value.payload.value.text.value).toBe(testText);
    expect(printData.value.payload.value["checkin-index"]).toBeDefined();
    expect(printData.value.payload.value["proof-index"]).toBeDefined();
    expect(printData.value.payload.value["stacks-block-height"]).toBeDefined();
    expect(printData.value.payload.value["burn-block-height"]).toBeDefined();
    expect(printData.value.payload.value.timestamp).toBeDefined();
  });

  it("submit-manifesto() fails for empty text (ERR_TEXT_EMPTY)", function () {
    // arrange
    const testHash = createTestHash(60);
    const emptyText = "";
    // act
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(emptyText)],
      deployer
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_TEXT_EMPTY));
  });

  it("submit-manifesto() fails for duplicate hash (mapped to ERR_PROOF_FAILED)", function () {
    // arrange
    const duplicateHash = createTestHash(70);
    const text1 = "First manifesto with this hash.";
    const text2 = "Second manifesto trying same hash.";
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(duplicateHash), Cl.stringUtf8(text1)],
      deployer
    );
    // act - try to submit with same hash
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(duplicateHash), Cl.stringUtf8(text2)],
      address1
    );
    // assert - proof-registry error mapped to manifesto's ERR_PROOF_FAILED
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROOF_FAILED));
  });

  it("submit-manifesto() works for multiple users independently", function () {
    // arrange
    const hash1 = createTestHash(80);
    const hash2 = createTestHash(81);
    const hash3 = createTestHash(82);
    const text1 = "User 1 first manifesto.";
    const text2 = "User 2 first manifesto.";
    const text3 = "User 1 second manifesto.";

    // First user submits
    const receipt1 = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash1), Cl.stringUtf8(text1)],
      address1
    );
    // Second user submits
    const receipt2 = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash2), Cl.stringUtf8(text2)],
      address2
    );
    // First user submits again
    const receipt3 = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash3), Cl.stringUtf8(text3)],
      address1
    );

    // assert
    expect(receipt1.result).toBeOk(Cl.uint(0));
    expect(receipt2.result).toBeOk(Cl.uint(0));
    expect(receipt3.result).toBeOk(Cl.uint(1));
  });

  it("submit-manifesto() stores correct registry references", function () {
    // arrange
    const testHash = createTestHash(90);
    const testText = "Manifesto with registry references.";
    // act
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // assert - verify references
    const manifesto = simnet.callReadOnlyFn(
      manifestoContract,
      "get-manifesto",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;

    expect(manifesto.type).toBe(ClarityType.OptionalSome);
    if (manifesto.type === ClarityType.OptionalSome) {
      const data = manifesto.value;
      if (data.type === ClarityType.Tuple) {
        // Both indices should be 0 for first submission
        expect(data.value["checkin-index"]).toStrictEqual(Cl.uint(0));
        expect(data.value["proof-index"]).toStrictEqual(Cl.uint(0));
      }
    }
  });
});

describe(`manifesto: get-manifesto()`, function () {
  it("get-manifesto() returns none for non-existent manifesto", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      manifestoContract,
      "get-manifesto",
      [Cl.principal(deployer), Cl.uint(999)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-manifesto() returns data for existing manifesto", function () {
    // arrange
    const testHash = createTestHash(100);
    const testText = "Manifesto to retrieve.";
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      manifestoContract,
      "get-manifesto",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.OptionalSome);
  });
});

describe(`manifesto: get-user-manifesto-count()`, function () {
  it("get-user-manifesto-count() returns 0 for user with no manifestos", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(0));
  });

  it("get-user-manifesto-count() returns correct count after manifestos", function () {
    // arrange
    const hash1 = createTestHash(110);
    const hash2 = createTestHash(111);
    const hash3 = createTestHash(112);
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash1), Cl.stringUtf8("First")],
      deployer
    );
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash2), Cl.stringUtf8("Second")],
      deployer
    );
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash3), Cl.stringUtf8("Third")],
      deployer
    );
    // act
    const result = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(3));
  });
});

describe(`manifesto: get-last-manifesto()`, function () {
  it("get-last-manifesto() returns none for user with no manifestos", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      manifestoContract,
      "get-last-manifesto",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-last-manifesto() returns the most recent manifesto", function () {
    // arrange
    const hash1 = createTestHash(120);
    const hash2 = createTestHash(121);
    const hash3 = createTestHash(122);
    const text1 = "First manifesto.";
    const text2 = "Second manifesto.";
    const text3 = "Third and last manifesto.";
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash1), Cl.stringUtf8(text1)],
      deployer
    );
    simnet.mineEmptyBlocks(5);
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash2), Cl.stringUtf8(text2)],
      deployer
    );
    simnet.mineEmptyBlocks(3);
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash3), Cl.stringUtf8(text3)],
      deployer
    );

    // act
    const lastManifesto = simnet.callReadOnlyFn(
      manifestoContract,
      "get-last-manifesto",
      [Cl.principal(deployer)],
      deployer
    ).result;

    // Get the specific manifesto at index 2 for comparison
    const manifestoAtIndex2 = simnet.callReadOnlyFn(
      manifestoContract,
      "get-manifesto",
      [Cl.principal(deployer), Cl.uint(2)],
      deployer
    ).result;

    // assert
    expect(lastManifesto.type).toBe(ClarityType.OptionalSome);
    expect(manifestoAtIndex2.type).toBe(ClarityType.OptionalSome);

    // The last manifesto should match the one at index 2
    if (
      lastManifesto.type === ClarityType.OptionalSome &&
      manifestoAtIndex2.type === ClarityType.OptionalSome
    ) {
      expect(lastManifesto.value).toStrictEqual(manifestoAtIndex2.value);
    }
  });
});

describe(`manifesto: get-contract-info()`, function () {
  it("get-contract-info() returns expected deployment info", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      manifestoContract,
      "get-contract-info",
      [],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.Tuple);

    if (result.type === ClarityType.Tuple) {
      const tupleData = result.value;
      expect(tupleData.self).toStrictEqual(Cl.principal(manifestoContract));
      expect(tupleData["deployed-at-burn-block"]).toBeDefined();
      expect(tupleData["deployed-at-stacks-block"]).toBeDefined();
    }
  });
});

describe(`manifesto: atomicity scenarios`, function () {
  it("duplicate hash fails entire operation - no check-in created", function () {
    // arrange
    const sharedHash = createTestHash(200);
    const text1 = "First manifesto with shared hash.";
    const text2 = "Second attempt with same hash.";

    // First submission succeeds
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(sharedHash), Cl.stringUtf8(text1)],
      address1
    );

    // Get address2's check-in count before failed attempt
    const countBefore = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(address2)],
      deployer
    ).result;

    // act - address2 tries with same hash, should fail atomically
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(sharedHash), Cl.stringUtf8(text2)],
      address2
    );

    // Get address2's check-in count after failed attempt
    const countAfter = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(address2)],
      deployer
    ).result;

    // assert - operation failed and check-in was NOT created
    // Note: proof-registry's ERR_HASH_ALREADY_EXISTS (255) is mapped to manifesto's ERR_PROOF_FAILED (342)
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROOF_FAILED));
    expect(countAfter).toStrictEqual(countBefore);
  });
});
