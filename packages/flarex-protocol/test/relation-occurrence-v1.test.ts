import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  canonicalizeRelationOccurrenceV1,
  compareRelationOccurrenceEvidenceV1,
  decodeRelationOccurrenceV1Result,
  MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1,
  RelationOccurrenceComparisonV1Error,
  RelationOccurrenceSha256,
  RelationOccurrenceSha256Error,
  RelationOccurrenceV1Error,
  RELATION_OCCURRENCE_SHA256_BYTES_V1,
  type CanonicalRelationOccurrenceV1,
  type RelationOccurrenceSha256Api,
} from "../src/relation-occurrence-v1";

const SOURCE_DOCUMENT_ID =
  "1:00112233-4455-6677-8899-aabbccddeeff";
const TARGET_DOCUMENT_ID =
  "2:11112233-4455-6677-8899-aabbccddeeff";
const OTHER_TARGET_DOCUMENT_ID =
  "2:22222233-4455-6677-8899-aabbccddeeff";

describe("relation occurrence V1", () => {
  it("canonicalizes exact occurrence evidence with owned bytes and digest", async () => {
    const input = occurrence();
    const canonical = await runCanonical(input, webCryptoSha256);

    input.sourcePath[0]!.name = "changed";
    const firstBytes = canonical.canonicalBytes;
    const firstDigest = canonical.sha256;
    firstBytes.fill(0);
    firstDigest.fill(0);

    expect(canonical.occurrence.sourcePath).toEqual([
      { kind: "field", name: "author" },
    ]);
    expect(canonical.canonicalText).toBe(
      '{"duplicateOrdinal":0,"format":"flarex.relation-occurrence","sourceDocumentId":"1:00112233-4455-6677-8899-aabbccddeeff","sourcePath":[{"kind":"field","name":"author"}],"targetDocumentId":"2:11112233-4455-6677-8899-aabbccddeeff","version":1}',
    );
    expect(canonical.canonicalBytes.byteLength).toBeLessThanOrEqual(
      MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1,
    );
    expect(canonical.sha256).toHaveLength(RELATION_OCCURRENCE_SHA256_BYTES_V1);
    expect(new TextDecoder().decode(canonical.canonicalBytes)).toBe(
      canonical.canonicalText,
    );
    expect(canonical.sha256).not.toEqual(new Uint8Array(32));
    expect(Object.isFrozen(canonical.occurrence)).toBe(true);
    expect(Object.isFrozen(canonical.occurrence.sourcePath)).toBe(true);
  });

  it("strictly rejects position and every excess or future occurrence field", () => {
    for (const candidate of [
      { ...occurrence(), position: 0 },
      { ...occurrence(), locale: null },
      { ...occurrence(), relationId: 1 },
      {
        ...occurrence(),
        sourcePath: [{ kind: "field", name: "author", arrayItemId: "item" }],
      },
      { ...occurrence(), duplicateOrdinal: 1 },
      { ...occurrence(), version: 2 },
    ]) {
      const decoded = decodeRelationOccurrenceV1Result(candidate);
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) {
        expect(decoded.failure).toBeInstanceOf(RelationOccurrenceV1Error);
        expect([
          "invalidOccurrence",
          "invalidOwnData",
        ]).toContain(decoded.failure.issue.reason);
      }
    }
  });

  it("keeps hostile own-data inspection in the typed failure channel", async () => {
    const pathWithExtra = occurrence();
    Object.assign(pathWithExtra.sourcePath, { future: true });
    const accessor = occurrence();
    let getterCalls = 0;
    Object.defineProperty(accessor, "targetDocumentId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return TARGET_DOCUMENT_ID;
      },
    });
    const reflectionFailure = new Error("ownKeys denied");
    const trapped = new Proxy(occurrence(), {
      ownKeys() {
        throw reflectionFailure;
      },
    });
    const cyclic = occurrence();
    expect(Reflect.set(cyclic, "sourcePath", [cyclic])).toBe(true);

    for (const candidate of [pathWithExtra, accessor, trapped, cyclic]) {
      const result = await runResult(
        canonicalizeRelationOccurrenceV1(candidate),
        webCryptoSha256,
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "RelationOccurrenceV1Error",
          issue: { reason: "invalidOwnData" },
        },
      });
    }
    expect(getterCalls).toBe(0);
    expect(decodeRelationOccurrenceV1Result(trapped)).toMatchObject({
      _tag: "Failure",
      failure: { issue: { cause: reflectionFailure } },
    });
  });

  it("defensively isolates canonical bytes from the SHA-256 capability", async () => {
    const mutatingSha256 = RelationOccurrenceSha256.of({
      digest: (bytes) => Effect.sync(() => {
        bytes.fill(0);
        return new Uint8Array(RELATION_OCCURRENCE_SHA256_BYTES_V1).fill(7);
      }),
    });
    const canonical = await runCanonical(occurrence(), mutatingSha256);

    expect(new TextDecoder().decode(canonical.canonicalBytes)).toBe(
      canonical.canonicalText,
    );
    expect(canonical.sha256).toEqual(new Uint8Array(32).fill(7));
  });

  it("rejects a SHA-256 result with any non-exact byte length", async () => {
    for (const length of [0, 31, 33]) {
      const invalidSha256 = RelationOccurrenceSha256.of({
        digest: () => Effect.succeed(new Uint8Array(length)),
      });
      const result = await runResult(
        canonicalizeRelationOccurrenceV1(occurrence()),
        invalidSha256,
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(RelationOccurrenceV1Error);
        if (result.failure instanceof RelationOccurrenceV1Error) {
          expect(result.failure.issue).toEqual({
            reason: "invalidSha256Length",
            observedBytes: length,
            expectedBytes: RELATION_OCCURRENCE_SHA256_BYTES_V1,
          });
        }
      }
    }
  });

  it("propagates the SHA-256 capability's typed source failure", async () => {
    const hashFailure = new RelationOccurrenceSha256Error({
      operation: "digest",
      cause: new Error("unavailable"),
    });
    const failingSha256 = RelationOccurrenceSha256.of({
      digest: () => Effect.fail(hashFailure),
    });
    const result = await runResult(
      canonicalizeRelationOccurrenceV1(occurrence()),
      failingSha256,
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(hashFailure);
  });

  it("fails closed when equal digests retain unequal canonical evidence", async () => {
    const forcedDigestSha256 = RelationOccurrenceSha256.of({
      digest: () => Effect.succeed(new Uint8Array(32).fill(0xa5)),
    });
    const left = await runCanonical(occurrence(), forcedDigestSha256);
    const right = await runCanonical(
      occurrence({ targetDocumentId: OTHER_TARGET_DOCUMENT_ID }),
      forcedDigestSha256,
    );
    const comparison = compareRelationOccurrenceEvidenceV1(left, right);

    expect(Result.isFailure(comparison)).toBe(true);
    if (Result.isFailure(comparison)) {
      expect(comparison.failure).toBeInstanceOf(
        RelationOccurrenceComparisonV1Error,
      );
      expect(comparison.failure.issue).toEqual({
        reason: "sha256Collision",
        leftCanonicalText: left.canonicalText,
        rightCanonicalText: right.canonicalText,
      });
    }
  });

  it("fails closed when equal canonical evidence retains unequal digests", async () => {
    const left = await runCanonical(
      occurrence(),
      RelationOccurrenceSha256.of({
        digest: () => Effect.succeed(new Uint8Array(32).fill(0x11)),
      }),
    );
    const right = await runCanonical(
      occurrence(),
      RelationOccurrenceSha256.of({
        digest: () => Effect.succeed(new Uint8Array(32).fill(0x22)),
      }),
    );
    const comparison = compareRelationOccurrenceEvidenceV1(left, right);

    expect(comparison).toMatchObject({
      _tag: "Failure",
      failure: {
        issue: {
          reason: "inconsistentDigest",
          canonicalText: left.canonicalText,
        },
      },
    });
  });

  it("distinguishes unequal evidence and accepts byte-identical evidence", async () => {
    const left = await runCanonical(occurrence(), webCryptoSha256);
    const equal = await runCanonical(occurrence(), webCryptoSha256);
    const distinct = await runCanonical(
      occurrence({ targetDocumentId: OTHER_TARGET_DOCUMENT_ID }),
      webCryptoSha256,
    );

    expect(success(compareRelationOccurrenceEvidenceV1(left, equal))).toEqual({
      kind: "equal",
    });
    expect(success(compareRelationOccurrenceEvidenceV1(left, distinct)))
      .toEqual({ kind: "distinct" });
  });
});

