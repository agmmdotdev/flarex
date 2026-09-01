import {
  MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1,
  decodeQuerySyncSourceReadFailureHeaderV1,
  decodeQuerySyncSourceReadResponseV1,
  decodeQuerySyncSourceRequiredAtLeastHeaderV1,
  encodeQuerySyncSourceReadRequestV1,
  querySyncSourceReadFailureHeaderV1,
  querySyncSourceReadMediaTypeV1,
  querySyncSourceReadPathV1,
  querySyncSourceReadRequiredAtLeastHeaderV1,
  type QuerySyncSourceCommitV1,
  type QuerySyncSourceReadResponseV1,
} from "@flarex/executor-http/internal-query-sync-source-read-v1";
import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import {
  ChangeSourceCorruptionError,
  ChangeSourceCursorAheadError,
  ChangeSourceIncompatibleError,
  ChangeSourceUnavailableError,
  makeAdmittedChangeSource,
  type AdmittedChangeSource,
  type ChangeReadBudget,
  type ChangeSourceRead,
  type ChangeSourceReadError,
  type ChangeSourceReadRequest,
  type ReplayableChangeSource,
  type SourceCommittedBatch,
} from "@flarex/query-sync/internal/change";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Cause, Clock, Data, Effect, Result } from "effect";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import {
  SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
  SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
  ScopeSyncQueryModelSha256Error,
  canonicalizeScopeSyncQueryAuthorityV1,
  type ScopeSyncQueryAuthorityEvidenceV1,
} from "flarex-protocol/internal/scope-sync-query-model-v1";
import { SCOPE_SYNC_PROTOCOL_VERSION_V1 } from
  "flarex-protocol/internal/scope-sync-v1";

import { readBackendBoundedBody } from "../boundedBody";
import {
  executorRequestUrl,
  fetchExecutorRequest,
  type ExecutorHttpEnv,
} from "../executorHttp";
import {
  FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
  ScopeSyncQueryModelWebCryptoSha256Live,
  captureScopeSyncNamespaceIdV1,
  captureScopeSyncSourceEpochV1,
  captureScopeSyncSourceSequenceV1,
  flarexApplicationQueryInvalidationProjectorV1,
} from "./QuerySyncModel";

export interface FlarexQuerySyncSourceOptionsV1 {
  readonly maximumElapsedMilliseconds?: number;
}

export class FlarexQuerySyncSourceConfigurationV1Error extends Data.TaggedError(
  "FlarexQuerySyncSourceConfigurationV1Error",
)<{
  readonly reason:
    | "missingExecutor"
    | "missingExecutorToken"
    | "invalidExecutorUrl"
    | "invalidElapsedBudget";
}> {}

class QuerySyncSourceResponseTooLargeV1Error extends Data.TaggedError(
  "QuerySyncSourceResponseTooLargeV1Error",
)<{}> {}

const DEFAULT_ELAPSED_MILLISECONDS = 10_000;

export function makeFlarexPostgresReplayableChangeSourceV1(
  env: ExecutorHttpEnv,
  options: FlarexQuerySyncSourceOptionsV1 = {},
): Result.Result<
  ReplayableChangeSource<
    CommitFeedCommitV1,
    ScopeSyncQueryAuthorityEvidenceV1
  >,
  FlarexQuerySyncSourceConfigurationV1Error
