import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToJSON, cvToValue } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!;
const address3 = accounts.get("wallet_3")!;

// contract info
const manifestoContract = `${deployer}.manifesto`;
const checkinContract = `${deployer}.checkin-registry`;
const proofContract = `${deployer}.proof-registry`;

// Error codes
const ERR_HASH_ALREADY_EXISTS = 255; // proof-registry
const ERR_TEXT_EMPTY = 337; // manifesto
const ERR_PROOF_FAILED = 342; // manifesto (maps proof-registry errors)

// Helper to create test hashes
function createTestHash(seed: number): Uint8Array {
  const hash = new Uint8Array(32);
  hash[0] = seed;
  hash[31] = seed;
  return hash;
}

describe(`integration: full workflow verification`, function () {
  it("submit-manifesto creates entries in all three registries", function () {
    // arrange
    const testHash = createTestHash(1);
    const testText = "This is my complete manifesto for the integration test.";

    // act - submit manifesto
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );

    // assert - manifesto created
    expect(receipt.result).toBeOk(Cl.uint(0));

    // assert - check-in registry updated
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

    // assert - proof registry updated
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

    // assert - reverse lookup works
    const lookup = simnet.callReadOnlyFn(
      proofContract,
      "lookup-proof-by-hash",
      [Cl.buffer(testHash)],
      deployer
    ).result;
    expect(lookup.type).toBe(ClarityType.OptionalSome);
    if (lookup.type === ClarityType.OptionalSome && lookup.value.type === ClarityType.Tuple) {
      expect(lookup.value.value.user).toStrictEqual(Cl.principal(deployer));
      expect(lookup.value.value.index).toStrictEqual(Cl.uint(0));
    }

    // assert - manifesto registry updated
    const manifestoCount = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    expect(manifestoCount).toStrictEqual(Cl.uint(1));

    const manifesto = simnet.callReadOnlyFn(
      manifestoContract,
      "get-manifesto",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    expect(manifesto.type).toBe(ClarityType.OptionalSome);
    if (manifesto.type === ClarityType.OptionalSome && manifesto.value.type === ClarityType.Tuple) {
      expect(manifesto.value.value.text).toStrictEqual(Cl.stringUtf8(testText));
      expect(manifesto.value.value.hash).toStrictEqual(Cl.buffer(testHash));
      expect(manifesto.value.value["checkin-index"]).toStrictEqual(Cl.uint(0));
      expect(manifesto.value.value["proof-index"]).toStrictEqual(Cl.uint(0));
    }
  });

  it("cross-contract references are accurate across multiple submissions", function () {
    // arrange & act - submit multiple manifestos
    const hash1 = createTestHash(10);
    const hash2 = createTestHash(11);
    const hash3 = createTestHash(12);

    const receipt1 = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash1), Cl.stringUtf8("First manifesto.")],
      deployer
    );
    expect(receipt1.result).toBeOk(Cl.uint(0));

    const receipt2 = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash2), Cl.stringUtf8("Second manifesto.")],
      deployer
    );
    expect(receipt2.result).toBeOk(Cl.uint(1));

    const receipt3 = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(hash3), Cl.stringUtf8("Third manifesto.")],
      deployer
    );
    expect(receipt3.result).toBeOk(Cl.uint(2));

    // assert - verify each manifesto has correct references
    for (let i = 0; i < 3; i++) {
      const manifesto = simnet.callReadOnlyFn(
        manifestoContract,
        "get-manifesto",
        [Cl.principal(deployer), Cl.uint(i)],
        deployer
      ).result;

      expect(manifesto.type).toBe(ClarityType.OptionalSome);
      if (manifesto.type === ClarityType.OptionalSome && manifesto.value.type === ClarityType.Tuple) {
        // Each manifesto should reference its corresponding check-in and proof index
        expect(manifesto.value.value["checkin-index"]).toStrictEqual(Cl.uint(i));
        expect(manifesto.value.value["proof-index"]).toStrictEqual(Cl.uint(i));
      }
    }

    // Verify all counts match
    const checkinCount = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    expect(checkinCount).toStrictEqual(Cl.uint(3));

    const proofCount = simnet.callReadOnlyFn(
      proofContract,
      "get-user-proof-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    expect(proofCount).toStrictEqual(Cl.uint(3));

    const manifestoCount = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    expect(manifestoCount).toStrictEqual(Cl.uint(3));
  });

  it("atomic failure prevents all registry updates", function () {
    // arrange - first submission succeeds
    const sharedHash = createTestHash(20);
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(sharedHash), Cl.stringUtf8("Original manifesto.")],
      address1
    );

    // Get address2's counts before failed attempt
    const checkinBefore = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    const proofBefore = simnet.callReadOnlyFn(
      proofContract,
      "get-user-proof-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    const manifestoBefore = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(address2)],
      deployer
    ).result;

    // act - try to submit with duplicate hash (should fail atomically)
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(sharedHash), Cl.stringUtf8("Duplicate attempt.")],
      address2
    );

    // assert - operation failed
    // Note: proof-registry's ERR_HASH_ALREADY_EXISTS is mapped to manifesto's ERR_PROOF_FAILED
    expect(receipt.result).toBeErr(Cl.uint(ERR_PROOF_FAILED));

    // assert - NO changes to any registry for address2
    const checkinAfter = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    const proofAfter = simnet.callReadOnlyFn(
      proofContract,
      "get-user-proof-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    const manifestoAfter = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(address2)],
      deployer
    ).result;

    expect(checkinAfter).toStrictEqual(checkinBefore);
    expect(proofAfter).toStrictEqual(proofBefore);
    expect(manifestoAfter).toStrictEqual(manifestoBefore);
  });
});

