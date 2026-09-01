import {
  decodeQuerySyncSourceReadRequestV1,
  encodeQuerySyncSourceReadResponseV1,
  querySyncSourceReadFailureHeaderV1,
  querySyncSourceReadMediaTypeV1,
  querySyncSourceReadPathV1,
  querySyncSourceReadRequiredAtLeastHeaderV1,
} from "@flarex/executor-http/internal-query-sync-source-read-v1";
import {
  ChangeSourceCorruptionError,
  ChangeSourceIncompatibleError,
  ChangeSourceUnavailableError,
  type ChangeReadBudget,
} from "@flarex/query-sync/internal/change";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  CommitSeqSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  makeFlarexPostgresAdmittedChangeSourceV1,
  makeFlarexPostgresReplayableChangeSourceV1,
} from "../src/deploymentSync/QuerySyncSource";
import {
  FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
  captureScopeSyncNamespaceIdV1,
  captureScopeSyncSourceEpochV1,
  captureScopeSyncSourceSequenceV1,
} from "../src/deploymentSync/QuerySyncModel";

const SCOPE = decodeScopeUuidV1(
  "91000000-0000-0000-0000-000000000001",
);
const EPOCH = decodeScopeEpochUuidV1(
  "92000000-0000-0000-0000-000000000001",
);
const ZERO = CommitSeqSchema.make(0n);
const ONE = CommitSeqSchema.make(1n);
const namespaceId = unwrap(captureScopeSyncNamespaceIdV1(SCOPE));
const sourceEpoch = unwrap(captureScopeSyncSourceEpochV1(EPOCH));
const zeroSequence = unwrap(captureScopeSyncSourceSequenceV1(ZERO));

const budget = Object.freeze({
  committedBatches: 10,
  sourceTransportBytes: 8_192,
  modelSemanticWorkUnits: 1_000,
  modelSemanticBytes: 8_192,
  dependencyKeyExaminations: 1_000,
  canonicalDependencyBytes: 8_192,
}) satisfies ChangeReadBudget;