> {
  if (env.FLAREX_EXECUTOR === undefined &&
    !isNonBlankString(env.FLAREX_EXECUTOR_URL)) {
    return Result.fail(new FlarexQuerySyncSourceConfigurationV1Error({
      reason: "missingExecutor",
    }));
  }
  if (!isNonBlankString(env.FLAREX_EXECUTOR_TOKEN)) {
    return Result.fail(new FlarexQuerySyncSourceConfigurationV1Error({
      reason: "missingExecutorToken",
    }));
  }
  const maximumElapsedMilliseconds =
    options.maximumElapsedMilliseconds ?? DEFAULT_ELAPSED_MILLISECONDS;
  if (!Number.isSafeInteger(maximumElapsedMilliseconds) ||
    maximumElapsedMilliseconds < 1 || maximumElapsedMilliseconds > 60_000) {
    return Result.fail(new FlarexQuerySyncSourceConfigurationV1Error({
      reason: "invalidElapsedBudget",
    }));
  }
  let url: string;
  try {
    url = executorRequestUrl(
      env.FLAREX_EXECUTOR_URL,
      querySyncSourceReadPathV1,
    );
  } catch {
    return Result.fail(new FlarexQuerySyncSourceConfigurationV1Error({
      reason: "invalidExecutorUrl",
    }));
  }
  const token = env.FLAREX_EXECUTOR_TOKEN;
  const capturedEnv = Object.freeze({
    ...(env.FLAREX_EXECUTOR === undefined
      ? {}
      : { FLAREX_EXECUTOR: env.FLAREX_EXECUTOR }),
    ...(env.FLAREX_EXECUTOR_URL === undefined
      ? {}
      : { FLAREX_EXECUTOR_URL: env.FLAREX_EXECUTOR_URL }),
    FLAREX_EXECUTOR_TOKEN: token,
  }) satisfies ExecutorHttpEnv;

  const readAfter = Effect.fn("FlarexQuerySyncSource.readAfter")(function* (
    request: ChangeSourceReadRequest,
    budget: ChangeReadBudget,
  ): Effect.fn.Return<
    ChangeSourceRead<CommitFeedCommitV1, ScopeSyncQueryAuthorityEvidenceV1>,
    ChangeSourceReadError
  > {
    if (request.syncModelId !== FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1) {
      return yield* new ChangeSourceIncompatibleError({
        operation: "readAfter",
        reason: "modelMismatch",
      });
    }
    const encoded = yield* Effect.fromResult(
      encodeQuerySyncSourceReadRequestV1({
        codecVersion: 1,
        scopeUuid: request.namespaceId,
        syncModelId: SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
        requestedSourceEpoch: request.sourceEpoch,
        requestedAfterCommitSeqExclusive:
          request.requestedAfterSequenceExclusive,
        budget: {
          maximumCommittedBatches: Math.min(
            budget.committedBatches,
            MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1,
          ),
          maximumResponseBytes: budget.sourceTransportBytes,
          maximumModelSemanticWorkUnits: budget.modelSemanticWorkUnits,
          maximumModelSemanticBytes: budget.modelSemanticBytes,
          maximumDependencyKeyExaminations:
            budget.dependencyKeyExaminations,
          maximumCanonicalDependencyBytes: budget.canonicalDependencyBytes,
          maximumElapsedMilliseconds,
        },
      }),
    ).pipe(Effect.mapError(() => new ChangeSourceIncompatibleError({
      operation: "readAfter",
      reason: "invalidBudget",
    })));
    const startedAt = yield* Clock.currentTimeNanos;
    const response = yield* Effect.tryPromise({
      try: signal => fetchExecutorRequest(capturedEnv, new Request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": querySyncSourceReadMediaTypeV1,
        },
        body: copyBytesToArrayBuffer(encoded.bytes),
        signal,
      })),
      catch: () => unavailable("temporarilyUnavailable"),
    }).pipe(
      Effect.timeout(`${maximumElapsedMilliseconds} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? unavailable("temporarilyUnavailable")
        : error),
    );
    const failure = response.headers.get(querySyncSourceReadFailureHeaderV1);
    if (response.status === 422) {
      const requiredAtLeast = yield* Effect.fromResult(Result.gen(function* () {
        const decodedFailure = yield* decodeQuerySyncSourceReadFailureHeaderV1(
          failure,
        );
        if (decodedFailure !== "sourceTransportBytes") {
          return yield* Result.fail(undefined);
        }
        return yield* decodeQuerySyncSourceRequiredAtLeastHeaderV1(
          response.headers.get(querySyncSourceReadRequiredAtLeastHeaderV1),
        );
      })).pipe(Effect.mapError(() => corruption("invalidPagePosition")));
      return rawBudgetInsufficient(request, budget, requiredAtLeast);
    }
    if (response.status === 404) {
      return yield* new ChangeSourceIncompatibleError({
        operation: "readAfter",
        reason: "namespaceMismatch",
      });
    }
    if (response.status !== 200) {
      return yield* classifyFailureResponse(response.status, failure);
    }
    if (failure !== null ||
      response.headers.get("content-type") !== querySyncSourceReadMediaTypeV1) {
      return yield* corruption("invalidPagePosition");
    }
    const contentLengthHeader = response.headers.get("content-length");
    let declaredContentLength: number | null = null;
    if (contentLengthHeader !== null) {
      if (!/^(0|[1-9][0-9]*)$/.test(contentLengthHeader)) {
        return yield* corruption("invalidTransportMeasurement");
      }
      const parsed = Number(contentLengthHeader);
      if (!Number.isSafeInteger(parsed)) {
        return yield* corruption("invalidTransportMeasurement");
      }
      if (parsed > budget.sourceTransportBytes) {
        return rawBudgetInsufficient(request, budget, parsed);
      }
      declaredContentLength = parsed;
    }
    const elapsed = elapsedMilliseconds(startedAt, yield* Clock.currentTimeNanos);
    const remaining = maximumElapsedMilliseconds - elapsed;
    if (remaining < 1) return yield* unavailable("temporarilyUnavailable");
    const bytes = yield* readBackendBoundedBody(
      response.body,
      budget.sourceTransportBytes,
      {
        limitExceeded: () => new QuerySyncSourceResponseTooLargeV1Error(),
        resourceFailure: () => unavailable("temporarilyUnavailable"),
      },
    ).pipe(
      Effect.timeout(`${remaining} millis`),
      Effect.catchTag(
        "QuerySyncSourceResponseTooLargeV1Error",
        () => Effect.succeed(null),
      ),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? unavailable("temporarilyUnavailable")
        : error),
    );
    if (bytes === null) {
      return rawBudgetInsufficient(
        request,
        budget,
        budget.sourceTransportBytes + 1,
      );
    }
    if (declaredContentLength !== null &&
      declaredContentLength !== bytes.byteLength) {
      return yield* corruption("invalidTransportMeasurement");
    }
    const decoded = yield* Effect.fromResult(
      decodeQuerySyncSourceReadResponseV1(
        bytes,
        budget.sourceTransportBytes,
      ),
    ).pipe(Effect.mapError(() => corruption("invalidPagePosition")));
    const mapRemaining = maximumElapsedMilliseconds - elapsedMilliseconds(
      startedAt,
      yield* Clock.currentTimeNanos,
    );
    if (mapRemaining < 1) {
      return yield* unavailable("temporarilyUnavailable");
    }
    const mapped = yield* mapResponse(
      request,
      decoded.value,
      bytes.byteLength,
    ).pipe(
      Effect.timeout(`${mapRemaining} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? unavailable("temporarilyUnavailable")
        : error),
    );
    if (elapsedMilliseconds(startedAt, yield* Clock.currentTimeNanos) >
      maximumElapsedMilliseconds) {
      return yield* unavailable("temporarilyUnavailable");
    }
    return mapped;
  });

  return Result.succeed(Object.freeze({ readAfter }));
}

