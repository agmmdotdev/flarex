import {
  bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8Array,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result, Schema } from "effect";

import { AppRowIdHexV1Schema } from "./app-document-id";
import { CatalogTableIdSchema } from "./catalog";
import { isCanonicalIsoTimestamp } from "./iso-timestamp";
import { encodeCanonicalJson, JsonValue } from "./json";
import {
  CanonicalNonNegativePostgresBigIntFromString,
  CanonicalPositivePostgresBigIntFromString,
} from "./postgres-bigint";
import {
  CatalogSchemaVersionIdSchema,
  type SchemaManifestSha256,
} from "./schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeEpochV1Schema,
  ReplacementScopeIdV1Schema,
  StorageGenerationFenceSchema,
} from "./storage-authority";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

export const APP_SCHEMA_CANDIDATE_VALIDATION_CODEC_IDENTITY_V1 =
  "flarex.app-schema/candidate-validation/v1" as const;
export const APP_SCHEMA_CANDIDATE_VALIDATION_BUDGET_IDENTITY_V1 =
  "flarex.app-schema/candidate-validation-budget/v1" as const;

export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1 = 128;
export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_SEMANTIC_BYTES_V1 =
  8 * 1_024 * 1_024;
export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_SLICE_MILLISECONDS_V1 = 5_000;
export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1 = 16;
export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1 =
  64 * 1_024;
export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1 =
  128 * 1_024;
export const MAX_APP_SCHEMA_CANDIDATE_VALIDATION_VALIDATOR_PATH_BYTES_V1 =
  4_096;

export const APP_SCHEMA_CANDIDATE_VALIDATION_CEILINGS_V1 = Object.freeze({
  maximumRowsPerPage: MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1,
  maximumSemanticBytesPerPage:
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_SEMANTIC_BYTES_V1,
  maximumElapsedMillisecondsPerSlice:
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_SLICE_MILLISECONDS_V1,
  maximumFailureEntries:
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1,
  maximumFailureFrameBytes:
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1,
  maximumCanonicalFrameBytes:
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
  maximumValidatorPathBytes:
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_VALIDATOR_PATH_BYTES_V1,
});

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_CAPTURE_NODES = 512;

export const AppSchemaCandidateValidationCodecVersionV1Schema =
  Schema.Literal(1).pipe(
    Schema.brand("FlarexDB/AppSchemaCandidateValidationCodecVersionV1"),
  );
export type AppSchemaCandidateValidationCodecVersionV1 =
  typeof AppSchemaCandidateValidationCodecVersionV1Schema.Type;
export const APP_SCHEMA_CANDIDATE_VALIDATION_CODEC_VERSION_V1 =
  AppSchemaCandidateValidationCodecVersionV1Schema.make(1);

export const AppSchemaCandidateValidationAttemptFenceV1Schema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/AppSchemaCandidateValidationAttemptFenceV1"),
  );
export type AppSchemaCandidateValidationAttemptFenceV1 =
  typeof AppSchemaCandidateValidationAttemptFenceV1Schema.Type;

const ExactSha256HexSchema = Schema.String.check(
    Schema.makeFilter((value) =>
      /^[0-9a-f]{64}$/.test(value)
        ? undefined
        : "Expected an exact lowercase hexadecimal SHA-256 digest"
    ),
  );

export const AppSchemaCandidateManifestSha256HexV1Schema =
  ExactSha256HexSchema.pipe(
    Schema.brand("FlarexDB/AppSchemaCandidateManifestSha256HexV1"),
  );
export type AppSchemaCandidateManifestSha256HexV1 =
  typeof AppSchemaCandidateManifestSha256HexV1Schema.Type;

export const AppSchemaCandidateValidationFrameSha256HexV1Schema =
  ExactSha256HexSchema.pipe(
    Schema.brand("FlarexDB/AppSchemaCandidateValidationFrameSha256HexV1"),
  );
export type AppSchemaCandidateValidationFrameSha256HexV1 =
  typeof AppSchemaCandidateValidationFrameSha256HexV1Schema.Type;

export function appSchemaCandidateManifestSha256HexV1FromBytes(
  value: SchemaManifestSha256,
): AppSchemaCandidateManifestSha256HexV1 {
  return AppSchemaCandidateManifestSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(value),
  );
}

const BoundedSchemaVersionIdSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    value.length <= 1_024
      ? undefined
      : "Expected at most 1024 UTF-16 code units"
  ),
  Schema.makeFilter((value) =>
    utf8ByteLengthWithin(value, 1_024)
      ? undefined
      : "Expected at most 1024 UTF-8 bytes"
  ),
).pipe(Schema.decodeTo(CatalogSchemaVersionIdSchema));

const CanonicalSettledAtSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalIsoTimestamp(value)
      ? undefined
      : "Expected an exact ECMAScript ISO timestamp"
  ),
);

const ValidatorPathSchema = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter((value) =>
    utf8ByteLengthWithin(
      value,
      MAX_APP_SCHEMA_CANDIDATE_VALIDATION_VALIDATOR_PATH_BYTES_V1,
    )
      ? undefined
      : `Expected at most ${MAX_APP_SCHEMA_CANDIDATE_VALIDATION_VALIDATOR_PATH_BYTES_V1} UTF-8 bytes`
  ),
);

const CandidateIdentityFields = {
  codecVersion: AppSchemaCandidateValidationCodecVersionV1Schema,
  budgetIdentity: Schema.Literal(
    APP_SCHEMA_CANDIDATE_VALIDATION_BUDGET_IDENTITY_V1,
  ),
  scopeId: ReplacementScopeIdV1Schema,
  storageGeneration: FlarexDbV1StorageGenerationSchema,
  storageGenerationFence: StorageGenerationFenceSchema,
  scopeEpoch: ReplacementScopeEpochV1Schema,
  schemaVersionId: BoundedSchemaVersionIdSchema,
  schemaManifestSha256Hex: AppSchemaCandidateManifestSha256HexV1Schema,
  frontierCommitSeq: CommitSeqSchema,
  attemptFence: AppSchemaCandidateValidationAttemptFenceV1Schema,
} as const;

export const AppSchemaCandidateValidationCursorV1Schema = Schema.Struct({
  afterTableId: CatalogTableIdSchema,
  afterRowId: AppRowIdHexV1Schema,
}).annotate(StrictStructOptions);
export type AppSchemaCandidateValidationCursorV1 =
  typeof AppSchemaCandidateValidationCursorV1Schema.Type;

export const AppSchemaCandidateValidationProgressFrameV1Schema = Schema.Struct({
  kind: Schema.Literal("app_schema_candidate_validation_progress"),
  ...CandidateIdentityFields,
  progressSequence: CanonicalNonNegativePostgresBigIntFromString,
  previousProgressSha256Hex: Schema.Union([
    AppSchemaCandidateValidationFrameSha256HexV1Schema,
    Schema.Null,
  ]),
  cursor: Schema.Union([
    AppSchemaCandidateValidationCursorV1Schema,
    Schema.Null,
  ]),
  validatedRowCount: CanonicalNonNegativePostgresBigIntFromString,
  validatedPageCount: CanonicalNonNegativePostgresBigIntFromString,
  validatedSemanticBytes: CanonicalNonNegativePostgresBigIntFromString,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((frame) =>
    (frame.progressSequence === 0n)
      === (frame.previousProgressSha256Hex === null)
      ? undefined
      : "Expected only sequence zero to omit the predecessor progress digest"
  ),
  Schema.makeFilter(validatedTotalsBudgetIssue),
);
export type AppSchemaCandidateValidationProgressFrameV1 =
  typeof AppSchemaCandidateValidationProgressFrameV1Schema.Type;

export const AppSchemaCandidateValidationFailureSourceV1Schema =
  Schema.Literals(["snapshotScan", "pointCommit"]);
export type AppSchemaCandidateValidationFailureSourceV1 =
  typeof AppSchemaCandidateValidationFailureSourceV1Schema.Type;

export const AppSchemaCandidateValidationFailureReasonV1Schema =
  Schema.Literals(["candidateValidatorRejected", "candidateTableRemoved"]);
export type AppSchemaCandidateValidationFailureReasonV1 =
  typeof AppSchemaCandidateValidationFailureReasonV1Schema.Type;

export const AppSchemaCandidateValidationFailureEntryV1Schema = Schema.Struct({
  tableId: CatalogTableIdSchema,
  rowId: AppRowIdHexV1Schema,
  observedCommitSeq: CanonicalNonNegativePostgresBigIntFromString,
  source: AppSchemaCandidateValidationFailureSourceV1Schema,
  reason: AppSchemaCandidateValidationFailureReasonV1Schema,
  validatorPath: Schema.Union([ValidatorPathSchema, Schema.Null]),
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((entry) =>
    (entry.reason === "candidateValidatorRejected")
      === (entry.validatorPath !== null)
      ? undefined
      : "Expected validator evidence only for validator rejection"
  ),
);
export type AppSchemaCandidateValidationFailureEntryV1 =
  typeof AppSchemaCandidateValidationFailureEntryV1Schema.Type;

const FailureEntriesSchema = Schema.Array(
  AppSchemaCandidateValidationFailureEntryV1Schema,
).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1,
  ),
  Schema.makeFilter((entries) => {
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (
        previous === undefined
        || current === undefined
        || compareFailureEntries(previous, current) >= 0
      ) return "Expected strictly ordered unique failure evidence";
    }
    return undefined;
  }),
);

