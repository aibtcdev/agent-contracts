import { describe, expect, it } from "vitest";
import { Cl, ClarityType, cvToJSON } from "@stacks/transactions";

// setup accounts
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!;

// contract info
const contractAddress = `${deployer}.proof-registry`;

// Error codes - Fun numbers for AI agents!
const ERR_PROOF_NOT_FOUND = 204; // HTTP No Content - ironic
const ERR_INVALID_USER = 222; // Angel number, triple deuce
const ERR_NO_PROOFS = 247; // 24/7 always on, but nobody's home
const ERR_HASH_NOT_FOUND = 256; // 2^8 byte overflow vibes
const ERR_HASH_ALREADY_EXISTS = 255; // All bits set, maxed out

// Helper to create test hashes
function createTestHash(seed: number): Uint8Array {
  const hash = new Uint8Array(32);
  hash[0] = seed;
  hash[31] = seed;
  return hash;
}

describe(`proof-registry: submit-proof()`, function () {
  it("submit-proof() succeeds and returns index 0 for first proof", function () {
    // arrange
    const testHash = createTestHash(1);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(testHash)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(0));
  });

  it("submit-proof() increments index for subsequent proofs", function () {
    // arrange
    const hash1 = createTestHash(10);
    const hash2 = createTestHash(11);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash1)], deployer);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash2)],
      deployer
    );
    // assert
    expect(receipt.result).toBeOk(Cl.uint(1));
  });

  it("submit-proof() emits correct print event", function () {
    // arrange
    const testHash = createTestHash(20);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(testHash)],
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
      "proof-registry/submit-proof"
    );
    expect(printData.value.payload.value.user.value).toBe(deployer);
    expect(printData.value.payload.value.index.value).toBe("0");
    expect(printData.value.payload.value.hash).toBeDefined();
    expect(printData.value.payload.value["stacks-block-height"]).toBeDefined();
    expect(printData.value.payload.value["burn-block-height"]).toBeDefined();
    expect(printData.value.payload.value["id-header-hash"]).toBeDefined();
    expect(printData.value.payload.value.timestamp).toBeDefined();
  });

  it("submit-proof() fails for duplicate hash (ERR_HASH_ALREADY_EXISTS)", function () {
    // arrange
    const duplicateHash = createTestHash(30);
    simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(duplicateHash)],
      deployer
    );
    // act - try to submit same hash again (even from different user)
    const receipt = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(duplicateHash)],
      address1
    );
    // assert
    expect(receipt.result).toBeErr(Cl.uint(ERR_HASH_ALREADY_EXISTS));
  });

  it("submit-proof() works for multiple users independently", function () {
    // arrange
    const hash1 = createTestHash(40);
    const hash2 = createTestHash(41);
    const hash3 = createTestHash(42);

    // First user submits proof
    const receipt1 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash1)],
      address1
    );
    // Second user submits proof
    const receipt2 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash2)],
      address2
    );
    // First user submits again
    const receipt3 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash3)],
      address1
    );

    // assert
    // First user's first proof should be index 0
    expect(receipt1.result).toBeOk(Cl.uint(0));
    // Second user's first proof should be index 0
    expect(receipt2.result).toBeOk(Cl.uint(0));
    // First user's second proof should be index 1
    expect(receipt3.result).toBeOk(Cl.uint(1));
  });

  it("submit-proof() stores correct block metadata", function () {
    // arrange
    const testHash = createTestHash(50);
    // act
    const receipt = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(testHash)],
      deployer
    );

    // Get the stored proof
    const proof = simnet.callReadOnlyFn(
      contractAddress,
      "get-proof",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;

    // assert
    expect(receipt.result).toBeOk(Cl.uint(0));
    expect(proof.type).toBe(ClarityType.OptionalSome);

    if (proof.type === ClarityType.OptionalSome) {
      const data = proof.value;
      expect(data.type).toBe(ClarityType.Tuple);
      if (data.type === ClarityType.Tuple) {
        const tupleData = data.value;
        // Verify all required fields exist
        expect(tupleData["hash"]).toBeDefined();
        expect(tupleData["stacks-block-height"]).toBeDefined();
        expect(tupleData["burn-block-height"]).toBeDefined();
        expect(tupleData["id-header-hash"]).toBeDefined();
        expect(tupleData["timestamp"]).toBeDefined();
      }
    }
  });
});

