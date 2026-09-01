import {
  bytesEqualFullScan,
  copyBytes,
  isUint8Array,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data, Result, Schema } from "effect";
import { AppRowIdHexV1Schema } from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  ScopeSyncActiveHeadObservationV1Schema,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
} from "flarex-protocol/internal/scope-sync-query-model-v1";
import {
  encodeCanonicalJson,
  isJson,
  type Json,
} from "flarex-protocol/json";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "flarex-protocol/storage-authority";

export const querySyncSourceReadPathV1 =
  "/internal/v1/query-sync/source/read-after";
export const querySyncSourceReadMediaTypeV1 =
  "application/vnd.flarex.query-sync-source-read-v1+json";
export const querySyncSourceReadFailureHeaderV1 =
  "x-flarex-query-sync-source-failure-v1";
export const querySyncSourceReadRequiredAtLeastHeaderV1 =
  "x-flarex-query-sync-source-required-at-least-v1";

export const MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1 = 16 * 1_024;
export const MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1 = 16 * 1_024 * 1_024;
export const MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1 = 100;
export const MAX_QUERY_SYNC_SOURCE_SEMANTIC_WORK_UNITS_V1 = 65_536;
export const MAX_QUERY_SYNC_SOURCE_SEMANTIC_BYTES_V1 = 16 * 1_024 * 1_024;
export const MAX_QUERY_SYNC_SOURCE_DEPENDENCY_EXAMINATIONS_V1 = 65_536;
export const MAX_QUERY_SYNC_SOURCE_CANONICAL_DEPENDENCY_BYTES_V1 =
  16 * 1_024 * 1_024;
export const MAX_QUERY_SYNC_SOURCE_ELAPSED_MILLISECONDS_V1 = 60_000;

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;
const PositiveSafeIntegerSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const BoundedCommittedBatchesSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1),
);
const BoundedResponseBytesSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1),
);
const BoundedSemanticWorkSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(
    MAX_QUERY_SYNC_SOURCE_SEMANTIC_WORK_UNITS_V1,
  ),
);
const BoundedSemanticBytesSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(MAX_QUERY_SYNC_SOURCE_SEMANTIC_BYTES_V1),
);
const BoundedDependencyExaminationsSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(
    MAX_QUERY_SYNC_SOURCE_DEPENDENCY_EXAMINATIONS_V1,
  ),
);
const BoundedCanonicalDependencyBytesSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(
    MAX_QUERY_SYNC_SOURCE_CANONICAL_DEPENDENCY_BYTES_V1,
  ),
);
const BoundedElapsedMillisecondsSchema = PositiveSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(
    MAX_QUERY_SYNC_SOURCE_ELAPSED_MILLISECONDS_V1,
  ),
);
const ChangeOrdinalSchema = Schema.Int.check(Schema.isBetween({
  minimum: 0,
  maximum: 65_535,
}));
const CommittedAtMillisecondsSchema = Schema.Int.check(Schema.isBetween({
  minimum: -8_640_000_000_000_000,
  maximum: 8_640_000_000_000_000,
}));

export const QuerySyncSourceReadBudgetV1Schema = Schema.Struct({
  maximumCommittedBatches: BoundedCommittedBatchesSchema,
  maximumResponseBytes: BoundedResponseBytesSchema,
  maximumModelSemanticWorkUnits: BoundedSemanticWorkSchema,
  maximumModelSemanticBytes: BoundedSemanticBytesSchema,
  maximumDependencyKeyExaminations: BoundedDependencyExaminationsSchema,
  maximumCanonicalDependencyBytes: BoundedCanonicalDependencyBytesSchema,
  maximumElapsedMilliseconds: BoundedElapsedMillisecondsSchema,
}).annotate(StrictStructOptions);
export type QuerySyncSourceReadBudgetV1 =
  typeof QuerySyncSourceReadBudgetV1Schema.Type;

export const QuerySyncSourceReadRequestV1Schema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  scopeUuid: ScopeUuidV1Schema,
  syncModelId: Schema.Literal(SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1),
  requestedSourceEpoch: ScopeEpochUuidV1Schema,
  requestedAfterCommitSeqExclusive: CommitSeqSchema,
  budget: QuerySyncSourceReadBudgetV1Schema,
}).annotate(StrictStructOptions);
export type QuerySyncSourceReadRequestV1 =
  typeof QuerySyncSourceReadRequestV1Schema.Type;