export function makeFlarexPostgresAdmittedChangeSourceV1(
  env: ExecutorHttpEnv,
  options: FlarexQuerySyncSourceOptionsV1 = {},
): Result.Result<
  AdmittedChangeSource,
  FlarexQuerySyncSourceConfigurationV1Error
> {
  return makeFlarexPostgresReplayableChangeSourceV1(env, options).pipe(
    Result.map(source => makeAdmittedChangeSource(
      source,
      flarexApplicationQueryInvalidationProjectorV1,
    )),
  );
}

const mapResponse = Effect.fn("FlarexQuerySyncSource.mapResponse")(
  function* (
    request: ChangeSourceReadRequest,
    response: QuerySyncSourceReadResponseV1,
    sourceTransportBytes: number,
  ): Effect.fn.Return<
    ChangeSourceRead<CommitFeedCommitV1, ScopeSyncQueryAuthorityEvidenceV1>,
    ChangeSourceReadError
  > {
    if (!sameStringValue(response.scopeUuid, request.namespaceId) ||
      response.syncModelId !== request.syncModelId ||
      !sameStringValue(response.requestedSourceEpoch, request.sourceEpoch) ||
      !sameBigIntValue(
        response.requestedAfterCommitSeqExclusive,
        request.requestedAfterSequenceExclusive,
      )) {
      return yield* corruption("requestMismatch");
    }
    const namespaceId = yield* Effect.fromResult(
      captureScopeSyncNamespaceIdV1(response.scopeUuid),
    ).pipe(Effect.mapError(() => corruption("requestMismatch")));
    const currentSourceEpoch = yield* Effect.fromResult(
      captureScopeSyncSourceEpochV1(response.currentSourceEpoch),
    ).pipe(Effect.mapError(() => corruption("mixedAuthority")));
    const observedLatestSequence = yield* portableSequence(
      response.observedLatestCommitSeq,
    );
    const replayableAfterSequenceExclusive = yield* portableSequence(
      response.replayableAfterCommitSeqExclusive,
    );
    const retainedFromSequenceInclusive =
      response.retainedFromCommitSeqInclusive === null
        ? null
        : yield* portableSequence(response.retainedFromCommitSeqInclusive);
    const resetFields = {
      requestedCursor: Object.freeze({
        namespaceId: request.namespaceId,
        syncModelId: request.syncModelId,
        sourceEpoch: request.sourceEpoch,
        appliedThroughSequence: request.requestedAfterSequenceExclusive,
      }),
      currentSourceEpoch,
      observedLatestSequence,
      replayableAfterSequenceExclusive,
      retainedFromSequenceInclusive,
    };
    switch (response.kind) {
      case "historyUnavailable":
        return Object.freeze({
          _tag: "historyUnavailable" as const,
          ...resetFields,
          reason: "requestedCursorBeforeReplayableHistory" as const,
        });
      case "epochReplaced":
        return Object.freeze({
          _tag: "epochReplaced" as const,
          ...resetFields,
          reason: "sourceEpochChanged" as const,
        });
      case "cursorAhead":
        return yield* new ChangeSourceCursorAheadError({
          operation: "readAfter",
          requestedAfterSequenceExclusive:
            request.requestedAfterSequenceExclusive,
          observedLatestSequence,
        });
      case "page": {
        const batches: SourceCommittedBatch<CommitFeedCommitV1>[] = [];
        for (const commit of response.commits) {
          const payload = commitPayload(commit);
          const sourceSequence = yield* portableSequence(commit.commitSeq);
          batches.push(Object.freeze({
            namespaceId,
            syncModelId: request.syncModelId,
            sourceEpoch: currentSourceEpoch,
            sourceSequence,
            payload,
          }));
        }
        const readThroughSequence = yield* portableSequence(
          response.readThroughCommitSeq,
        );
        if (response.hasMore) {
          return Object.freeze({
            _tag: "page" as const,
            namespaceId,
            syncModelId: request.syncModelId,
            sourceEpoch: currentSourceEpoch,
            requestedAfterSequenceExclusive:
              request.requestedAfterSequenceExclusive,
            replayableAfterSequenceExclusive,
            retainedFromSequenceInclusive,
            observedLatestSequence,
            batches: Object.freeze(batches),
            readThroughSequence,
            sourceTransportBytes,
            hasMore: true as const,
            authorityObservation: null,
          });
        }
        const observation = response.authorityObservation;
        if (!sameStringValue(observation.scopeUuid, response.scopeUuid) ||
          !sameStringValue(
            observation.epochUuid,
            response.currentSourceEpoch,
          ) || !sameBigIntValue(
            observation.observedAtCommitSeq,
            response.observedLatestCommitSeq,
          ) || !sameBigIntValue(
            response.readThroughCommitSeq,
            response.observedLatestCommitSeq,
          )) {
          return yield* corruption("mixedAuthority");
        }
        const authorityObservation = yield*
          canonicalizeScopeSyncQueryAuthorityV1({
            format: SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
            version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
            scopeUuid: observation.scopeUuid,
            syncModelId: SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
            epochUuid: observation.epochUuid,
            storageGeneration: observation.storageGeneration,
            storageGenerationFence: observation.storageGenerationFence,
            activationSequence: observation.activationSequence,
            activeHeadSha256Hex: observation.activeHeadSha256Hex,
          }).pipe(
            Effect.provide(ScopeSyncQueryModelWebCryptoSha256Live),
            Effect.mapError(error =>
              error instanceof ScopeSyncQueryModelSha256Error
                ? unavailable("temporarilyUnavailable")
                : corruption("invalidCaughtUpObservation")
            ),
          );
        return Object.freeze({
          _tag: "page" as const,
          namespaceId,
          syncModelId: request.syncModelId,
          sourceEpoch: currentSourceEpoch,
          requestedAfterSequenceExclusive:
            request.requestedAfterSequenceExclusive,
          replayableAfterSequenceExclusive,
          retainedFromSequenceInclusive,
          observedLatestSequence,
          batches: Object.freeze(batches),
          readThroughSequence,
          sourceTransportBytes,
          hasMore: false as const,
          authorityObservation,
        });
      }
    }
  },
);

