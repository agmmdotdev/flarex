import {
  MAX_QUERY_SYNC_SOURCE_ELAPSED_MILLISECONDS_V1,
  MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
  MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1,
  QuerySyncSourceCodecV1Error,
  decodeQuerySyncSourceReadRequestV1,
  encodeQuerySyncSourceReadFailureHeaderV1,
  encodeQuerySyncSourceReadResponseV1,
  encodeQuerySyncSourceRequiredAtLeastHeaderV1,
  querySyncSourceReadFailureHeaderV1,
  querySyncSourceReadMediaTypeV1,
  querySyncSourceReadRequiredAtLeastHeaderV1,
  type QuerySyncSourceCommitV1,
  type QuerySyncSourceReadRequestV1,
  type QuerySyncSourceReadResponseV1,
} from "@flarex/executor-http/internal-query-sync-source-read-v1";
import {
  type CommitFeedCommitV1,
} from "@flarex/persistence-postgres/internal/commit-feed";
import {
  type ScopeSyncChangeSourceReadV1,
  type ScopeSyncChangeSourceReadV1Error,
  type ScopeSyncChangeSourceReaderV1,
} from "@flarex/persistence-postgres/internal/scope-sync-change-source-read-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { appRowIdHexV1FromBytesResult } from
  "flarex-protocol/app-document-id";
import { Cause, Clock, Data, Effect, Result } from "effect";

type HostOperation = "request" | "source" | "response";

export interface QuerySyncSourceReadHostResourceFailureV1 {
  readonly operation: HostOperation;
  readonly cause: unknown;
}

export interface QuerySyncSourceReadHostOptionsV1 {
  readonly reportResourceFailure?: (
    failure: QuerySyncSourceReadHostResourceFailureV1,
  ) => Effect.Effect<void, never, never>;
}

class QuerySyncSourceReadHostInputV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostInputV1Error",
)<{
  readonly operation: HostOperation;
  readonly reason:
    | "methodNotAllowed"
    | "invalidContentType"
    | "invalidContentLength"
    | "bodyTooLarge"
    | "invalidBody";
}> {}

class QuerySyncSourceReadHostAuthorityV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostAuthorityV1Error",
)<{ readonly operation: "source" }> {}

class QuerySyncSourceReadHostCorruptionV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostCorruptionV1Error",
)<{ readonly operation: "source" | "response" }> {}

class QuerySyncSourceReadHostResourceV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostResourceV1Error",
)<{ readonly operation: HostOperation }> {}

class QuerySyncSourceReadHostTimeoutV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostTimeoutV1Error",
)<{ readonly operation: HostOperation }> {}

class QuerySyncSourceReadHostScopeNotFoundV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostScopeNotFoundV1Error",
)<{ readonly operation: "source" }> {}

class QuerySyncSourceReadHostBudgetV1Error extends Data.TaggedError(
  "QuerySyncSourceReadHostBudgetV1Error",
)<{
  readonly operation: "response";
  readonly requiredAtLeast: number;
}> {}

type QuerySyncSourceReadHostV1Error =
  | QuerySyncSourceReadHostInputV1Error
  | QuerySyncSourceReadHostAuthorityV1Error
  | QuerySyncSourceReadHostCorruptionV1Error
  | QuerySyncSourceReadHostResourceV1Error
  | QuerySyncSourceReadHostTimeoutV1Error
  | QuerySyncSourceReadHostScopeNotFoundV1Error
  | QuerySyncSourceReadHostBudgetV1Error;

const resourceCauseByError = new WeakMap<
  QuerySyncSourceReadHostResourceV1Error,
  unknown
>();