describe(`proof-registry: get-proof()`, function () {
  it("get-proof() returns none for non-existent proof", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-proof",
      [Cl.principal(deployer), Cl.uint(999)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-proof() returns data for existing proof", function () {
    // arrange
    const testHash = createTestHash(60);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(testHash)], deployer);
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-proof",
      [Cl.principal(deployer), Cl.uint(0)],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.OptionalSome);
  });
});

describe(`proof-registry: get-user-proof-count()`, function () {
  it("get-user-proof-count() returns 0 for user with no proofs", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-proof-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(0));
  });

  it("get-user-proof-count() returns correct count after proofs", function () {
    // arrange
    const hash1 = createTestHash(70);
    const hash2 = createTestHash(71);
    const hash3 = createTestHash(72);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash1)], deployer);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash2)], deployer);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash3)], deployer);
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-proof-count",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toStrictEqual(Cl.uint(3));
  });
});

describe(`proof-registry: get-last-proof()`, function () {
  it("get-last-proof() returns none for user with no proofs", function () {
    // arrange
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-proof",
      [Cl.principal(deployer)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("get-last-proof() returns the most recent proof", function () {
    // arrange
    const hash1 = createTestHash(80);
    const hash2 = createTestHash(81);
    const hash3 = createTestHash(82);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash1)], deployer);
    simnet.mineEmptyBlocks(5);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash2)], deployer);
    simnet.mineEmptyBlocks(3);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash3)], deployer);

    // act
    const lastProof = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-proof",
      [Cl.principal(deployer)],
      deployer
    ).result;

    // Get the specific proof at index 2 for comparison
    const proofAtIndex2 = simnet.callReadOnlyFn(
      contractAddress,
      "get-proof",
      [Cl.principal(deployer), Cl.uint(2)],
      deployer
    ).result;

    // assert
    expect(lastProof.type).toBe(ClarityType.OptionalSome);
    expect(proofAtIndex2.type).toBe(ClarityType.OptionalSome);

    // The last proof should match the one at index 2
    if (
      lastProof.type === ClarityType.OptionalSome &&
      proofAtIndex2.type === ClarityType.OptionalSome
    ) {
      expect(lastProof.value).toStrictEqual(proofAtIndex2.value);
    }
  });
});

describe(`proof-registry: lookup-proof-by-hash()`, function () {
  it("lookup-proof-by-hash() returns none for non-existent hash", function () {
    // arrange
    const unknownHash = createTestHash(90);
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(unknownHash)],
      deployer
    ).result;
    // assert
    expect(result).toBeNone();
  });

  it("lookup-proof-by-hash() returns submitter info for existing hash", function () {
    // arrange
    const testHash = createTestHash(100);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(testHash)], address1);
    // act
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(testHash)],
      deployer
    ).result;
    // assert
    expect(result.type).toBe(ClarityType.OptionalSome);
    if (result.type === ClarityType.OptionalSome) {
      const lookupData = result.value;
      expect(lookupData.type).toBe(ClarityType.Tuple);
      if (lookupData.type === ClarityType.Tuple) {
        expect(lookupData.value.user).toStrictEqual(Cl.principal(address1));
        expect(lookupData.value.index).toStrictEqual(Cl.uint(0));
      }
    }
  });

  it("lookup-proof-by-hash() returns correct index for multiple proofs", function () {
    // arrange
    const hash1 = createTestHash(110);
    const hash2 = createTestHash(111);
    const hash3 = createTestHash(112);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash1)], address1);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash2)], address1);
    simnet.callPublicFn(contractAddress, "submit-proof", [Cl.buffer(hash3)], address1);

    // act - lookup the second hash
    const result = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(hash2)],
      deployer
    ).result;

    // assert
    expect(result.type).toBe(ClarityType.OptionalSome);
    if (result.type === ClarityType.OptionalSome) {
      const lookupData = result.value;
      if (lookupData.type === ClarityType.Tuple) {
        expect(lookupData.value.user).toStrictEqual(Cl.principal(address1));
        expect(lookupData.value.index).toStrictEqual(Cl.uint(1));
      }
    }
  });
});