function commitPayload(commit: QuerySyncSourceCommitV1): CommitFeedCommitV1 {
  return Object.freeze({
    scopeUuid: commit.scopeUuid,
    epochUuid: commit.epochUuid,
    commitSeq: commit.commitSeq,
    committedAtMilliseconds: commit.committedAtMilliseconds,
    appRowChanges: Object.freeze(commit.appRowChanges.map(change =>
      Object.freeze({
        ordinal: change.ordinal,
        tableId: change.tableId,
        rowId: appRowIdHexV1ToBytes(change.rowId),
      })
    )),
    relationAdjacencyChanges: Object.freeze(
      commit.relationAdjacencyChanges.map(change => Object.freeze({
        ordinal: change.ordinal,
        edgeDefinitionId: change.edgeDefinitionId,
        direction: change.direction,
        endpointRowId: change.endpointRowId,
      })),
    ),
  });
}

function rawBudgetInsufficient(
  request: ChangeSourceReadRequest,
  budget: ChangeReadBudget,
  requiredAtLeast: number,
) {
  return Object.freeze({
    _tag: "budgetInsufficient" as const,
    requestedCursor: Object.freeze({
      namespaceId: request.namespaceId,
      syncModelId: request.syncModelId,
      sourceEpoch: request.sourceEpoch,
      appliedThroughSequence: request.requestedAfterSequenceExclusive,
    }),
    dimension: "sourceTransportBytes" as const,
    provided: budget.sourceTransportBytes,
    requiredAtLeast,
    reason: "nextIndivisibleUnitExceedsBudget" as const,
  });
}