export function makeQuerySyncSourceReadHostV1(
  reader: ScopeSyncChangeSourceReaderV1,
  options: QuerySyncSourceReadHostOptionsV1 = {},
): (request: Request) => Promise<Response> {
  const route = Effect.fn("QuerySyncSourceReadHost.route")(function* (
    request: Request,
  ): Effect.fn.Return<Response, QuerySyncSourceReadHostV1Error> {
    if (request.method !== "POST") {
      return yield* new QuerySyncSourceReadHostInputV1Error({
        operation: "request",
        reason: "methodNotAllowed",
      });
    }
    if (request.headers.get("content-type") !== querySyncSourceReadMediaTypeV1) {
      return yield* new QuerySyncSourceReadHostInputV1Error({
        operation: "request",
        reason: "invalidContentType",
      });
    }
    const contentLength = yield* decodeContentLength(
      request.headers.get("content-length"),
    );
    if (contentLength !== null &&
      contentLength > MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1) {
      return yield* new QuerySyncSourceReadHostInputV1Error({
        operation: "request",
        reason: "bodyTooLarge",
      });
    }
    const startedAt = yield* Clock.currentTimeNanos;
    const requestBytes = yield* readBoundedBody(
      request.body,
      MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
    ).pipe(
      Effect.timeout(
        `${MAX_QUERY_SYNC_SOURCE_ELAPSED_MILLISECONDS_V1} millis`,
      ),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? new QuerySyncSourceReadHostTimeoutV1Error({ operation: "request" })
        : error),
    );
    const decoded = yield* Effect.fromResult(
      decodeQuerySyncSourceReadRequestV1(requestBytes),
    ).pipe(Effect.mapError(() => new QuerySyncSourceReadHostInputV1Error({
      operation: "request",
      reason: "invalidBody",
    })));
    const budget = decoded.value.budget;
    yield* requireElapsed(startedAt, budget.maximumElapsedMilliseconds);
    const remaining = yield* remainingElapsed(
      startedAt,
      budget.maximumElapsedMilliseconds,
      "source",
    );
    const source = yield* reader.readAfter({
      scopeUuid: decoded.value.scopeUuid,
      requestedSourceEpoch: decoded.value.requestedSourceEpoch,
      requestedAfterCommitSeqExclusive:
        decoded.value.requestedAfterCommitSeqExclusive,
      maximumCommittedBatches: budget.maximumCommittedBatches,
      maximumElapsedMilliseconds: remaining,
    }).pipe(
      Effect.timeout(`${remaining} millis`),
      Effect.mapError(error => Cause.isTimeoutError(error)
        ? new QuerySyncSourceReadHostTimeoutV1Error({ operation: "source" })
        : classifySourceError(error)),
    );
    const responseValue = yield* Effect.fromResult(
      sourceResponse(decoded.value, source),
    );
    const encoded = yield* Effect.fromResult(encodeFittingResponse(
      responseValue,
      budget.maximumResponseBytes,
    ));
    yield* requireElapsed(startedAt, budget.maximumElapsedMilliseconds);
    if (encoded.kind === "budgetInsufficient") {
      return yield* new QuerySyncSourceReadHostBudgetV1Error({
        operation: "response",
        requiredAtLeast: encoded.requiredAtLeast,
      });
    }
    return new Response(copyBytesToArrayBuffer(encoded.bytes), {
      status: 200,
      headers: {
        "content-length": String(encoded.bytes.byteLength),
        "content-type": querySyncSourceReadMediaTypeV1,
      },
    });
  });

  return request => Effect.runPromise(route(request).pipe(
    Effect.catch(error => Effect.gen(function* () {
      if (error instanceof QuerySyncSourceReadHostResourceV1Error) {
        const report = options.reportResourceFailure;
        if (report !== undefined) {
          yield* report(Object.freeze({
            operation: error.operation,
            cause: resourceCauseByError.get(error),
          }));
        }
      }
      return hostErrorResponse(error);
    })),
  ));
}

function sourceResponse(
  request: QuerySyncSourceReadRequestV1,
  source: ScopeSyncChangeSourceReadV1,
): Result.Result<
  QuerySyncSourceReadResponseV1,
  QuerySyncSourceReadHostCorruptionV1Error
