import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1,
  MAX_QUERY_SYNC_SOURCE_CANONICAL_DEPENDENCY_BYTES_V1,
  MAX_QUERY_SYNC_SOURCE_DEPENDENCY_EXAMINATIONS_V1,
  MAX_QUERY_SYNC_SOURCE_ELAPSED_MILLISECONDS_V1,
  MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
  MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1,
  MAX_QUERY_SYNC_SOURCE_SEMANTIC_BYTES_V1,
  MAX_QUERY_SYNC_SOURCE_SEMANTIC_WORK_UNITS_V1,
  decodeQuerySyncSourceReadFailureHeaderV1,
  decodeQuerySyncSourceReadRequestV1,
  decodeQuerySyncSourceReadResponseV1,
  decodeQuerySyncSourceRequiredAtLeastHeaderV1,
  encodeQuerySyncSourceReadFailureHeaderV1,
  encodeQuerySyncSourceReadRequestV1,
  encodeQuerySyncSourceReadResponseV1,
  encodeQuerySyncSourceRequiredAtLeastHeaderV1,
} from "../src/querySyncSourceReadV1";

const SCOPE = "91000000-0000-0000-0000-000000000001";
const EPOCH = "92000000-0000-0000-0000-000000000001";
const MODEL = "flarexdb.application-query.v1";

const request = Object.freeze({
  codecVersion: 1,
  scopeUuid: SCOPE,
  syncModelId: MODEL,
  requestedSourceEpoch: EPOCH,
  requestedAfterCommitSeqExclusive: 0n,
  budget: Object.freeze({
    maximumCommittedBatches: MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1,
    maximumResponseBytes: 4_096,
    maximumModelSemanticWorkUnits: 1_000,
    maximumModelSemanticBytes: 4_096,
    maximumDependencyKeyExaminations: 1_000,
    maximumCanonicalDependencyBytes: 4_096,
    maximumElapsedMilliseconds: 1_000,
  }),
});

const page = Object.freeze({
  codecVersion: 1,
  kind: "page",
  scopeUuid: SCOPE,
  syncModelId: MODEL,
  requestedSourceEpoch: EPOCH,
  requestedAfterCommitSeqExclusive: 0n,
  currentSourceEpoch: EPOCH,
  observedLatestCommitSeq: 1n,
  replayableAfterCommitSeqExclusive: 0n,
  retainedFromCommitSeqInclusive: 1n,
  commits: Object.freeze([Object.freeze({
    scopeUuid: SCOPE,
    epochUuid: EPOCH,
    commitSeq: 1n,
    committedAtMilliseconds: 1_788_134_400_000,
    appRowChanges: Object.freeze([]),
    relationAdjacencyChanges: Object.freeze([]),
  })]),
  readThroughCommitSeq: 1n,
  hasMore: true,
  authorityObservation: null,
});

describe("query-sync source read V1 codec", () => {
  it("round-trips strict canonical requests and pages", () => {
    const encodedRequest = unwrap(encodeQuerySyncSourceReadRequestV1(request));
    const decodedRequest = unwrap(
      decodeQuerySyncSourceReadRequestV1(encodedRequest.bytes),
    );
    expect(decodedRequest.value).toEqual(encodedRequest.value);
    expect(decodedRequest.bytes).not.toBe(encodedRequest.bytes);

    const encodedPage = unwrap(encodeQuerySyncSourceReadResponseV1(page, 4_096));
    expect(unwrap(
      decodeQuerySyncSourceReadResponseV1(encodedPage.bytes, 4_096),
    ).value).toEqual(encodedPage.value);
  });

  it("rejects extra fields, noncanonical bytes, and every over-limit budget", () => {
    expect(Result.isFailure(encodeQuerySyncSourceReadRequestV1({
      ...request,
      extra: true,
    }))).toBe(true);
    const canonical = unwrap(encodeQuerySyncSourceReadRequestV1(request));
    const text = new TextDecoder().decode(canonical.bytes);
    expect(Result.isFailure(decodeQuerySyncSourceReadRequestV1(
      new TextEncoder().encode(text.replace("{", "{ ")),
    ))).toBe(true);
    const overLimits = {
      maximumCommittedBatches:
        MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1 + 1,
      maximumResponseBytes: MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1 + 1,
      maximumModelSemanticWorkUnits:
        MAX_QUERY_SYNC_SOURCE_SEMANTIC_WORK_UNITS_V1 + 1,
      maximumModelSemanticBytes:
        MAX_QUERY_SYNC_SOURCE_SEMANTIC_BYTES_V1 + 1,
      maximumDependencyKeyExaminations:
        MAX_QUERY_SYNC_SOURCE_DEPENDENCY_EXAMINATIONS_V1 + 1,
      maximumCanonicalDependencyBytes:
        MAX_QUERY_SYNC_SOURCE_CANONICAL_DEPENDENCY_BYTES_V1 + 1,
      maximumElapsedMilliseconds:
        MAX_QUERY_SYNC_SOURCE_ELAPSED_MILLISECONDS_V1 + 1,
    } as const;
    for (const [field, value] of Object.entries(overLimits)) {
      expect(Result.isFailure(encodeQuerySyncSourceReadRequestV1({
        ...request,
        budget: { ...request.budget, [field]: value },
      })), field).toBe(true);
    }
  });

  it("enforces exact inclusive response-byte boundaries", () => {
    const encoded = unwrap(encodeQuerySyncSourceReadResponseV1(page, 4_096));
    expect(Result.isSuccess(encodeQuerySyncSourceReadResponseV1(
      page,
      encoded.bytes.byteLength,
    ))).toBe(true);
    const tooSmall = encodeQuerySyncSourceReadResponseV1(
      page,
      encoded.bytes.byteLength - 1,
    );
    expect(Result.isFailure(tooSmall)).toBe(true);
    if (Result.isFailure(tooSmall)) {
      expect(tooSmall.failure).toMatchObject({
        operation: "encodeResponse",
        reason: "byteLimitExceeded",
        observedBytes: encoded.bytes.byteLength,
        maximumBytes: encoded.bytes.byteLength - 1,
      });
    }
    expect(encoded.bytes.byteLength).toBeLessThan(
      MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
    );
  });

  it("accepts only exact failure and positive required-byte headers", () => {
    for (const value of [
      "authority",
      "corruption",
      "resource",
      "timeout",
      "sourceTransportBytes",
    ] as const) {
      expect(unwrap(encodeQuerySyncSourceReadFailureHeaderV1(value))).toBe(value);
      expect(unwrap(decodeQuerySyncSourceReadFailureHeaderV1(value))).toBe(value);
    }
    expect(Result.isFailure(
      decodeQuerySyncSourceReadFailureHeaderV1(" sourceTransportBytes"),
    )).toBe(true);
    expect(unwrap(encodeQuerySyncSourceRequiredAtLeastHeaderV1(1))).toBe("1");
    expect(unwrap(decodeQuerySyncSourceRequiredAtLeastHeaderV1("4096"))).toBe(
      4_096,
    );
    for (const value of [null, "0", "01", "-1", "1 "]) {
      expect(Result.isFailure(
        decodeQuerySyncSourceRequiredAtLeastHeaderV1(value),
      )).toBe(true);
    }
  });
});

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