export const AppSchemaCandidateValidationFailureEvidenceFrameV1Schema =
  Schema.Struct({
    kind: Schema.Literal("app_schema_candidate_validation_failure_evidence"),
    ...CandidateIdentityFields,
    progressSha256Hex: AppSchemaCandidateValidationFrameSha256HexV1Schema,
    observedFailureCount: CanonicalPositivePostgresBigIntFromString,
    truncated: Schema.Boolean,
    entries: FailureEntriesSchema,
  }).annotate(StrictStructOptions).check(
    Schema.makeFilter((frame) => {
      const entryCount = BigInt(frame.entries.length);
      if (frame.observedFailureCount < entryCount) {
        return "Expected observed failure count to cover every evidence entry";
      }
      for (const entry of frame.entries) {
        if (
          entry.source === "snapshotScan"
            ? entry.observedCommitSeq > frame.frontierCommitSeq
            : entry.observedCommitSeq <= frame.frontierCommitSeq
        ) {
          return "Expected failure source to agree with the fixed scan frontier";
        }
      }
      return frame.truncated
        === (frame.observedFailureCount > entryCount)
        ? undefined
        : "Expected truncation to match omitted observed failures";
    }),
  );
export type AppSchemaCandidateValidationFailureEvidenceFrameV1 =
  typeof AppSchemaCandidateValidationFailureEvidenceFrameV1Schema.Type;

export const AppSchemaCandidateValidationReceiptFrameV1Schema = Schema.Struct({
  kind: Schema.Literal("app_schema_candidate_validation_receipt"),
  ...CandidateIdentityFields,
  finalProgressSha256Hex:
    AppSchemaCandidateValidationFrameSha256HexV1Schema,
  validatedRowCount: CanonicalNonNegativePostgresBigIntFromString,
  validatedPageCount: CanonicalNonNegativePostgresBigIntFromString,
  validatedSemanticBytes: CanonicalNonNegativePostgresBigIntFromString,
  settlementCommitSeq: CommitSeqSchema,
  scanCompleted: Schema.Literal(true),
  settledAt: CanonicalSettledAtSchema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((frame) =>
    frame.settlementCommitSeq >= frame.frontierCommitSeq
      ? undefined
      : "Expected settlement commit sequence at or beyond the scan frontier"
  ),
  Schema.makeFilter(validatedTotalsBudgetIssue),
);
export type AppSchemaCandidateValidationReceiptFrameV1 =
  typeof AppSchemaCandidateValidationReceiptFrameV1Schema.Type;

export const AppSchemaCandidateValidationFrameV1Schema = Schema.Union([
  AppSchemaCandidateValidationProgressFrameV1Schema,
  AppSchemaCandidateValidationFailureEvidenceFrameV1Schema,
  AppSchemaCandidateValidationReceiptFrameV1Schema,
]);
export type AppSchemaCandidateValidationFrameV1 =
  typeof AppSchemaCandidateValidationFrameV1Schema.Type;

export const CanonicalAppSchemaCandidateValidationFrameBytesV1Schema =
  Schema.Uint8Array.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(
      MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
    ),
  ).pipe(
    Schema.brand("FlarexDB/CanonicalAppSchemaCandidateValidationFrameBytesV1"),
  );
export type CanonicalAppSchemaCandidateValidationFrameBytesV1 =
  typeof CanonicalAppSchemaCandidateValidationFrameBytesV1Schema.Type;