> {
  const common = {
    codecVersion: 1 as const,
    scopeUuid: source.scopeUuid,
    syncModelId: request.syncModelId,
    requestedSourceEpoch: request.requestedSourceEpoch,
    requestedAfterCommitSeqExclusive:
      request.requestedAfterCommitSeqExclusive,
    currentSourceEpoch: source.currentSourceEpoch,
    observedLatestCommitSeq: source.observedLatestCommitSeq,
    replayableAfterCommitSeqExclusive:
      source.replayableAfterCommitSeqExclusive,
    retainedFromCommitSeqInclusive: source.retainedFromCommitSeqInclusive,
  };
  switch (source.kind) {
    case "historyUnavailable":
    case "epochReplaced":
    case "cursorAhead":
      return Result.succeed(Object.freeze({ ...common, kind: source.kind }));
    case "page":
      return Result.gen(function* () {
        const commits: QuerySyncSourceCommitV1[] = [];
        for (const commit of source.commits) {
          commits.push(yield* wireCommit(commit));
        }
        return source.hasMore
          ? Object.freeze({
              ...common,
              kind: "page" as const,
              commits: Object.freeze(commits),
              readThroughCommitSeq: source.readThroughCommitSeq,
              hasMore: true as const,
              authorityObservation: null,
            })
          : source.authorityObservation === null
            ? yield* Result.fail(new QuerySyncSourceReadHostCorruptionV1Error({
                operation: "response",
              }))
            : Object.freeze({
                ...common,
                kind: "page" as const,
                commits: Object.freeze(commits),
                readThroughCommitSeq: source.readThroughCommitSeq,
                hasMore: false as const,
                authorityObservation: source.authorityObservation,
              });
      });
  }
}

function wireCommit(
  commit: CommitFeedCommitV1,
): Result.Result<
  QuerySyncSourceCommitV1,
  QuerySyncSourceReadHostCorruptionV1Error
> {
  return Result.gen(function* () {
    const appRowChanges: QuerySyncSourceCommitV1["appRowChanges"][number][] = [];
    for (const change of commit.appRowChanges) {
      const rowId = yield* appRowIdHexV1FromBytesResult(change.rowId).pipe(
        Result.mapError(() => new QuerySyncSourceReadHostCorruptionV1Error({
          operation: "response",
        })),
      );
      appRowChanges.push(Object.freeze({
        ordinal: change.ordinal,
        tableId: change.tableId,
        rowId,
      }));
    }
    return Object.freeze({
      scopeUuid: commit.scopeUuid,
      epochUuid: commit.epochUuid,
      commitSeq: commit.commitSeq,
      committedAtMilliseconds: commit.committedAtMilliseconds,
      appRowChanges: Object.freeze(appRowChanges),
      relationAdjacencyChanges: Object.freeze(
        commit.relationAdjacencyChanges.map(change => Object.freeze({
          ordinal: change.ordinal,
          edgeDefinitionId: change.edgeDefinitionId,
          direction: change.direction,
          endpointRowId: change.endpointRowId,
        })),
      ),
    });
  });
}

type FittingResponse =
  | Readonly<{ readonly kind: "encoded"; readonly bytes: Uint8Array }>
  | Readonly<{
      readonly kind: "budgetInsufficient";
      readonly requiredAtLeast: number;
    }>;

function encodeFittingResponse(
  response: QuerySyncSourceReadResponseV1,
  maximumBytes: number,
): Result.Result<FittingResponse, QuerySyncSourceReadHostCorruptionV1Error> {
  const full = encodeQuerySyncSourceReadResponseV1(response, maximumBytes);
  if (Result.isSuccess(full)) {
    return Result.succeed(Object.freeze({
      kind: "encoded" as const,
      bytes: full.success.bytes,
    }));
  }
  if (full.failure.reason !== "byteLimitExceeded") {
    return Result.fail(new QuerySyncSourceReadHostCorruptionV1Error({
      operation: "response",
    }));
  }
  if (response.kind !== "page" || response.commits.length === 0) {
    return Result.succeed(shortfall(full.failure));
  }
  const first = encodeQuerySyncSourceReadResponseV1(
    pagePrefix(response, 1),
    MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1,
  );
  if (Result.isFailure(first)) {
    return first.failure.reason === "byteLimitExceeded"
      ? Result.succeed(Object.freeze({
          kind: "budgetInsufficient" as const,
          requiredAtLeast: MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1 + 1,
        }))
      : Result.fail(new QuerySyncSourceReadHostCorruptionV1Error({
          operation: "response",
        }));
  }
  if (first.success.bytes.byteLength > maximumBytes) {
    return Result.succeed(Object.freeze({
      kind: "budgetInsufficient" as const,
      requiredAtLeast: first.success.bytes.byteLength,
    }));
  }
  let low = 1;
  let high = response.commits.length - 1;
  let best = first.success.bytes;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = encodeQuerySyncSourceReadResponseV1(
      pagePrefix(response, middle),
      maximumBytes,
    );
    if (Result.isSuccess(candidate)) {
      best = candidate.success.bytes;
      low = middle + 1;
    } else if (candidate.failure.reason === "byteLimitExceeded") {
      high = middle - 1;
    } else {
      return Result.fail(new QuerySyncSourceReadHostCorruptionV1Error({
        operation: "response",
      }));
    }
  }
  return Result.succeed(Object.freeze({ kind: "encoded", bytes: best }));
}