const readRequest = Object.freeze({
  namespaceId,
  syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
  sourceEpoch,
  requestedAfterSequenceExclusive: zeroSequence,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backend Postgres query-sync source adapter", () => {
  it("uses the authenticated service binding and maps the strict source page", async () => {
    const requests: Request[] = [];
    const source = unwrap(makeFlarexPostgresReplayableChangeSourceV1({
      FLAREX_EXECUTOR: {
        fetch: async request => {
          requests.push(request);
          return encodedResponse({
            codecVersion: 1,
            kind: "page",
            scopeUuid: SCOPE,
            syncModelId: "flarexdb.application-query.v1",
            requestedSourceEpoch: EPOCH,
            requestedAfterCommitSeqExclusive: ZERO,
            currentSourceEpoch: EPOCH,
            observedLatestCommitSeq: ONE,
            replayableAfterCommitSeqExclusive: ZERO,
            retainedFromCommitSeqInclusive: ONE,
            commits: Object.freeze([Object.freeze({
              scopeUuid: SCOPE,
              epochUuid: EPOCH,
              commitSeq: ONE,
              committedAtMilliseconds: 1_788_134_400_000,
              appRowChanges: Object.freeze([]),
              relationAdjacencyChanges: Object.freeze([]),
            })]),
            readThroughCommitSeq: ONE,
            hasMore: true,
            authorityObservation: null,
          });
        },
      },
      FLAREX_EXECUTOR_URL: "https://executor.example/root/?ignored=yes",
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));

    const read = await Effect.runPromise(source.readAfter(readRequest, budget));
    expect(read._tag).toBe("page");
    if (read._tag !== "page") throw new Error("Expected a page.");
    expect(read.batches).toHaveLength(1);
    expect(read.batches[0]?.sourceSequence).toBe(1n);
    expect(read.readThroughSequence).toBe(1n);
    expect(read.hasMore).toBe(true);
    expect(read.authorityObservation).toBeNull();
    expect(read.sourceTransportBytes).toBeGreaterThan(0);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) throw new Error("Expected an executor request.");
    expect(request.url).toBe(`https://executor.example/root${querySyncSourceReadPathV1}`);
    expect(request.headers.get("authorization")).toBe("Bearer executor-secret");
    expect(request.headers.get("content-type")).toBe(
      querySyncSourceReadMediaTypeV1,
    );
    const decoded = unwrap(decodeQuerySyncSourceReadRequestV1(
      new Uint8Array(await request.arrayBuffer()),
    ));
    expect(decoded.value.budget).toMatchObject({
      maximumCommittedBatches: budget.committedBatches,
      maximumResponseBytes: budget.sourceTransportBytes,
      maximumModelSemanticWorkUnits: budget.modelSemanticWorkUnits,
      maximumDependencyKeyExaminations: budget.dependencyKeyExaminations,
    });
  });

  it("maps measured byte shortfalls and redacted resource failures", async () => {
    const shortfallSource = unwrap(makeFlarexPostgresReplayableChangeSourceV1({
      FLAREX_EXECUTOR: {
        fetch: async () => new Response(null, {
          status: 422,
          headers: {
            [querySyncSourceReadFailureHeaderV1]: "sourceTransportBytes",
            [querySyncSourceReadRequiredAtLeastHeaderV1]: "9000",
          },
        }),
      },
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    const shortfall = await Effect.runPromise(
      shortfallSource.readAfter(readRequest, budget),
    );
    expect(shortfall).toMatchObject({
      _tag: "budgetInsufficient",
      dimension: "sourceTransportBytes",
      provided: budget.sourceTransportBytes,
      requiredAtLeast: 9_000,
    });

    const unavailableSource = unwrap(makeFlarexPostgresReplayableChangeSourceV1({
      FLAREX_EXECUTOR: {
        fetch: async () => new Response(null, {
          status: 503,
          headers: { [querySyncSourceReadFailureHeaderV1]: "resource" },
        }),
      },
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    const failure = await Effect.runPromise(Effect.flip(
      unavailableSource.readAfter(readRequest, budget),
    ));
    expect(failure).toBeInstanceOf(ChangeSourceUnavailableError);
    expect(failure).toMatchObject({
      operation: "readAfter",
      reason: "temporarilyUnavailable",
    });

    const measurementSource = unwrap(makeFlarexPostgresReplayableChangeSourceV1({
      FLAREX_EXECUTOR: {
        fetch: async () => {
          const response = encodedResponse({
            codecVersion: 1,
            kind: "historyUnavailable",
            scopeUuid: SCOPE,
            syncModelId: "flarexdb.application-query.v1",
            requestedSourceEpoch: EPOCH,
            requestedAfterCommitSeqExclusive: ZERO,
            currentSourceEpoch: EPOCH,
            observedLatestCommitSeq: ONE,
            replayableAfterCommitSeqExclusive: ZERO,
            retainedFromCommitSeqInclusive: ONE,
          });
          response.headers.set("content-length", "1");
          return response;
        },
      },
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    }));
    const measurementFailure = await Effect.runPromise(Effect.flip(
      measurementSource.readAfter(readRequest, budget),
    ));
    expect(measurementFailure).toBeInstanceOf(ChangeSourceCorruptionError);
    expect(measurementFailure).toMatchObject({
      operation: "readAfter",
      reason: "invalidTransportMeasurement",
    });
  });

  it("exposes the admitted source only through the projector-owned adapter", () => {
    const admitted = makeFlarexPostgresAdmittedChangeSourceV1({
      FLAREX_EXECUTOR: { fetch: async () => new Response(null, { status: 503 }) },
      FLAREX_EXECUTOR_TOKEN: "executor-secret",
    });
    expect(Result.isSuccess(admitted)).toBe(true);
    if (Result.isSuccess(admitted)) {
      expect(admitted.success).toEqual({ readAfter: expect.any(Function) });
      expect(Object.isFrozen(admitted.success)).toBe(true);
    }
  });

  it("maps 404, 409, 500, and 504 executor faults into portable errors", async () => {
    const faults = [
      {
        status: 404,
        header: null,
        error: ChangeSourceIncompatibleError,
        reason: "namespaceMismatch",
      },
      {
        status: 409,
        header: "authority",
        error: ChangeSourceIncompatibleError,
        reason: "unsupportedSourceContract",
      },
      {
        status: 500,
        header: "corruption",
        error: ChangeSourceCorruptionError,
        reason: "invalidPagePosition",
      },
      {
        status: 504,
        header: "timeout",
        error: ChangeSourceUnavailableError,
        reason: "temporarilyUnavailable",
      },
    ] as const;
    for (const fault of faults) {
      const source = unwrap(makeFlarexPostgresReplayableChangeSourceV1({
        FLAREX_EXECUTOR: {
          fetch: async () => new Response(null, {
            status: fault.status,
            ...(fault.header === null
              ? {}
              : {
                  headers: {
                    [querySyncSourceReadFailureHeaderV1]: fault.header,
                  },
                }),
          }),
        },
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
      }));
      const failure = await Effect.runPromise(Effect.flip(
        source.readAfter(readRequest, budget),
      ));
      expect(failure).toBeInstanceOf(fault.error);
      expect(failure).toMatchObject({
        operation: "readAfter",
        reason: fault.reason,
      });
    }
  });

  it("canonicalizes terminal authority and keeps digest rejection retryable", async () => {
    const terminalValue = {
      codecVersion: 1,
      kind: "page",
      scopeUuid: SCOPE,
      syncModelId: "flarexdb.application-query.v1",
      requestedSourceEpoch: EPOCH,
      requestedAfterCommitSeqExclusive: ZERO,
      currentSourceEpoch: EPOCH,
      observedLatestCommitSeq: ZERO,
      replayableAfterCommitSeqExclusive: ZERO,
      retainedFromCommitSeqInclusive: null,
      commits: Object.freeze([]),
      readThroughCommitSeq: ZERO,
      hasMore: false,
      authorityObservation: Object.freeze({
        format: "flarex.scope-sync-active-head-observation",
        version: 1,
        scopeUuid: SCOPE,
        epochUuid: EPOCH,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: 1n,
        observedAtCommitSeq: ZERO,
        activationSequence: 1n,
        activeHeadSha256Hex: "00".repeat(32),
      }),
    } as const;
    const sourceFor = (fetch: () => Promise<Response>) => unwrap(
      makeFlarexPostgresReplayableChangeSourceV1({
        FLAREX_EXECUTOR: { fetch },
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
      }),
    );
    const terminal = await Effect.runPromise(sourceFor(
      async () => encodedResponse(terminalValue),
    ).readAfter(readRequest, budget));
    expect(terminal).toMatchObject({
      _tag: "page",
      hasMore: false,
      authorityObservation: {
        authority: {
          scopeUuid: SCOPE,
          epochUuid: EPOCH,
          activationSequence: 1n,
        },
      },
    });

    vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(
      new Error("transient digest failure"),
    );
    const failure = await Effect.runPromise(Effect.flip(sourceFor(
      async () => encodedResponse(terminalValue),
    ).readAfter(readRequest, budget)));
    expect(failure).toBeInstanceOf(ChangeSourceUnavailableError);
    expect(failure).toMatchObject({
      operation: "readAfter",
      reason: "temporarilyUnavailable",
    });
  });
});

function encodedResponse(value: unknown): Response {
  const encoded = unwrap(encodeQuerySyncSourceReadResponseV1(value, 8_192));
  return new Response(copyBytesToArrayBuffer(encoded.bytes), {
    status: 200,
    headers: {
      "content-length": String(encoded.bytes.byteLength),
      "content-type": querySyncSourceReadMediaTypeV1,
    },
  });
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