const webCryptoSha256 = RelationOccurrenceSha256.of({
  digest: (bytes) => Effect.tryPromise({
    try: async () => {
      const input = new Uint8Array(bytes.byteLength);
      input.set(bytes);
      return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
    },
    catch: (cause) => new RelationOccurrenceSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});

interface OccurrenceOverrides {
  readonly targetDocumentId?: string;
}

function occurrence(overrides: OccurrenceOverrides = {}) {
  return {
    format: "flarex.relation-occurrence" as const,
    version: 1 as const,
    sourceDocumentId: SOURCE_DOCUMENT_ID,
    sourcePath: [{ kind: "field" as const, name: "author" }],
    targetDocumentId: overrides.targetDocumentId ?? TARGET_DOCUMENT_ID,
    duplicateOrdinal: 0 as const,
  };
}

function runCanonical(
  input: unknown,
  sha256: RelationOccurrenceSha256Api,
): Promise<CanonicalRelationOccurrenceV1> {
  return Effect.runPromise(
    canonicalizeRelationOccurrenceV1(input).pipe(
      Effect.provideService(RelationOccurrenceSha256, sha256),
    ),
  );
}

function runResult<A, E>(
  effect: Effect.Effect<A, E, RelationOccurrenceSha256>,
  sha256: RelationOccurrenceSha256Api,
): Promise<Result.Result<A, E>> {
  return Effect.runPromise(
    effect.pipe(
      Effect.result,
      Effect.provideService(RelationOccurrenceSha256, sha256),
    ),
  );
}

function success<A, E>(result: Result.Result<A, E>): A {
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