describe(`integration: multi-user scenarios`, function () {
  it("multiple users can submit manifestos without interference", function () {
    // arrange & act - three users submit manifestos
    const hashes = [createTestHash(30), createTestHash(31), createTestHash(32)];
    const users = [address1, address2, address3];
    const texts = [
      "User 1 manifesto content.",
      "User 2 manifesto content.",
      "User 3 manifesto content.",
    ];

    for (let i = 0; i < 3; i++) {
      const receipt = simnet.callPublicFn(
        manifestoContract,
        "submit-manifesto",
        [Cl.buffer(hashes[i]), Cl.stringUtf8(texts[i])],
        users[i]
      );
      expect(receipt.result).toBeOk(Cl.uint(0)); // Each user's first manifesto
    }

    // assert - each user has exactly one entry in all registries
    for (let i = 0; i < 3; i++) {
      const checkinCount = simnet.callReadOnlyFn(
        checkinContract,
        "get-user-checkin-count",
        [Cl.principal(users[i])],
        deployer
      ).result;
      expect(checkinCount).toStrictEqual(Cl.uint(1));

      const proofCount = simnet.callReadOnlyFn(
        proofContract,
        "get-user-proof-count",
        [Cl.principal(users[i])],
        deployer
      ).result;
      expect(proofCount).toStrictEqual(Cl.uint(1));

      const manifestoCount = simnet.callReadOnlyFn(
        manifestoContract,
        "get-user-manifesto-count",
        [Cl.principal(users[i])],
        deployer
      ).result;
      expect(manifestoCount).toStrictEqual(Cl.uint(1));
    }

    // assert - reverse lookups point to correct users
    for (let i = 0; i < 3; i++) {
      const lookup = simnet.callReadOnlyFn(
        proofContract,
        "lookup-proof-by-hash",
        [Cl.buffer(hashes[i])],
        deployer
      ).result;
      expect(lookup.type).toBe(ClarityType.OptionalSome);
      if (lookup.type === ClarityType.OptionalSome && lookup.value.type === ClarityType.Tuple) {
        expect(lookup.value.value.user).toStrictEqual(Cl.principal(users[i]));
      }
    }
  });

  it("users can have different activity levels", function () {
    // arrange & act
    const user1Hashes = [createTestHash(40), createTestHash(41), createTestHash(42)];
    const user2Hashes = [createTestHash(43)];

    // User 1 submits 3 manifestos
    for (let i = 0; i < 3; i++) {
      const receipt = simnet.callPublicFn(
        manifestoContract,
        "submit-manifesto",
        [Cl.buffer(user1Hashes[i]), Cl.stringUtf8(`User 1 manifesto ${i + 1}`)],
        address1
      );
      expect(receipt.result).toBeOk(Cl.uint(i));
    }

    // User 2 submits 1 manifesto
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(user2Hashes[0]), Cl.stringUtf8("User 2 single manifesto")],
      address2
    );
    expect(receipt.result).toBeOk(Cl.uint(0));

    // assert - counts are correct
    const user1ManifestoCount = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(user1ManifestoCount).toStrictEqual(Cl.uint(3));

    const user2ManifestoCount = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2ManifestoCount).toStrictEqual(Cl.uint(1));

    // assert - last manifestos are correct
    const user1Last = simnet.callReadOnlyFn(
      manifestoContract,
      "get-last-manifesto",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(user1Last.type).toBe(ClarityType.OptionalSome);
    if (user1Last.type === ClarityType.OptionalSome && user1Last.value.type === ClarityType.Tuple) {
      expect(user1Last.value.value.text).toStrictEqual(Cl.stringUtf8("User 1 manifesto 3"));
    }

    const user2Last = simnet.callReadOnlyFn(
      manifestoContract,
      "get-last-manifesto",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2Last.type).toBe(ClarityType.OptionalSome);
    if (user2Last.type === ClarityType.OptionalSome && user2Last.value.type === ClarityType.Tuple) {
      expect(user2Last.value.value.text).toStrictEqual(Cl.stringUtf8("User 2 single manifesto"));
    }
  });
});