function pagePrefix(
  page: Extract<QuerySyncSourceReadResponseV1, { readonly kind: "page" }>,
  count: number,
): QuerySyncSourceReadResponseV1 {
  const commits = Object.freeze(page.commits.slice(0, count));
  const last = commits.at(-1);
  if (last === undefined) throw new Error("Query-sync page prefix is empty.");
  const hasMore = count < page.commits.length || page.hasMore;
  return hasMore
    ? Object.freeze({
        ...page,
        commits,
        readThroughCommitSeq: last.commitSeq,
        hasMore: true as const,
        authorityObservation: null,
      })
    : page;
}

function shortfall(error: QuerySyncSourceCodecV1Error): FittingResponse {
  return Object.freeze({
    kind: "budgetInsufficient",
    requiredAtLeast: error.observedBytes ??
      MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1 + 1,
  });
}

function classifySourceError(
  error: ScopeSyncChangeSourceReadV1Error,
): QuerySyncSourceReadHostV1Error {
  switch (error._tag) {
    case "CommitFeedScopeNotFoundErrorV1":
      return new QuerySyncSourceReadHostScopeNotFoundV1Error({
        operation: "source",
      });
    case "ScopeSyncChangeSourceAuthorityV1Error":
      return error.reason === "activeHeadMissing"
        ? new QuerySyncSourceReadHostAuthorityV1Error({ operation: "source" })
        : new QuerySyncSourceReadHostCorruptionV1Error({
            operation: "source",
          });
    case "ApplicationActiveHeadStateError":
      return error.reason === "resourceFailure"
        ? resourceFailure("source", error.cause)
        : new QuerySyncSourceReadHostCorruptionV1Error({
            operation: "source",
          });
    case "ScopeSyncChangeSourceSqlV1Error":
    case "CommitFeedSqlErrorV1":
      return resourceFailure("source", error.cause);
    case "ScopeSyncChangeSourceInputV1Error":
      return new QuerySyncSourceReadHostInputV1Error({
        operation: "source",
        reason: "invalidBody",
      });
    case "ScopeSyncChangeSourceTimeoutV1Error":
      return new QuerySyncSourceReadHostTimeoutV1Error({
        operation: "source",
      });
    case "CommitFeedCorruptionErrorV1":
    case "CommitFeedCursorResetRequiredErrorV1":
      return new QuerySyncSourceReadHostCorruptionV1Error({
        operation: "source",
      });
    case "CommitFeedInputErrorV1":
      return new QuerySyncSourceReadHostInputV1Error({
        operation: "source",
        reason: "invalidBody",
      });
  }
}

function decodeContentLength(
  value: string | null,
): Effect.Effect<number | null, QuerySyncSourceReadHostInputV1Error> {
  if (value === null) return Effect.succeed(null);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return Effect.fail(new QuerySyncSourceReadHostInputV1Error({
      operation: "request",
      reason: "invalidContentLength",
    }));
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Effect.succeed(parsed)
    : Effect.fail(new QuerySyncSourceReadHostInputV1Error({
        operation: "request",
        reason: "invalidContentLength",
      }));
}