const QuerySyncSourceAppRowChangeV1Schema = Schema.Struct({
  ordinal: ChangeOrdinalSchema,
  tableId: CatalogTableIdSchema,
  rowId: AppRowIdHexV1Schema,
}).annotate(StrictStructOptions);

const QuerySyncSourceRelationChangeV1Schema = Schema.Struct({
  ordinal: ChangeOrdinalSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  direction: Schema.Literals(["incoming", "outgoing"]),
  endpointRowId: AppRowIdHexV1Schema,
}).annotate(StrictStructOptions);

export const QuerySyncSourceCommitV1Schema = Schema.Struct({
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  commitSeq: CommitSeqSchema,
  committedAtMilliseconds: CommittedAtMillisecondsSchema,
  appRowChanges: Schema.Array(QuerySyncSourceAppRowChangeV1Schema).check(
    Schema.isMaxLength(16_000),
  ),
  relationAdjacencyChanges: Schema.Array(
    QuerySyncSourceRelationChangeV1Schema,
  ).check(Schema.isMaxLength(16_000)),
}).annotate(StrictStructOptions);
export type QuerySyncSourceCommitV1 =
  typeof QuerySyncSourceCommitV1Schema.Type;

const CommonResponseFields = {
  codecVersion: Schema.Literal(1),
  scopeUuid: ScopeUuidV1Schema,
  syncModelId: Schema.Literal(SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1),
  requestedSourceEpoch: ScopeEpochUuidV1Schema,
  requestedAfterCommitSeqExclusive: CommitSeqSchema,
  currentSourceEpoch: ScopeEpochUuidV1Schema,
  observedLatestCommitSeq: CommitSeqSchema,
  replayableAfterCommitSeqExclusive: CommitSeqSchema,
  retainedFromCommitSeqInclusive: Schema.NullOr(CommitSeqSchema),
} as const;

const QuerySyncSourcePagePrefixV1Schema = Schema.Struct({
  ...CommonResponseFields,
  kind: Schema.Literal("page"),
  commits: Schema.Array(QuerySyncSourceCommitV1Schema).check(
    Schema.isMaxLength(MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1),
  ),
  readThroughCommitSeq: CommitSeqSchema,
  hasMore: Schema.Literal(true),
  authorityObservation: Schema.Null,
}).annotate(StrictStructOptions);

const QuerySyncSourcePageTerminalV1Schema = Schema.Struct({
  ...CommonResponseFields,
  kind: Schema.Literal("page"),
  commits: Schema.Array(QuerySyncSourceCommitV1Schema).check(
    Schema.isMaxLength(MAX_QUERY_SYNC_SOURCE_COMMITTED_BATCHES_V1),
  ),
  readThroughCommitSeq: CommitSeqSchema,
  hasMore: Schema.Literal(false),
  authorityObservation: ScopeSyncActiveHeadObservationV1Schema,
}).annotate(StrictStructOptions);

const QuerySyncSourceHistoryUnavailableV1Schema = Schema.Struct({
  ...CommonResponseFields,
  kind: Schema.Literal("historyUnavailable"),
}).annotate(StrictStructOptions);

const QuerySyncSourceEpochReplacedV1Schema = Schema.Struct({
  ...CommonResponseFields,
  kind: Schema.Literal("epochReplaced"),
}).annotate(StrictStructOptions);

const QuerySyncSourceCursorAheadV1Schema = Schema.Struct({
  ...CommonResponseFields,
  kind: Schema.Literal("cursorAhead"),
}).annotate(StrictStructOptions);

export const QuerySyncSourceReadResponseV1Schema = Schema.Union([
  QuerySyncSourcePagePrefixV1Schema,
  QuerySyncSourcePageTerminalV1Schema,
  QuerySyncSourceHistoryUnavailableV1Schema,
  QuerySyncSourceEpochReplacedV1Schema,
  QuerySyncSourceCursorAheadV1Schema,
]);
export type QuerySyncSourceReadResponseV1 =
  typeof QuerySyncSourceReadResponseV1Schema.Type;

export type QuerySyncSourceReadFailureV1 =
  | "authority"
  | "corruption"
  | "resource"
  | "timeout"
  | "sourceTransportBytes";

export interface QuerySyncSourceCodecSuccessV1<A> {
  readonly value: A;
  readonly bytes: Uint8Array;
}