describe(`integration: print events verification`, function () {
  it("submit-manifesto emits events from all three contracts", function () {
    // arrange
    const testHash = createTestHash(50);
    const testText = "Manifesto for event verification.";

    // act
    const receipt = simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(testHash), Cl.stringUtf8(testText)],
      deployer
    );

    // assert - verify events from all contracts
    const checkinEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === checkinContract
    );
    expect(checkinEvent).toBeDefined();
    const checkinData = cvToJSON(checkinEvent!.data.value);
    expect(checkinData.value.notification.value).toBe("checkin-registry/check-in");

    const proofEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === proofContract
    );
    expect(proofEvent).toBeDefined();
    const proofData = cvToJSON(proofEvent!.data.value);
    expect(proofData.value.notification.value).toBe("proof-registry/submit-proof");

    const manifestoEvent = receipt.events.find(
      (e: any) =>
        e.event === "print_event" &&
        e.data.contract_identifier === manifestoContract
    );
    expect(manifestoEvent).toBeDefined();
    const manifestoData = cvToJSON(manifestoEvent!.data.value);
    expect(manifestoData.value.notification.value).toBe("manifesto/submit-manifesto");

    // Verify manifesto event contains references to other indices
    expect(manifestoData.value.payload.value["checkin-index"].value).toBe("0");
    expect(manifestoData.value.payload.value["proof-index"].value).toBe("0");
    expect(manifestoData.value.payload.value.text.value).toBe(testText);
  });
});

describe(`integration: independent registry operations`, function () {
  it("direct check-in and proof operations still work independently", function () {
    // Test that direct registry operations still work even after manifesto submissions

    // Submit a manifesto first
    const manifestoHash = createTestHash(60);
    simnet.callPublicFn(
      manifestoContract,
      "submit-manifesto",
      [Cl.buffer(manifestoHash), Cl.stringUtf8("Manifesto text.")],
      address1
    );

    // Direct check-in should still work
    const checkinReceipt = simnet.callPublicFn(
      checkinContract,
      "check-in",
      [],
      address1
    );
    expect(checkinReceipt.result).toBeOk(Cl.uint(1)); // Index 1 (after manifesto's check-in at index 0)

    // Direct proof submission should still work
    const directHash = createTestHash(61);
    const proofReceipt = simnet.callPublicFn(
      proofContract,
      "submit-proof",
      [Cl.buffer(directHash)],
      address1
    );
    expect(proofReceipt.result).toBeOk(Cl.uint(1)); // Index 1 (after manifesto's proof at index 0)

    // Verify counts reflect all operations
    const checkinCount = simnet.callReadOnlyFn(
      checkinContract,
      "get-user-checkin-count",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(checkinCount).toStrictEqual(Cl.uint(2)); // 1 from manifesto + 1 direct

    const proofCount = simnet.callReadOnlyFn(
      proofContract,
      "get-user-proof-count",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(proofCount).toStrictEqual(Cl.uint(2)); // 1 from manifesto + 1 direct

    const manifestoCount = simnet.callReadOnlyFn(
      manifestoContract,
      "get-user-manifesto-count",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(manifestoCount).toStrictEqual(Cl.uint(1)); // Only 1 manifesto
  });
});