function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Effect.Effect<
  Uint8Array,
  QuerySyncSourceReadHostInputV1Error | QuerySyncSourceReadHostResourceV1Error
> {
  return Effect.tryPromise({
    try: signal => readBoundedBodyPromise(body, maximumBytes, signal),
    catch: cause => cause instanceof BodyTooLargeError
      ? new QuerySyncSourceReadHostInputV1Error({
          operation: "request",
          reason: "bodyTooLarge",
        })
      : resourceFailure("request", cause),
  });
}

async function readBoundedBodyPromise(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = new Uint8Array(next.value);
      const candidate = total + chunk.byteLength;
      if (!Number.isSafeInteger(candidate) || candidate > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      if (chunk.byteLength > 0) chunks.push(chunk);
      total = candidate;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

class BodyTooLargeError extends Error {}

function requireElapsed(
  startedAt: bigint,
  maximumMilliseconds: number,
): Effect.Effect<void, QuerySyncSourceReadHostTimeoutV1Error> {
  return Effect.gen(function* () {
    if (elapsedMilliseconds(startedAt, yield* Clock.currentTimeNanos) >
      maximumMilliseconds) {
      return yield* new QuerySyncSourceReadHostTimeoutV1Error({
        operation: "request",
      });
    }
  });
}

function remainingElapsed(
  startedAt: bigint,
  maximumMilliseconds: number,
  operation: HostOperation,
): Effect.Effect<number, QuerySyncSourceReadHostTimeoutV1Error> {
  return Effect.gen(function* () {
    const remaining = maximumMilliseconds - elapsedMilliseconds(
      startedAt,
      yield* Clock.currentTimeNanos,
    );
    if (remaining < 1) {
      return yield* new QuerySyncSourceReadHostTimeoutV1Error({ operation });
    }
    return remaining;
  });
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  const elapsed = endedAt - startedAt;
  if (elapsed <= 0n) return 0;
  const milliseconds = elapsed / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}

function hostErrorResponse(error: QuerySyncSourceReadHostV1Error): Response {
  if (error instanceof QuerySyncSourceReadHostInputV1Error) {
    return Response.json({ error: "invalid_query_sync_source_read" }, {
      status: error.reason === "methodNotAllowed" ? 405 : 400,
    });
  }
  if (error instanceof QuerySyncSourceReadHostScopeNotFoundV1Error) {
    return new Response(null, { status: 404 });
  }
  if (error instanceof QuerySyncSourceReadHostBudgetV1Error) {
    return failureResponse(422, "sourceTransportBytes", error.requiredAtLeast);
  }
  if (error instanceof QuerySyncSourceReadHostAuthorityV1Error) {
    return failureResponse(409, "authority");
  }
  if (error instanceof QuerySyncSourceReadHostCorruptionV1Error) {
    return failureResponse(500, "corruption");
  }
  if (error instanceof QuerySyncSourceReadHostTimeoutV1Error) {
    return failureResponse(504, "timeout");
  }
  return failureResponse(503, "resource");
}

function failureResponse(
  status: number,
  failure: "authority" | "corruption" | "resource" | "timeout" |
    "sourceTransportBytes",
  requiredAtLeast?: number,
): Response {
  const encodedFailure = Result.getOrThrow(
    encodeQuerySyncSourceReadFailureHeaderV1(failure),
  );
  const headers = new Headers({
    [querySyncSourceReadFailureHeaderV1]: encodedFailure,
  });
  if (requiredAtLeast !== undefined) {
    headers.set(
      querySyncSourceReadRequiredAtLeastHeaderV1,
      Result.getOrThrow(
        encodeQuerySyncSourceRequiredAtLeastHeaderV1(requiredAtLeast),
      ),
    );
  }
  return new Response(null, { status, headers });
}

function resourceFailure(
  operation: HostOperation,
  cause: unknown,
): QuerySyncSourceReadHostResourceV1Error {
  const error = new QuerySyncSourceReadHostResourceV1Error({ operation });
  resourceCauseByError.set(error, cause);
  return error;
}