export interface CanonicalAppSchemaCandidateValidationFrameV1 {
  readonly frame: AppSchemaCandidateValidationFrameV1;
  readonly canonicalText: string;
  readonly canonicalBytes: CanonicalAppSchemaCandidateValidationFrameBytesV1;
  readonly sha256Hex: AppSchemaCandidateValidationFrameSha256HexV1;
}

export type AppSchemaCandidateValidationCodecV1Component =
  | "frame"
  | "progress"
  | "failureEvidence"
  | "receipt";

export type AppSchemaCandidateValidationCodecV1LimitDimension =
  | "captureNodes"
  | "canonicalFrameBytes"
  | "failureEvidenceFrameBytes";

export type AppSchemaCandidateValidationCodecV1Issue =
  | Readonly<{
      readonly reason: "invalidInput" | "invalidSchema";
      readonly component: AppSchemaCandidateValidationCodecV1Component;
    }>
  | Readonly<{
      readonly reason: "invalidUtf8" | "invalidJson" | "nonCanonical"
        | "digestMismatch" | "digestUnavailable";
      readonly component: AppSchemaCandidateValidationCodecV1Component;
    }>
  | Readonly<{
      readonly reason: "limitExceeded";
      readonly component: AppSchemaCandidateValidationCodecV1Component;
      readonly dimension: AppSchemaCandidateValidationCodecV1LimitDimension;
      readonly observed: number;
      readonly maximum: number;
    }>;

export class AppSchemaCandidateValidationCodecV1Error extends Data.TaggedError(
  "AppSchemaCandidateValidationCodecV1Error",
)<{
  readonly issue: AppSchemaCandidateValidationCodecV1Issue;
}> {}

export interface DecodeCanonicalAppSchemaCandidateValidationFrameV1Input {
  readonly canonicalBytes: unknown;
  readonly expectedSha256Hex: unknown;
}

const DecodeCanonicalFrameInputSchema = Schema.Struct({
  canonicalBytes: Schema.Uint8Array.check(Schema.isMinLength(1)),
  expectedSha256Hex: AppSchemaCandidateValidationFrameSha256HexV1Schema,
}).annotate(StrictStructOptions);

const CanonicalEnvelopeSchema = Schema.Struct({
  format: Schema.Literal(APP_SCHEMA_CANDIDATE_VALIDATION_CODEC_IDENTITY_V1),
  frame: AppSchemaCandidateValidationFrameV1Schema,
}).annotate(StrictStructOptions);

const decodeFrameEffect = Schema.decodeUnknownEffect(
  Schema.toType(AppSchemaCandidateValidationFrameV1Schema),
  StrictParseOptions,
);
const encodeFrameEffect = Schema.encodeUnknownEffect(
  AppSchemaCandidateValidationFrameV1Schema,
  StrictParseOptions,
);
const decodeEnvelopeEffect = Schema.decodeUnknownEffect(
  CanonicalEnvelopeSchema,
  StrictParseOptions,
);
const decodeJsonValueEffect = Schema.decodeUnknownEffect(JsonValue);
const decodeCanonicalInputEffect = Schema.decodeUnknownEffect(
  DecodeCanonicalFrameInputSchema,
  StrictParseOptions,
);

export const canonicalizeAppSchemaCandidateValidationFrameV1Effect = Effect.fn(
  "AppSchemaCandidateValidation.canonicalizeFrameV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalAppSchemaCandidateValidationFrameV1,
  AppSchemaCandidateValidationCodecV1Error
> {
  const snapshot = yield* Effect.fromResult(snapshotPlainDataResult(input)).pipe(
    Effect.mapError((issue) => codecError(issue)),
  );
  const decoded = yield* decodeFrameEffect(snapshot).pipe(
    Effect.mapError(() => codecError({ reason: "invalidSchema", component: "frame" })),
  );
  const frame = freezeOwnedPlainData(decoded);
  const encodedFrame = yield* encodeFrameEffect(frame).pipe(
    Effect.mapError(() => codecError({ reason: "invalidSchema", component: frameComponent(frame) })),
  );
  const canonicalJson = yield* decodeJsonValueEffect({
    format: APP_SCHEMA_CANDIDATE_VALIDATION_CODEC_IDENTITY_V1,
    frame: encodedFrame,
  }).pipe(
    Effect.mapError(() => codecError({ reason: "invalidSchema", component: frameComponent(frame) })),
  );
  const canonicalText = encodeCanonicalJson(
    canonicalJson,
    canonicalJsonInvariantFailure,
  );
  const rawBytes = TEXT_ENCODER.encode(canonicalText);
  const component = frameComponent(frame);
  yield* enforceFrameByteLimitsEffect(component, rawBytes.byteLength);
  const stableBytes = copyBytes(rawBytes);
  const sha256Hex = yield* sha256HexEffect(stableBytes, component);
  return canonicalFrame(frame, canonicalText, stableBytes, sha256Hex);
});