const portableSequence = Effect.fn("FlarexQuerySyncSource.portableSequence")(
  (commitSeq: CommitSeq) => Effect.fromResult(
    captureScopeSyncSourceSequenceV1(commitSeq),
  ).pipe(Effect.mapError(() => corruption("invalidPagePosition"))),
);

function sameStringValue(left: string, right: string): boolean {
  return left === right;
}

function sameBigIntValue(left: bigint, right: bigint): boolean {
  return left === right;
}

function classifyFailureResponse(
  status: number,
  header: string | null,
): Effect.Effect<never, ChangeSourceReadError> {
  return Effect.fromResult(decodeQuerySyncSourceReadFailureHeaderV1(header)).pipe(
    Effect.mapError(() => corruption("invalidPagePosition")),
    Effect.flatMap((failure): Effect.Effect<never, ChangeSourceReadError> => {
      switch (failure) {
        case "authority":
          return status === 409
            ? Effect.fail(new ChangeSourceIncompatibleError({
                operation: "readAfter",
                reason: "unsupportedSourceContract",
              }))
            : Effect.fail(corruption("invalidPagePosition"));
        case "corruption":
          return Effect.fail(corruption("invalidPagePosition"));
        case "resource":
          return status === 503
            ? Effect.fail(unavailable("temporarilyUnavailable"))
            : Effect.fail(corruption("invalidPagePosition"));
        case "timeout":
          return status === 504
            ? Effect.fail(unavailable("temporarilyUnavailable"))
            : Effect.fail(corruption("invalidPagePosition"));
        case "sourceTransportBytes":
          return Effect.fail(corruption("invalidPagePosition"));
      }
    }),
  );
}

function corruption(
  reason: ChangeSourceCorruptionError["reason"],
): ChangeSourceCorruptionError {
  return new ChangeSourceCorruptionError({
    operation: "readAfter",
    reason,
    expectedSequence: null,
    observedSequence: null,
  });
}

function unavailable(
  reason: ChangeSourceUnavailableError["reason"],
): ChangeSourceUnavailableError {
  return new ChangeSourceUnavailableError({ operation: "readAfter", reason });
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  const elapsed = endedAt - startedAt;
  if (elapsed <= 0n) return 0;
  const milliseconds = elapsed / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}
