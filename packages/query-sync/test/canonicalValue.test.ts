import { Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  captureCanonicalQueryIdentity,
  captureCanonicalQueryKey,
  captureNamespaceCursor,
  captureQueryEvaluationEvidence,
  captureQuerySyncWorkRevision,
  capturePublicationAttemptInstant,
  capturePublicationAttemptOrdinal,
  captureSyncNamespaceId,
  captureSyncSequence,
  initialPublicationAttemptOrdinal,
  initialQuerySyncWorkRevision,
  MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
  MAX_CANONICAL_QUERY_IDENTITY_BYTES,
  MAX_INVALIDATION_BATCH_BYTES,
  MAX_INVALIDATION_KEYS,
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
  MAX_PUBLICATION_ATTEMPT_INSTANT,
  MAX_PUBLICATION_ATTEMPT_ORDINAL,
  MAX_QUERY_SYNC_WORK_REVISION,
  MAX_SYNC_ID_UTF8_BYTES,
  MAX_SYNC_SEQUENCE,
  QueryDependencyLimitError,
  QuerySyncCanonicalValueError,
  QuerySyncWorkRevisionExhaustedError,
  successorPublicationAttemptOrdinal,
  successorQuerySyncWorkRevision,
} from "@flarex/query-sync/internal/kernel";

import {
  canonicalBytes,
  canonicalKey,
  canonicalText,
  descriptor,
  getSuccess,
} from "./fixtures.js";