export class QuerySyncSourceCodecV1Error extends Data.TaggedError(
  "QuerySyncSourceCodecV1Error",
)<{
  readonly operation:
    | "encodeRequest"
    | "decodeRequest"
    | "encodeResponse"
    | "decodeResponse"
    | "failureHeader"
    | "requiredAtLeastHeader";
  readonly reason:
    | "invalidInput"
    | "invalidBytes"
    | "invalidUtf8"
    | "invalidJson"
    | "nonCanonical"
    | "byteLimitExceeded";
  readonly observedBytes: number | null;
  readonly maximumBytes: number | null;
}> {}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const decodeRequestResult = Schema.decodeUnknownResult(
  QuerySyncSourceReadRequestV1Schema,
  StrictParseOptions,
);
const encodeRequestResult = Schema.encodeUnknownResult(
  QuerySyncSourceReadRequestV1Schema,
  StrictParseOptions,
);
const decodeResponseResult = Schema.decodeUnknownResult(
  QuerySyncSourceReadResponseV1Schema,
  StrictParseOptions,
);
const encodeResponseResult = Schema.encodeUnknownResult(
  QuerySyncSourceReadResponseV1Schema,
  StrictParseOptions,
);

export function encodeQuerySyncSourceReadRequestV1(
  value: unknown,
): Result.Result<
  QuerySyncSourceCodecSuccessV1<QuerySyncSourceReadRequestV1>,
  QuerySyncSourceCodecV1Error
> {
  return encodeProjection(
    "encodeRequest",
    value,
    decodeRequestResult,
    encodeRequestResult,
    MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
  );
}

export function decodeQuerySyncSourceReadRequestV1(
  bytes: unknown,
): Result.Result<
  QuerySyncSourceCodecSuccessV1<QuerySyncSourceReadRequestV1>,
  QuerySyncSourceCodecV1Error
> {
  return decodeProjection(
    "decodeRequest",
    bytes,
    decodeRequestResult,
    encodeRequestResult,
    MAX_QUERY_SYNC_SOURCE_REQUEST_BYTES_V1,
  );
}

export function encodeQuerySyncSourceReadResponseV1(
  value: unknown,
  maximumBytes: number,
): Result.Result<
  QuerySyncSourceCodecSuccessV1<QuerySyncSourceReadResponseV1>,
  QuerySyncSourceCodecV1Error
> {
  if (!validResponseMaximum(maximumBytes)) {
    return Result.fail(codecFailure(
      "encodeResponse",
      "invalidInput",
      null,
      MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1,
    ));
  }
  return encodeProjection(
    "encodeResponse",
    value,
    decodeResponseResult,
    encodeResponseResult,
    maximumBytes,
  );
}

export function decodeQuerySyncSourceReadResponseV1(
  bytes: unknown,
  maximumBytes: number,
): Result.Result<
  QuerySyncSourceCodecSuccessV1<QuerySyncSourceReadResponseV1>,
  QuerySyncSourceCodecV1Error
> {
  if (!validResponseMaximum(maximumBytes)) {
    return Result.fail(codecFailure(
      "decodeResponse",
      "invalidInput",
      null,
      MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1,
    ));
  }
  return decodeProjection(
    "decodeResponse",
    bytes,
    decodeResponseResult,
    encodeResponseResult,
    maximumBytes,
  );
}

export function encodeQuerySyncSourceReadFailureHeaderV1(
  value: unknown,
): Result.Result<QuerySyncSourceReadFailureV1, QuerySyncSourceCodecV1Error> {
  for (const failure of [
    "authority",
    "corruption",
    "resource",
    "timeout",
    "sourceTransportBytes",
  ] as const) {
    if (value === failure) return Result.succeed(failure);
  }
  return Result.fail(codecFailure(
    "failureHeader",
    "invalidInput",
    null,
    null,
  ));
}

export function decodeQuerySyncSourceReadFailureHeaderV1(
  value: unknown,
): Result.Result<QuerySyncSourceReadFailureV1, QuerySyncSourceCodecV1Error> {
  return encodeQuerySyncSourceReadFailureHeaderV1(value);
}

export function encodeQuerySyncSourceRequiredAtLeastHeaderV1(
  value: unknown,
): Result.Result<string, QuerySyncSourceCodecV1Error> {
  return isPositiveSafeInteger(value)
    ? Result.succeed(String(value))
    : Result.fail(codecFailure(
        "requiredAtLeastHeader",
        "invalidInput",
        null,
        null,
      ));
}

export function decodeQuerySyncSourceRequiredAtLeastHeaderV1(
  value: unknown,
): Result.Result<number, QuerySyncSourceCodecV1Error> {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return Result.fail(codecFailure(
      "requiredAtLeastHeader",
      "invalidInput",
      null,
      null,
    ));
  }
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed)
    ? Result.succeed(parsed)
    : Result.fail(codecFailure(
        "requiredAtLeastHeader",
        "invalidInput",
        null,
        null,
      ));
}