export const decodeCanonicalAppSchemaCandidateValidationFrameV1Effect =
  Effect.fn("AppSchemaCandidateValidation.decodeCanonicalFrameV1")(
    function* (
      input: DecodeCanonicalAppSchemaCandidateValidationFrameV1Input,
    ): Effect.fn.Return<
      CanonicalAppSchemaCandidateValidationFrameV1,
      AppSchemaCandidateValidationCodecV1Error
    > {
      const snapshot = yield* Effect.fromResult(
        snapshotCanonicalDecodeInputResult(input),
      ).pipe(Effect.mapError((issue) => codecError(issue)));
      const decodedInput = yield* decodeCanonicalInputEffect(snapshot).pipe(
        Effect.mapError(() => codecError({ reason: "invalidInput", component: "frame" })),
      );
      const stableBytes = copyBytes(decodedInput.canonicalBytes);
      const parsed = yield* decodeUtf8JsonEffect(stableBytes);
      const envelope = yield* decodeEnvelopeEffect(parsed).pipe(
        Effect.mapError(() => codecError({ reason: "invalidSchema", component: "frame" })),
      );
      const canonical = yield*
        canonicalizeAppSchemaCandidateValidationFrameV1Effect(envelope.frame);
      const component = frameComponent(canonical.frame);
      if (!bytesEqual(stableBytes, canonical.canonicalBytes)) {
        return yield* Effect.fail(codecError({
          reason: "nonCanonical",
          component,
        }));
      }
      if (canonical.sha256Hex !== decodedInput.expectedSha256Hex) {
        return yield* Effect.fail(codecError({
          reason: "digestMismatch",
          component,
        }));
      }
      return canonical;
    },
  );

export type AppSchemaCandidateValidationOperationV1 =
  | "install"
  | "load"
  | "advance"
  | "settle"
  | "supersede";

export type AppSchemaCandidateValidationOperationFailureReasonV1 =
  | "corruption"
  | "superseded"
  | "interrupted"
  | "rollbackConfirmed"
  | "decisionUncertain";

export class AppSchemaCandidateValidationOperationV1Error
  extends Data.TaggedError("AppSchemaCandidateValidationOperationV1Error")<{
    readonly operation: AppSchemaCandidateValidationOperationV1;
    readonly reason: AppSchemaCandidateValidationOperationFailureReasonV1;
  }> {}

export type AppSchemaCandidateValidationRecoveryDispositionV1 =
  | "failClosed"
  | "obsolete"
  | "reloadBeforeRetry"
  | "retryAllowed"
  | "reconcileBeforeRetry";

export function appSchemaCandidateValidationRecoveryDispositionV1(
  reason: AppSchemaCandidateValidationOperationFailureReasonV1,
): AppSchemaCandidateValidationRecoveryDispositionV1 {
  switch (reason) {
    case "corruption":
      return "failClosed";
    case "superseded":
      return "obsolete";
    case "interrupted":
      return "reloadBeforeRetry";
    case "rollbackConfirmed":
      return "retryAllowed";
    case "decisionUncertain":
      return "reconcileBeforeRetry";
    default:
      return assertNever(reason);
  }
}

function frameComponent(
  frame: AppSchemaCandidateValidationFrameV1,
): Exclude<AppSchemaCandidateValidationCodecV1Component, "frame"> {
  switch (frame.kind) {
    case "app_schema_candidate_validation_progress":
      return "progress";
    case "app_schema_candidate_validation_failure_evidence":
      return "failureEvidence";
    case "app_schema_candidate_validation_receipt":
      return "receipt";
    default:
      return assertNever(frame);
  }
}