describe(`proof-registry: get-contract-info()`, function () {
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

describe(`proof-registry: integration scenarios`, function () {
  it("complete workflow: multiple users submitting proofs over time", function () {
    // User 1 submits proof
    const hash1 = createTestHash(200);
    const user1Proof1 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash1)],
      address1
    );
    expect(user1Proof1.result).toBeOk(Cl.uint(0));

    // User 2 submits proof
    const hash2 = createTestHash(201);
    const user2Proof1 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash2)],
      address2
    );
    expect(user2Proof1.result).toBeOk(Cl.uint(0));

    // Mine some blocks
    simnet.mineEmptyBlocks(10);

    // User 1 submits again
    const hash3 = createTestHash(202);
    const user1Proof2 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(hash3)],
      address1
    );
    expect(user1Proof2.result).toBeOk(Cl.uint(1));

    // Verify counts
    const user1Count = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-proof-count",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(user1Count).toStrictEqual(Cl.uint(2));

    const user2Count = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-proof-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2Count).toStrictEqual(Cl.uint(1));

    // Verify reverse lookup for all hashes
    const lookup1 = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(hash1)],
      deployer
    ).result;
    expect(lookup1.type).toBe(ClarityType.OptionalSome);

    const lookup2 = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(hash2)],
      deployer
    ).result;
    expect(lookup2.type).toBe(ClarityType.OptionalSome);

    const lookup3 = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(hash3)],
      deployer
    ).result;
    expect(lookup3.type).toBe(ClarityType.OptionalSome);

    // Verify last proof for each user
    const user1Last = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-proof",
      [Cl.principal(address1)],
      deployer
    ).result;
    expect(user1Last.type).toBe(ClarityType.OptionalSome);

    const user2Last = simnet.callReadOnlyFn(
      contractAddress,
      "get-last-proof",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2Last.type).toBe(ClarityType.OptionalSome);
  });

  it("hash uniqueness is enforced globally across users", function () {
    // User 1 submits a hash
    const sharedHash = createTestHash(250);
    const receipt1 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(sharedHash)],
      address1
    );
    expect(receipt1.result).toBeOk(Cl.uint(0));

    // User 2 tries to submit the same hash - should fail
    const receipt2 = simnet.callPublicFn(
      contractAddress,
      "submit-proof",
      [Cl.buffer(sharedHash)],
      address2
    );
    expect(receipt2.result).toBeErr(Cl.uint(ERR_HASH_ALREADY_EXISTS));

    // Verify user 2 count is still 0
    const user2Count = simnet.callReadOnlyFn(
      contractAddress,
      "get-user-proof-count",
      [Cl.principal(address2)],
      deployer
    ).result;
    expect(user2Count).toStrictEqual(Cl.uint(0));

    // Verify lookup still points to user 1
    const lookup = simnet.callReadOnlyFn(
      contractAddress,
      "lookup-proof-by-hash",
      [Cl.buffer(sharedHash)],
      deployer
    ).result;
    if (lookup.type === ClarityType.OptionalSome && lookup.value.type === ClarityType.Tuple) {
      expect(lookup.value.value.user).toStrictEqual(Cl.principal(address1));
    }
  });
});