type CodecOperation = QuerySyncSourceCodecV1Error["operation"];
type Decoder<A> = (value: unknown) => Result.Result<A, unknown>;
type Encoder = (value: unknown) => Result.Result<unknown, unknown>;

function encodeProjection<A>(
  operation: CodecOperation,
  value: unknown,
  decode: Decoder<A>,
  encode: Encoder,
  maximumBytes: number,
): Result.Result<QuerySyncSourceCodecSuccessV1<A>, QuerySyncSourceCodecV1Error> {
  return Result.gen(function* () {
    const encoded = yield* encode(value).pipe(
      Result.mapError(() => codecFailure(
        operation,
        "invalidInput",
        null,
        maximumBytes,
      )),
      Result.flatMap(captureJson(operation, maximumBytes)),
    );
    const decoded = yield* decode(encoded).pipe(Result.mapError(() =>
      codecFailure(operation, "invalidInput", null, maximumBytes)
    ));
    const projected = canonicalBytes(encoded);
    if (projected.byteLength > maximumBytes) {
      return yield* Result.fail(codecFailure(
        operation,
        "byteLimitExceeded",
        projected.byteLength,
        maximumBytes,
      ));
    }
    return Object.freeze({ value: decoded, bytes: copyBytes(projected) });
  });
}

function decodeProjection<A>(
  operation: CodecOperation,
  input: unknown,
  decode: Decoder<A>,
  encode: Encoder,
  maximumBytes: number,
): Result.Result<QuerySyncSourceCodecSuccessV1<A>, QuerySyncSourceCodecV1Error> {
  return Result.gen(function* () {
    if (!isUint8Array(input)) {
      return yield* Result.fail(codecFailure(
        operation,
        "invalidBytes",
        null,
        maximumBytes,
      ));
    }
    const bytes = copyBytes(input);
    if (bytes.byteLength > maximumBytes) {
      return yield* Result.fail(codecFailure(
        operation,
        "byteLimitExceeded",
        bytes.byteLength,
        maximumBytes,
      ));
    }
    let text: string;
    try {
      text = UTF8_DECODER.decode(bytes);
    } catch {
      return yield* Result.fail(codecFailure(
        operation,
        "invalidUtf8",
        bytes.byteLength,
        maximumBytes,
      ));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return yield* Result.fail(codecFailure(
        operation,
        "invalidJson",
        bytes.byteLength,
        maximumBytes,
      ));
    }
    const decoded = yield* decode(parsed).pipe(Result.mapError(() =>
      codecFailure(operation, "invalidInput", bytes.byteLength, maximumBytes)
    ));
    const json = yield* encode(decoded).pipe(
      Result.mapError(() => codecFailure(
        operation,
        "invalidInput",
        bytes.byteLength,
        maximumBytes,
      )),
      Result.flatMap(captureJson(operation, maximumBytes)),
    );
    const reencoded = canonicalBytes(json);
    if (!bytesEqualFullScan(bytes, reencoded)) {
      return yield* Result.fail(codecFailure(
        operation,
        "nonCanonical",
        bytes.byteLength,
        maximumBytes,
      ));
    }
    return Object.freeze({ value: decoded, bytes });
  });
}

function captureJson(
  operation: CodecOperation,
  maximumBytes: number,
): (value: unknown) => Result.Result<Json, QuerySyncSourceCodecV1Error> {
  return value => isJson(value)
    ? Result.succeed(value)
    : Result.fail(codecFailure(
        operation,
        "invalidInput",
        null,
        maximumBytes,
      ));
}

function canonicalBytes(value: Json): Uint8Array {
  return UTF8_ENCODER.encode(encodeCanonicalJson(value, issue => {
    throw new Error(`Query-sync source JSON invariant: ${issue.reason}`);
  }));
}

function validResponseMaximum(value: number): boolean {
  return isPositiveSafeInteger(value) &&
    value <= MAX_QUERY_SYNC_SOURCE_RESPONSE_BYTES_V1;
}

function codecFailure(
  operation: CodecOperation,
  reason: QuerySyncSourceCodecV1Error["reason"],
  observedBytes: number | null,
  maximumBytes: number | null,
): QuerySyncSourceCodecV1Error {
  return new QuerySyncSourceCodecV1Error({
    operation,
    reason,
    observedBytes,
    maximumBytes,
  });
}