function compareFailureEntries(
  left: AppSchemaCandidateValidationFailureEntryV1,
  right: AppSchemaCandidateValidationFailureEntryV1,
): number {
  if (left.tableId !== right.tableId) return left.tableId - right.tableId;
  if (left.rowId !== right.rowId) return compareStrings(left.rowId, right.rowId);
  if (left.observedCommitSeq !== right.observedCommitSeq) {
    return left.observedCommitSeq < right.observedCommitSeq ? -1 : 1;
  }
  if (left.source !== right.source) return compareStrings(left.source, right.source);
  if (left.reason !== right.reason) return compareStrings(left.reason, right.reason);
  return compareStrings(left.validatorPath ?? "", right.validatorPath ?? "");
}

function validatedTotalsBudgetIssue(frame: {
  readonly validatedRowCount: bigint;
  readonly validatedPageCount: bigint;
  readonly validatedSemanticBytes: bigint;
}): string | undefined {
  if (
    frame.validatedRowCount
      > frame.validatedPageCount
        * BigInt(MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1)
  ) return "Expected validated row count to fit the page-count ceiling";
  if (
    frame.validatedSemanticBytes
      > frame.validatedPageCount
        * BigInt(MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_SEMANTIC_BYTES_V1)
  ) return "Expected validated semantic bytes to fit the page-count ceiling";
  return undefined;
}

function canonicalFrame(
  frame: AppSchemaCandidateValidationFrameV1,
  canonicalText: string,
  stableBytes: Uint8Array,
  sha256Hex: AppSchemaCandidateValidationFrameSha256HexV1,
): CanonicalAppSchemaCandidateValidationFrameV1 {
  return Object.freeze({
    frame,
    canonicalText,
    get canonicalBytes(): CanonicalAppSchemaCandidateValidationFrameBytesV1 {
      return CanonicalAppSchemaCandidateValidationFrameBytesV1Schema.make(
        copyBytes(stableBytes),
      );
    },
    sha256Hex,
  });
}

const enforceFrameByteLimitsEffect = Effect.fn(function* (
  component: Exclude<AppSchemaCandidateValidationCodecV1Component, "frame">,
  observed: number,
): Effect.fn.Return<void, AppSchemaCandidateValidationCodecV1Error> {
  if (
    component === "failureEvidence"
    && observed
      > MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1
  ) {
    return yield* Effect.fail(codecError({
      reason: "limitExceeded",
      component,
      dimension: "failureEvidenceFrameBytes",
      observed,
      maximum: MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1,
    }));
  }
  if (observed > MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1) {
    return yield* Effect.fail(codecError({
      reason: "limitExceeded",
      component,
      dimension: "canonicalFrameBytes",
      observed,
      maximum: MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
    }));
  }
});

const decodeUtf8JsonEffect = Effect.fn(function* (
  bytes: Uint8Array,
): Effect.fn.Return<unknown, AppSchemaCandidateValidationCodecV1Error> {
  const text = yield* Effect.try({
    try: () => TEXT_DECODER.decode(bytes),
    catch: () => codecError({ reason: "invalidUtf8", component: "frame" }),
  });
  return yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => codecError({ reason: "invalidJson", component: "frame" }),
  });
});

const sha256HexEffect = Effect.fn(function* (
  bytes: Uint8Array,
  component: Exclude<AppSchemaCandidateValidationCodecV1Component, "frame">,
): Effect.fn.Return<
  AppSchemaCandidateValidationFrameSha256HexV1,
  AppSchemaCandidateValidationCodecV1Error
> {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ),
    catch: () => codecError({ reason: "digestUnavailable", component }),
  });
  return AppSchemaCandidateValidationFrameSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(new Uint8Array(digest)),
  );
});

function snapshotPlainDataResult(
  input: unknown,
): Result.Result<unknown, AppSchemaCandidateValidationCodecV1Issue> {
  return snapshotPlainDataNodeResult(input, {
    remaining: MAX_CAPTURE_NODES,
    ancestors: new WeakSet<object>(),
  });
}