describe("canonical query-sync values", () => {
  it("captures bounded well-formed namespace text at its UTF-8 boundary", () => {
    const boundary = "é".repeat(MAX_SYNC_ID_UTF8_BYTES / 2);
    const captured = captureSyncNamespaceId(boundary);

    expect(getSuccess(captured)).toBe(boundary);
    expect(Result.isFailure(captureSyncNamespaceId(""))).toBe(true);
    expect(Result.isFailure(captureSyncNamespaceId("bad\0id"))).toBe(true);
    expect(Result.isFailure(captureSyncNamespaceId("\ud800"))).toBe(true);

    const oversized = captureSyncNamespaceId(`${boundary}a`);
    expect(Result.isFailure(oversized)).toBe(true);
    if (Result.isFailure(oversized)) {
      expect(oversized.failure).toMatchObject({
        _tag: "QuerySyncCanonicalValueError",
        field: "namespaceId",
        reason: "tooLarge",
        maximum: MAX_SYNC_ID_UTF8_BYTES,
        observed: MAX_SYNC_ID_UTF8_BYTES + 1,
      });
    }
  });

  it("accepts only canonical unpadded base64url and exact fixed widths", () => {
    const exactKey = canonicalBytes(32, 7);
    expect(getSuccess(captureCanonicalQueryKey(exactKey))).toBe(exactKey);
    expect(getSuccess(captureCanonicalQueryIdentity(""))).toBe("");
    expect(getSuccess(captureCanonicalDependencyKey(""))).toBe("");

    const wrongWidth = captureCanonicalQueryKey(canonicalBytes(31));
    expect(Result.isFailure(wrongWidth)).toBe(true);
    if (Result.isFailure(wrongWidth)) {
      expect(wrongWidth.failure).toMatchObject({
        _tag: "QuerySyncCanonicalValueError",
        reason: "wrongByteLength",
        maximum: 32,
        observed: 31,
      });
    }

    expect(Result.isFailure(captureCanonicalQueryIdentity("AA=="))).toBe(true);
    const nonCanonical = captureCanonicalQueryIdentity("AB");
    expect(Result.isFailure(nonCanonical)).toBe(true);
    if (Result.isFailure(nonCanonical)) {
      expect(nonCanonical.failure).toMatchObject({ reason: "nonCanonical" });
    }
  });

  it("refuses oversized canonical input before decoding it", () => {
    const atLimit = canonicalBytes(MAX_CANONICAL_QUERY_IDENTITY_BYTES, 3);
    expect(getSuccess(captureCanonicalQueryIdentity(atLimit))).toBe(atLimit);

    const oversized = "A".repeat(atLimit.length + 1);
    const result = captureCanonicalQueryIdentity(oversized);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(QuerySyncCanonicalValueError);
      expect(result.failure).toMatchObject({
        field: "queryIdentity",
        reason: "tooLarge",
        maximum: MAX_CANONICAL_QUERY_IDENTITY_BYTES,
      });
    }
  });

  it("captures the complete signed-64-bit sequence domain", () => {
    expect(getSuccess(captureSyncSequence(0n))).toBe(0n);
    expect(getSuccess(captureSyncSequence(MAX_SYNC_SEQUENCE))).toBe(
      MAX_SYNC_SEQUENCE,
    );
    expect(Result.isFailure(captureSyncSequence(-1n))).toBe(true);
    expect(Result.isFailure(
      captureSyncSequence(MAX_SYNC_SEQUENCE + 1n),
    )).toBe(true);
    expect(Result.isFailure(captureSyncSequence(1))).toBe(true);
  });

  it("captures and advances the bounded work revision without wrapping", () => {
    const initial = initialQuerySyncWorkRevision();
    expect(initial).toBe(0n);
    expect(getSuccess(captureQuerySyncWorkRevision(0n))).toBe(0n);
    expect(getSuccess(
      captureQuerySyncWorkRevision(MAX_QUERY_SYNC_WORK_REVISION),
    )).toBe(MAX_QUERY_SYNC_WORK_REVISION);

    for (const input of [
      -1n,
      MAX_QUERY_SYNC_WORK_REVISION + 1n,
      0,
      "0",
      null,
    ]) {
      const refused = captureQuerySyncWorkRevision(input);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) {
        expect(refused.failure).toMatchObject({
          _tag: "QuerySyncCanonicalValueError",
          field: "workRevision",
        });
      }
    }

    expect(getSuccess(successorQuerySyncWorkRevision(
      "claimEvaluationWork",
      initial,
    ))).toBe(1n);

    const exhausted = successorQuerySyncWorkRevision(
      "recordEvaluationAttemptOutcome",
      getSuccess(captureQuerySyncWorkRevision(
        MAX_QUERY_SYNC_WORK_REVISION,
      )),
    );
    expect(Result.isFailure(exhausted)).toBe(true);
    if (Result.isFailure(exhausted)) {
      expect(exhausted.failure).toBeInstanceOf(
        QuerySyncWorkRevisionExhaustedError,
      );
      expect(exhausted.failure).toMatchObject({
        operation: "recordEvaluationAttemptOutcome",
        currentRevision: MAX_QUERY_SYNC_WORK_REVISION,
      });
    }
  });

  it("captures the inclusive publication attempt ordinal domain", () => {
    const first = initialPublicationAttemptOrdinal();
    const last = getSuccess(capturePublicationAttemptOrdinal(
      MAX_PUBLICATION_ATTEMPT_ORDINAL,
    ));
    expect(first).toBe(1);
    expect(getSuccess(capturePublicationAttemptOrdinal(1))).toBe(1);
    expect(last).toBe(MAX_PUBLICATION_ATTEMPT_ORDINAL);
    expect(successorPublicationAttemptOrdinal(first)).toBe(2);
    expect(successorPublicationAttemptOrdinal(last)).toBeNull();

    for (const input of [
      0,
      MAX_PUBLICATION_ATTEMPT_ORDINAL + 1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      1n,
      "1",
    ]) {
      const refused = capturePublicationAttemptOrdinal(input);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) {
        expect(refused.failure).toMatchObject({
          _tag: "QuerySyncCanonicalValueError",
          field: "publicationAttemptOrdinal",
        });
      }
    }
  });

  it("captures non-negative safe publication attempt instants", () => {
    expect(getSuccess(capturePublicationAttemptInstant(0))).toBe(0);
    expect(getSuccess(capturePublicationAttemptInstant(-0))).toBe(-0);
    expect(getSuccess(capturePublicationAttemptInstant(
      MAX_PUBLICATION_ATTEMPT_INSTANT,
    ))).toBe(MAX_PUBLICATION_ATTEMPT_INSTANT);

    for (const input of [
      -1,
      MAX_PUBLICATION_ATTEMPT_INSTANT + 1,
      0.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      0n,
      "0",
    ]) {
      const refused = capturePublicationAttemptInstant(input);
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) {
        expect(refused.failure).toMatchObject({
          _tag: "QuerySyncCanonicalValueError",
          field: "publicationAttemptInstant",
        });
      }
    }
  });

  it("sorts, deduplicates, owns, and freezes dependency inputs", () => {
    const first = canonicalText("a");
    const second = canonicalText("b");
    const callerDependencies = [second, first, second];
    const evidence = getSuccess(captureQueryEvaluationEvidence({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      descriptor: descriptor(),
      generation: 1n,
      snapshotSequence: 0n,
      resultDigest: canonicalKey(50),
      authorityWitness: canonicalKey(60),
      dependencyKeys: callerDependencies,
    }));

    callerDependencies[0] = canonicalText("mutated");
    callerDependencies.push(canonicalText("later"));

    expect(evidence.dependencyKeys).toEqual([first, second]);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.descriptor)).toBe(true);
    expect(Object.isFrozen(evidence.dependencyKeys)).toBe(true);
  });

  it("refuses raw duplicate floods before normalization", () => {
    const duplicate = canonicalText("same");
    const tooMany = Array.from(
      { length: MAX_QUERY_DEPENDENCY_KEYS + 1 },
      () => duplicate,
    );
    const result = captureQueryEvaluationEvidence({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      descriptor: descriptor(),
      generation: 1n,
      snapshotSequence: 0n,
      resultDigest: canonicalKey(50),
      authorityWitness: canonicalKey(60),
      dependencyKeys: tooMany,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(QueryDependencyLimitError);
      expect(result.failure).toMatchObject({
        dimension: "rawEntries",
        maximum: MAX_QUERY_DEPENDENCY_KEYS,
        observed: MAX_QUERY_DEPENDENCY_KEYS + 1,
      });
    }

    const batchResult = captureAdmittedInvalidationBatch({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      sourceSequence: 1n,
      dependencyKeys: Array.from(
        { length: MAX_INVALIDATION_KEYS + 1 },
        () => duplicate,
      ),
    });
    expect(Result.isFailure(batchResult)).toBe(true);
  });

  it("decodes each admitted duplicate spelling only once", () => {
    const repeated = canonicalBytes(
      MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
      700,
    );
    const captured = getSuccess(captureAdmittedInvalidationBatch({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      sourceSequence: 1n,
      dependencyKeys: Array.from(
        { length: MAX_INVALIDATION_KEYS },
        () => repeated,
      ),
    }));

    expect(captured.dependencyKeys).toEqual([repeated]);
  });

  it("uses the fixed array extent instead of a caller-owned iterator", () => {
    const onlyDependency = canonicalText("only");
    const dependencyKeys = [onlyDependency];
    Object.defineProperty(dependencyKeys, Symbol.iterator, {
      value() {
        throw new Error("Dependency normalization invoked caller iteration");
      },
    });

    const captured = getSuccess(captureAdmittedInvalidationBatch({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      sourceSequence: 1n,
      dependencyKeys,
    }));
    expect(captured.dependencyKeys).toEqual([onlyDependency]);
  });

  it("enforces the decoded per-query dependency byte ceiling", () => {
    const boundaryKeys = Array.from(
      {
        length: MAX_QUERY_DEPENDENCY_BYTES
          / MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
      },
      (_, index) => canonicalBytes(
        MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
        index,
      ),
    );
    const atBoundary = captureQueryEvaluationEvidence({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      descriptor: descriptor(),
      generation: 1n,
      snapshotSequence: 0n,
      resultDigest: canonicalKey(50),
      authorityWitness: canonicalKey(60),
      dependencyKeys: boundaryKeys,
    });
    expect(getSuccess(atBoundary).dependencyKeys).toHaveLength(
      boundaryKeys.length,
    );

    const overBoundary = captureQueryEvaluationEvidence({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      descriptor: descriptor({ keySeed: 2 }),
      generation: 1n,
      snapshotSequence: 0n,
      resultDigest: canonicalKey(51),
      authorityWitness: canonicalKey(61),
      dependencyKeys: [...boundaryKeys, Encoding.encodeBase64Url("extra")],
    });
    expect(Result.isFailure(overBoundary)).toBe(true);
    if (Result.isFailure(overBoundary)) {
      expect(overBoundary.failure).toMatchObject({
        _tag: "QueryDependencyLimitError",
        dimension: "decodedBytes",
        maximum: MAX_QUERY_DEPENDENCY_BYTES,
      });
    }

    let laterEntryRead = false;
    const shortCircuitKeys = [
      ...boundaryKeys,
      canonicalBytes(1, 100_000),
    ];
    Object.defineProperty(shortCircuitKeys, shortCircuitKeys.length, {
      enumerable: true,
      get() {
        laterEntryRead = true;
        throw new Error("Dependency normalization read after byte refusal");
      },
    });
    const shortCircuited = captureQueryEvaluationEvidence({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      descriptor: descriptor({ keySeed: 3 }),
      generation: 1n,
      snapshotSequence: 0n,
      resultDigest: canonicalKey(52),
      authorityWitness: canonicalKey(62),
      dependencyKeys: shortCircuitKeys,
    });
    expect(Result.isFailure(shortCircuited)).toBe(true);
    if (Result.isFailure(shortCircuited)) {
      expect(shortCircuited.failure).toMatchObject({
        _tag: "QueryDependencyLimitError",
        dimension: "decodedBytes",
        maximum: MAX_QUERY_DEPENDENCY_BYTES,
      });
    }
    expect(laterEntryRead).toBe(false);
  }, 30_000);

  it("enforces the decoded invalidation-batch byte ceiling", () => {
    const boundaryKeys = Array.from(
      {
        length: MAX_INVALIDATION_BATCH_BYTES
          / MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
      },
      (_, index) => canonicalBytes(
        MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
        index,
      ),
    );
    const accepted = captureAdmittedInvalidationBatch({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      sourceSequence: 1n,
      dependencyKeys: boundaryKeys,
    });
    expect(getSuccess(accepted).dependencyKeys).toHaveLength(
      boundaryKeys.length,
    );

    const refused = captureAdmittedInvalidationBatch({
      namespaceId: "tenant-a",
      syncModelId: "key-value",
      sourceEpoch: "epoch-a",
      sourceSequence: 1n,
      dependencyKeys: [...boundaryKeys, canonicalBytes(1, 100_000)],
    });
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure).toMatchObject({
        _tag: "QueryDependencyLimitError",
        operation: "captureInvalidationBatch",
        dimension: "decodedBytes",
        maximum: MAX_INVALIDATION_BATCH_BYTES,
      });
    }
  }, 30_000);

  it("captures and freezes the aggregate cursor", () => {
    const captured = getSuccess(captureNamespaceCursor({
      namespaceId: "tenant-a",
      syncModelId: "graph",
      sourceEpoch: "epoch-a",
      appliedThroughSequence: 8n,
    }));
    expect(captured).toEqual({
      namespaceId: "tenant-a",
      syncModelId: "graph",
      sourceEpoch: "epoch-a",
      appliedThroughSequence: 8n,
    });
    expect(Object.isFrozen(captured)).toBe(true);
  });
});