function snapshotCanonicalDecodeInputResult(
  input: unknown,
): Result.Result<unknown, AppSchemaCandidateValidationCodecV1Issue> {
  try {
    if (!isNonArrayRecord(input)) return Result.fail(invalidInputIssue());
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return Result.fail(invalidInputIssue());
    }
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== 2
      || !ownKeys.includes("canonicalBytes")
      || !ownKeys.includes("expectedSha256Hex")
    ) return Result.fail(invalidInputIssue());
    const bytesDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "canonicalBytes",
    );
    const digestDescriptor = Object.getOwnPropertyDescriptor(
      input,
      "expectedSha256Hex",
    );
    if (
      bytesDescriptor === undefined
      || !bytesDescriptor.enumerable
      || !("value" in bytesDescriptor)
      || !isUint8Array(bytesDescriptor.value)
      || digestDescriptor === undefined
      || !digestDescriptor.enumerable
      || !("value" in digestDescriptor)
    ) return Result.fail(invalidInputIssue());
    const byteLength = uint8ArrayByteLength(bytesDescriptor.value);
    if (byteLength === undefined) return Result.fail(invalidInputIssue());
    if (byteLength > MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1) {
      return Result.fail({
        reason: "limitExceeded",
        component: "frame",
        dimension: "canonicalFrameBytes",
        observed: byteLength,
        maximum: MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
      });
    }
    return Result.succeed({
      canonicalBytes: copyBytes(bytesDescriptor.value),
      expectedSha256Hex: digestDescriptor.value,
    });
  } catch {
    return Result.fail(invalidInputIssue());
  }
}

interface SnapshotState {
  remaining: number;
  readonly ancestors: WeakSet<object>;
}

function snapshotPlainDataNodeResult(
  input: unknown,
  state: SnapshotState,
): Result.Result<unknown, AppSchemaCandidateValidationCodecV1Issue> {
  if (state.remaining === 0) {
    return Result.fail({
      reason: "limitExceeded",
      component: "frame",
      dimension: "captureNodes",
      observed: MAX_CAPTURE_NODES + 1,
      maximum: MAX_CAPTURE_NODES,
    });
  }
  state.remaining -= 1;
  if (
    input === null
    || typeof input === "string"
    || typeof input === "boolean"
    || typeof input === "number"
    || typeof input === "bigint"
    || input === undefined
  ) return Result.succeed(input);
  if (isUint8Array(input)) return Result.fail(invalidInputIssue());
  if (typeof input !== "object" || state.ancestors.has(input)) {
    return Result.fail(invalidInputIssue());
  }

    state.ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      return Result.gen(function* () {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(
          input,
          "length",
        );
        if (
          lengthDescriptor === undefined
          || !("value" in lengthDescriptor)
          || typeof lengthDescriptor.value !== "number"
        ) return yield* Result.fail(invalidInputIssue());
        const length = lengthDescriptor.value;
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(
            input,
            String(index),
          );
          if (
            descriptor === undefined
            || !descriptor.enumerable
            || !("value" in descriptor)
          ) {
            return yield* Result.fail(invalidInputIssue());
          }
          output.push(yield* snapshotPlainDataNodeResult(
            descriptor.value,
            state,
          ));
        }
        const ownKeys = Reflect.ownKeys(input);
        if (ownKeys.length !== length + 1) {
          return yield* Result.fail(invalidInputIssue());
        }
        return output;
      });
    }
    if (!isNonArrayRecord(input)) {
      return Result.fail(invalidInputIssue());
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return Result.fail(invalidInputIssue());
    }
    return Result.gen(function* () {
      const output: Record<string, unknown> = Object.create(null);
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string") {
          return yield* Result.fail(invalidInputIssue());
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (
          descriptor === undefined
          || !descriptor.enumerable
          || !("value" in descriptor)
        ) {
          return yield* Result.fail(invalidInputIssue());
        }
        Object.defineProperty(output, key, {
          value: yield* snapshotPlainDataNodeResult(descriptor.value, state),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    });
  } catch {
    return Result.fail(invalidInputIssue());
  } finally {
    state.ancestors.delete(input);
  }
}

function freezeOwnedPlainData<T>(value: T): T {
  if (typeof value !== "object" || value === null || isUint8Array(value)) {
    return value;
  }
  for (const member of Object.values(value)) freezeOwnedPlainData(member);
  return Object.freeze(value);
}

function codecError(
  issue: AppSchemaCandidateValidationCodecV1Issue,
): AppSchemaCandidateValidationCodecV1Error {
  return new AppSchemaCandidateValidationCodecV1Error({ issue });
}

function invalidInputIssue(): AppSchemaCandidateValidationCodecV1Issue {
  return { reason: "invalidInput", component: "frame" };
}

function canonicalJsonInvariantFailure(): never {
  throw new Error("Owned candidate-validation JSON lost canonical structure.");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utf8ByteLengthWithin(value: string, maximum: number): boolean {
  return value.length <= maximum
    && TEXT_ENCODER.encode(value).byteLength <= maximum;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled candidate-validation variant: ${String(value)}`);
}
