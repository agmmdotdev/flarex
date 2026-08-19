import {
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import {
  copyFiniteDate,
  finiteDateMilliseconds,
} from "@flarex/utils/dates";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

import {
  CanonicalSuccessfulResultBytesV1Schema,
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import type { Json } from "flarex-protocol/json";
import {
  CommitSeqSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  type CommitSeq,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  type TransactionFunctionPathV1,
  type TransactionIdentityAccessPolicySha256V1,
  type TransactionRequestKeyV1,
  type TransactionRequestSha256V1,
} from "flarex-protocol/transaction-session";
import {
  decodeCanonicalFlarexValueEvidenceV1,
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  FlarexValueSha256V1Schema,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  fxSystemCommits,
  fxSystemIdempotency,
  fxSystemScopeClocks,
} from "./schema";

const decodeScopeUuidResult = Schema.decodeUnknownResult(ScopeUuidV1Schema);
const decodeRequestKeyResult = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);
const decodeIdentitySha256Result = Schema.decodeUnknownResult(
  TransactionIdentityAccessPolicySha256V1Schema,
);
const decodeFunctionPathResult = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeRequestSha256Result = Schema.decodeUnknownResult(
  TransactionRequestSha256V1Schema,
);
const decodeEpochUuidResult = Schema.decodeUnknownResult(
  ScopeEpochUuidV1Schema,
);

const LOOKUP_INPUT_KEYS = Object.freeze([
  "expectedFunctionPath",
  "expectedIdentityAccessPolicySha256",
  "expectedRequestSha256",
  "requestKey",
  "scopeUuid",
] as const);

export type CommittedPointOutcomeInputFailureReasonV1 =
  | "recordInvalid"
  | "scopeUuidInvalid"
  | "requestKeyInvalid"
  | "identityAccessPolicySha256Invalid"
  | "functionPathInvalid"
  | "requestSha256Invalid";

export type CommittedPointOutcomeMismatchV1 =
  | "identityAccessPolicySha256"
  | "functionPath"
  | "requestSha256";

export type CommittedPointOutcomeCorruptionReasonV1 =
  | "duplicateOutcome"
  | "outcomeRowInvalid"
  | "scopeClockMissing"
  | "scopeClockInvalid"
  | "commitTokenInvalid"
  | "commitTokenAheadOfClock"
  | "missingRetainedHeader"
  | "retainedHeaderInvalid"
  | "retainedHeaderEpochMismatch"
  | "resultStateInvalid"
  | "availableResultEvidenceInvalid"
  | "expiredResultEvidenceInvalid"
  | "resultCanonicalEvidenceInvalid"
  | "resultSemanticSizeMismatch";

export class CommittedPointOutcomeInputErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeInputErrorV1",
)<{
  readonly reason: CommittedPointOutcomeInputFailureReasonV1;
}> {}

export class CommittedPointOutcomeRequestKeyReuseErrorV1
  extends Data.TaggedError("CommittedPointOutcomeRequestKeyReuseErrorV1")<{
    readonly scopeUuid: ScopeUuidV1;
    readonly mismatches: ReadonlyArray<CommittedPointOutcomeMismatchV1>;
  }> {}

export class CommittedPointOutcomeCorruptionErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeCorruptionErrorV1",
)<{
  readonly scopeUuid: ScopeUuidV1;
  readonly reason: CommittedPointOutcomeCorruptionReasonV1;
  readonly commitSeq?: CommitSeq;
}> {}

export class CommittedPointOutcomeSqlErrorV1 extends Data.TaggedError(
  "CommittedPointOutcomeSqlErrorV1",
)<{
  readonly operation: "resolve";
  readonly cause: unknown;
}> {}

export type ResolveCommittedPointOutcomeErrorV1 =
  | CommittedPointOutcomeInputErrorV1
  | CommittedPointOutcomeRequestKeyReuseErrorV1
  | CommittedPointOutcomeCorruptionErrorV1
  | CommittedPointOutcomeSqlErrorV1;

/**
 * Closed lookup evidence only. This record is not commit authority; the
 * eventual production caller must derive it from authenticated provenance.
 */
export interface ResolveCommittedPointOutcomeInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly requestKey: TransactionRequestKeyV1;
  readonly expectedIdentityAccessPolicySha256:
    TransactionIdentityAccessPolicySha256V1;
  readonly expectedFunctionPath: TransactionFunctionPathV1;
  readonly expectedRequestSha256: TransactionRequestSha256V1;
}

export interface CommittedPointOutcomeTokenV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
}

export interface CommittedPointSuccessfulResultV1 {
  readonly valueCodecVersion: FlarexValueCodecVersion;
  readonly valueJson: Json;
  readonly semanticSizeBytes: number;
  readonly canonicalText: string;
  readonly canonicalBytes:
    typeof CanonicalSuccessfulResultBytesV1Schema.Type;
  readonly sha256: FlarexValueSha256V1;
}

export type CommittedPointOutcomeResolutionV1 =
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
      readonly kind: "available";
      readonly token: CommittedPointOutcomeTokenV1;
      readonly successfulResult: CommittedPointSuccessfulResultV1;
    }>
  | Readonly<{
      readonly kind: "expired";
      readonly token: CommittedPointOutcomeTokenV1;
    }>;

export interface CommittedPointOutcomeResolverV1 {
  readonly resolve: (
    input: ResolveCommittedPointOutcomeInputV1,
  ) => Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    ResolveCommittedPointOutcomeErrorV1
  >;
}

export interface CommittedPointOutcomeResolverQueryV1 {
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

export interface CommittedPointOutcomeResolverOptionsV1 {
  /** Test-only observation of the one bounded statement. */
  readonly observeQuery?: (
    query: CommittedPointOutcomeResolverQueryV1,
  ) => void;
  /** Test-only proof point after the statement has settled. */
  readonly afterStatement?: () => void | Promise<void>;
  /** Test-only proof point immediately before canonical result verification. */
  readonly beforeResultVerification?: () => void;
}

interface ValidatedLookupInputV1 extends ResolveCommittedPointOutcomeInputV1 {}

/**
 * Package-internal scalar request evidence shared by the O07 resolver and
 * under-lock commit/retry decisions. It deliberately carries comparisons and
 * byte lengths rather than the stored digest bytes.
 */
export interface CommittedPointOutcomeRequestEvidenceV1 {
  readonly outcomeScopeUuid: unknown;
  readonly outcomeRequestKey: unknown;
  readonly identityHashByteLength: unknown;
  readonly identityMatches: unknown;
  readonly functionPathValid: unknown;
  readonly functionPathMatches: unknown;
  readonly requestHashByteLength: unknown;
  readonly requestMatches: unknown;
}

export interface CommittedPointOutcomeStoredScalarEvidenceV1
  extends CommittedPointOutcomeRequestEvidenceV1 {
  readonly epochUuid: unknown;
  readonly commitSeq: unknown;
  readonly resultState: unknown;
  readonly resultValueCodecVersion: unknown;
  readonly resultSemanticBytes: unknown;
  readonly resultByteLength: unknown;
  readonly resultSha256ByteLength: unknown;
  readonly resultExpiredAt: unknown;
  readonly createdAt: unknown;
  readonly retainedHeaderScopeUuid: unknown;
  readonly retainedHeaderEpochUuid: unknown;
  readonly retainedHeaderCommitSeq: unknown;
}

export interface CommittedPointOutcomeClockEvidenceV1 {
  readonly lastCommitSeq: bigint;
  readonly oldestAvailableCommitSeq: bigint;
}

export type ValidatedCommittedPointOutcomeStoredScalarsV1 =
  | Readonly<{
      readonly token: CommittedPointOutcomeTokenV1;
      readonly state: "available";
      readonly resultSemanticBytes: number;
      readonly resultByteLength: number;
    }>
  | Readonly<{
      readonly token: CommittedPointOutcomeTokenV1;
      readonly state: "expired";
    }>;

interface CapturedOutcomeRowV1
  extends CommittedPointOutcomeStoredScalarEvidenceV1 {
  readonly clockScopeUuid: unknown;
  readonly lastCommitSeq: unknown;
  readonly oldestAvailableCommitSeq: unknown;
  readonly boundedResultBytes: unknown;
  readonly boundedResultSha256: unknown;
}

export function validateCommittedPointOutcomeRequestEvidenceShapeV1(
  input: ResolveCommittedPointOutcomeInputV1,
  row: CommittedPointOutcomeRequestEvidenceV1,
): Result.Result<true, CommittedPointOutcomeCorruptionErrorV1> {
  if (
    row.outcomeScopeUuid !== input.scopeUuid ||
    row.outcomeRequestKey !== input.requestKey ||
    row.identityHashByteLength !== 32 ||
    row.requestHashByteLength !== 32 ||
    row.functionPathValid !== true ||
    typeof row.identityMatches !== "boolean" ||
    typeof row.functionPathMatches !== "boolean" ||
    typeof row.requestMatches !== "boolean"
  ) {
    return corruption(input, "outcomeRowInvalid");
  }
  return Result.succeed(true);
}

export function committedPointOutcomeRequestMismatchesV1(
  row: CommittedPointOutcomeRequestEvidenceV1,
): ReadonlyArray<CommittedPointOutcomeMismatchV1> {
  const mismatches: CommittedPointOutcomeMismatchV1[] = [];
  if (row.identityMatches !== true) {
    mismatches.push("identityAccessPolicySha256");
  }
  if (row.functionPathMatches !== true) mismatches.push("functionPath");
  if (row.requestMatches !== true) mismatches.push("requestSha256");
  return Object.freeze(mismatches);
}

/**
 * Validates stored outcome scalars after the caller has validated the shared
 * request-evidence shape and established its authoritative clock values.
 */
export function validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1(
  input: ResolveCommittedPointOutcomeInputV1,
  row: CommittedPointOutcomeStoredScalarEvidenceV1,
  clock: CommittedPointOutcomeClockEvidenceV1,
): Result.Result<
  ValidatedCommittedPointOutcomeStoredScalarsV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1 |
    CommittedPointOutcomeCorruptionErrorV1
> {
  return Result.gen(function* () {
    const epochUuid = yield* decodeEpochUuidResult(row.epochUuid).pipe(
      Result.mapError(() => corruptionError(input, "commitTokenInvalid")),
    );
    if (
      typeof row.commitSeq !== "bigint" ||
      row.commitSeq < 1n ||
      row.commitSeq > MAX_PERSISTED_SIGNED_INT64_V1
    ) {
      return yield* corruption(input, "commitTokenInvalid");
    }
    const commitSeq = CommitSeqSchema.make(row.commitSeq);
    if (commitSeq > clock.lastCommitSeq) {
      return yield* corruption(input, "commitTokenAheadOfClock", commitSeq);
    }
    const token = Object.freeze({
      scopeUuid: input.scopeUuid,
      epochUuid,
      commitSeq,
    } satisfies CommittedPointOutcomeTokenV1);

    const headerAbsent =
      row.retainedHeaderScopeUuid === null &&
      row.retainedHeaderEpochUuid === null &&
      row.retainedHeaderCommitSeq === null;
    if (headerAbsent) {
      if (
        clock.oldestAvailableCommitSeq === 0n ||
        commitSeq >= clock.oldestAvailableCommitSeq
      ) {
        return yield* corruption(input, "missingRetainedHeader", commitSeq);
      }
    } else {
      const headerEpoch = yield* decodeEpochUuidResult(
        row.retainedHeaderEpochUuid,
      ).pipe(
        Result.mapError(() =>
          corruptionError(input, "retainedHeaderInvalid", commitSeq),
        ),
      );
      if (
        row.retainedHeaderScopeUuid !== input.scopeUuid ||
        row.retainedHeaderCommitSeq !== commitSeq
      ) {
        return yield* corruption(input, "retainedHeaderInvalid", commitSeq);
      }
      if (headerEpoch !== token.epochUuid) {
        return yield* corruption(
          input,
          "retainedHeaderEpochMismatch",
          commitSeq,
        );
      }
    }

    const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
    if (createdAtMilliseconds === undefined) {
      return yield* corruption(input, "outcomeRowInvalid", commitSeq);
    }
    if (row.resultState !== "available" && row.resultState !== "expired") {
      return yield* corruption(input, "resultStateInvalid", commitSeq);
    }
    const resultSemanticBytes = row.resultSemanticBytes;
    const resultByteLength = row.resultByteLength;
    const resultExpiredAtMilliseconds = finiteDateMilliseconds(
      row.resultExpiredAt,
    );
    const availableScalarsValid =
      row.resultValueCodecVersion === FLAREX_VALUE_CODEC_VERSION_V1 &&
      typeof resultSemanticBytes === "number" &&
      Number.isInteger(resultSemanticBytes) &&
      resultSemanticBytes >= 0 &&
      resultSemanticBytes <= MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 &&
      typeof resultByteLength === "number" &&
      Number.isInteger(resultByteLength) &&
      resultByteLength >= 1 &&
      resultByteLength <= MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1 &&
      row.resultSha256ByteLength === 32 &&
      row.resultExpiredAt === null;
    const expiredScalarsValid =
      row.resultValueCodecVersion === null &&
      row.resultSemanticBytes === null &&
      row.resultByteLength === null &&
      row.resultSha256ByteLength === null &&
      resultExpiredAtMilliseconds !== undefined &&
      resultExpiredAtMilliseconds >= createdAtMilliseconds;
    if (
      (row.resultState === "available" && !availableScalarsValid) ||
      (row.resultState === "expired" && !expiredScalarsValid)
    ) {
      return yield* corruption(
        input,
        row.resultState === "available"
          ? "availableResultEvidenceInvalid"
          : "expiredResultEvidenceInvalid",
        commitSeq,
      );
    }

    const mismatches = committedPointOutcomeRequestMismatchesV1(row);
    if (mismatches.length > 0) {
      return yield* Result.fail(
        new CommittedPointOutcomeRequestKeyReuseErrorV1({
          scopeUuid: input.scopeUuid,
          mismatches: Object.freeze(mismatches),
        }),
      );
    }

    if (row.resultState === "expired") {
      return Object.freeze({ token, state: "expired" as const });
    }
    if (
      typeof resultSemanticBytes !== "number" ||
      typeof resultByteLength !== "number"
    ) {
      return yield* corruption(
        input,
        "availableResultEvidenceInvalid",
        commitSeq,
      );
    }
    return Object.freeze({
      token,
      state: "available" as const,
      resultSemanticBytes,
      resultByteLength,
    });
  });
}

interface ValidatedAvailableOutcomeRowV1 {
  readonly token: CommittedPointOutcomeTokenV1;
  readonly state: "available";
  readonly resultSemanticBytes: number;
  readonly boundedResultBytes: Uint8Array;
  readonly boundedResultSha256: Uint8Array;
}

interface ValidatedExpiredOutcomeRowV1 {
  readonly token: CommittedPointOutcomeTokenV1;
  readonly state: "expired";
}

type ValidatedOutcomeRowV1 =
  | ValidatedAvailableOutcomeRowV1
  | ValidatedExpiredOutcomeRowV1;

export function createCommittedPointOutcomeResolverV1(
  db: FlarexMetadataDatabase,
  options: CommittedPointOutcomeResolverOptionsV1 = {},
): CommittedPointOutcomeResolverV1 {
  const executeStatement = Effect.fn("CommittedPointOutcome.executeStatement")(
    (
      query: OutcomeQueryV1,
    ): Effect.Effect<
      ReadonlyArray<CapturedOutcomeRowV1>,
      CommittedPointOutcomeSqlErrorV1
    > =>
      Effect.uninterruptible(
        Effect.tryPromise({
          try: () => query,
          catch: (cause) => new CommittedPointOutcomeSqlErrorV1({
            operation: "resolve",
            cause,
          }),
        }),
      ),
  );

  const resolve = Effect.fn("CommittedPointOutcome.resolve")(function* (
    rawInput: ResolveCommittedPointOutcomeInputV1,
  ): Effect.fn.Return<
    CommittedPointOutcomeResolutionV1,
    ResolveCommittedPointOutcomeErrorV1
  > {
    const input = yield* Effect.fromResult(validateAndCaptureInput(rawInput));
    const query = buildOutcomeQuery(db, input);
    observeOutcomeQuery(query, options.observeQuery);
    const capturedRows = yield* executeStatement(query);
    if (options.afterStatement !== undefined) {
      yield* Effect.promise(() => Promise.resolve(options.afterStatement?.()));
    }
    const rows = detachOutcomeRows(capturedRows);
    const validated = yield* Effect.fromResult(
      validateCapturedOutcome(input, rows),
    );
    if (validated === null) return Object.freeze({ kind: "missing" });
    if (validated.state === "expired") {
      return Object.freeze({ kind: "expired", token: validated.token });
    }
    options.beforeResultVerification?.();
    const canonical = yield* verifyCanonicalResult(
      input,
      validated.token,
      validated.boundedResultBytes,
      validated.boundedResultSha256,
    );
    if (canonical.semanticSizeBytes !== validated.resultSemanticBytes) {
      return yield* corruptionEffect(
        input,
        "resultSemanticSizeMismatch",
        validated.token.commitSeq,
      );
    }

    const stableBytes = CanonicalSuccessfulResultBytesV1Schema.make(
      copyBytes(canonical.canonicalBytes),
    );
    const stableSha256 = FlarexValueSha256V1Schema.make(
      copyBytes(canonical.sha256),
    );
    const successfulResult = Object.freeze({
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      valueJson: canonical.valueJson,
      semanticSizeBytes: canonical.semanticSizeBytes,
      canonicalText: canonical.canonicalText,
      get canonicalBytes() {
        return CanonicalSuccessfulResultBytesV1Schema.make(
          copyBytes(stableBytes),
        );
      },
      get sha256() {
        return FlarexValueSha256V1Schema.make(copyBytes(stableSha256));
      },
    } satisfies CommittedPointSuccessfulResultV1);
    return Object.freeze({
      kind: "available",
      token: validated.token,
      successfulResult,
    });
  });

  return Object.freeze({ resolve });
}

function validateAndCaptureInput(
  input: ResolveCommittedPointOutcomeInputV1,
): Result.Result<ValidatedLookupInputV1, CommittedPointOutcomeInputErrorV1> {
  const prototype = isNonArrayRecord(input)
    ? Object.getPrototypeOf(input)
    : undefined;
  if (
    !isNonArrayRecord(input) ||
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(input).length !== 0 ||
    Object.getOwnPropertyNames(input).toSorted().join("\u0000") !==
      LOOKUP_INPUT_KEYS.join("\u0000") ||
    LOOKUP_INPUT_KEYS.some((key) =>
      dataPropertyValue(input, key) === INVALID_DATA_PROPERTY
    )
  ) {
    return inputFailure("recordInvalid");
  }
  return Result.gen(function* () {
    const scopeUuid = yield* decodeScopeUuidResult(
      dataPropertyValue(input, "scopeUuid"),
    ).pipe(
      Result.mapError(() => inputError("scopeUuidInvalid")),
    );
    const requestKey = yield* decodeRequestKeyResult(
      dataPropertyValue(input, "requestKey"),
    ).pipe(
      Result.mapError(() => inputError("requestKeyInvalid")),
    );
    const identitySha256 = yield* decodeIdentitySha256Result(
      dataPropertyValue(input, "expectedIdentityAccessPolicySha256"),
    ).pipe(
      Result.mapError(() => inputError("identityAccessPolicySha256Invalid")),
    );
    const functionPath = yield* decodeFunctionPathResult(
      dataPropertyValue(input, "expectedFunctionPath"),
    ).pipe(
      Result.mapError(() => inputError("functionPathInvalid")),
    );
    const requestSha256 = yield* decodeRequestSha256Result(
      dataPropertyValue(input, "expectedRequestSha256"),
    ).pipe(
      Result.mapError(() => inputError("requestSha256Invalid")),
    );
    return Object.freeze({
      scopeUuid,
      requestKey,
      expectedIdentityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(
          copyBytes(identitySha256),
        ),
      expectedFunctionPath: functionPath,
      expectedRequestSha256: TransactionRequestSha256V1Schema.make(
        copyBytes(requestSha256),
      ),
    });
  });
}

const INVALID_DATA_PROPERTY = Symbol("InvalidCommittedOutcomeDataProperty");

function dataPropertyValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown | typeof INVALID_DATA_PROPERTY {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    return INVALID_DATA_PROPERTY;
  }
  const value: unknown = descriptor.value;
  return value;
}

function inputFailure(
  reason: CommittedPointOutcomeInputFailureReasonV1,
): Result.Result<never, CommittedPointOutcomeInputErrorV1> {
  return Result.fail(inputError(reason));
}

function inputError(
  reason: CommittedPointOutcomeInputFailureReasonV1,
): CommittedPointOutcomeInputErrorV1 {
  return new CommittedPointOutcomeInputErrorV1({ reason });
}

function buildOutcomeQuery(
  db: FlarexMetadataDatabase,
  input: ValidatedLookupInputV1,
) {
  const transferableResult = sql`
    ${fxSystemIdempotency.resultState} = 'available'
    and ${fxSystemIdempotency.identityAccessPolicySha256} =
      ${input.expectedIdentityAccessPolicySha256}
    and ${fxSystemIdempotency.functionPath} = ${input.expectedFunctionPath}
    and ${fxSystemIdempotency.requestSha256} = ${input.expectedRequestSha256}
    and ${fxSystemIdempotency.resultValueCodecVersion} = 1
    and ${fxSystemIdempotency.resultSemanticBytes}
      between 0 and ${MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1}
    and octet_length(${fxSystemIdempotency.resultBytes})
      between 1 and ${MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1}
    and octet_length(${fxSystemIdempotency.resultSha256}) = 32
    and ${fxSystemIdempotency.resultExpiredAt} is null
    and isfinite(${fxSystemIdempotency.createdAt})
    and ${fxSystemScopeClocks.scopeUuid} = ${fxSystemIdempotency.scopeUuid}
    and ${fxSystemScopeClocks.lastCommitSeq} between 0 and
      ${MAX_PERSISTED_SIGNED_INT64_V1}
    and ${fxSystemScopeClocks.oldestAvailableCommitSeq} between 0 and
      ${fxSystemScopeClocks.lastCommitSeq}
    and ${fxSystemIdempotency.commitSeq} between 1 and
      ${fxSystemScopeClocks.lastCommitSeq}
    and (
      (
        ${fxSystemCommits.scopeUuid} = ${fxSystemIdempotency.scopeUuid}
        and ${fxSystemCommits.commitSeq} = ${fxSystemIdempotency.commitSeq}
        and ${fxSystemCommits.epochUuid} = ${fxSystemIdempotency.epochUuid}
      )
      or (
        ${fxSystemCommits.scopeUuid} is null
        and ${fxSystemCommits.commitSeq} is null
        and ${fxSystemCommits.epochUuid} is null
        and ${fxSystemScopeClocks.oldestAvailableCommitSeq} > 0
        and ${fxSystemIdempotency.commitSeq} <
          ${fxSystemScopeClocks.oldestAvailableCommitSeq}
      )
    )
  `;
  return db
    .select({
      outcomeScopeUuid: fxSystemIdempotency.scopeUuid,
      outcomeRequestKey: fxSystemIdempotency.requestKey,
      identityHashByteLength: sql<number>`
        octet_length(${fxSystemIdempotency.identityAccessPolicySha256})
      `,
      identityMatches: sql<boolean>`
        ${fxSystemIdempotency.identityAccessPolicySha256} =
          ${input.expectedIdentityAccessPolicySha256}
      `,
      functionPathValid: sql<boolean>`
        btrim(
          ${fxSystemIdempotency.functionPath},
          U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff'
        ) <> ''
      `,
      functionPathMatches: sql<boolean>`
        ${fxSystemIdempotency.functionPath} = ${input.expectedFunctionPath}
      `,
      requestHashByteLength: sql<number>`
        octet_length(${fxSystemIdempotency.requestSha256})
      `,
      requestMatches: sql<boolean>`
        ${fxSystemIdempotency.requestSha256} = ${input.expectedRequestSha256}
      `,
      epochUuid: fxSystemIdempotency.epochUuid,
      commitSeq: fxSystemIdempotency.commitSeq,
      resultState: fxSystemIdempotency.resultState,
      resultValueCodecVersion: fxSystemIdempotency.resultValueCodecVersion,
      resultSemanticBytes: fxSystemIdempotency.resultSemanticBytes,
      resultByteLength: sql<number | null>`
        case when ${fxSystemIdempotency.resultBytes} is null then null
          else octet_length(${fxSystemIdempotency.resultBytes}) end
      `,
      resultSha256ByteLength: sql<number | null>`
        case when ${fxSystemIdempotency.resultSha256} is null then null
          else octet_length(${fxSystemIdempotency.resultSha256}) end
      `,
      resultExpiredAt: fxSystemIdempotency.resultExpiredAt,
      createdAt: fxSystemIdempotency.createdAt,
      clockScopeUuid: fxSystemScopeClocks.scopeUuid,
      lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
      oldestAvailableCommitSeq:
        fxSystemScopeClocks.oldestAvailableCommitSeq,
      retainedHeaderScopeUuid: fxSystemCommits.scopeUuid,
      retainedHeaderEpochUuid: fxSystemCommits.epochUuid,
      retainedHeaderCommitSeq: fxSystemCommits.commitSeq,
      boundedResultBytes: sql<Uint8Array | null>`
        case when ${transferableResult}
          then ${fxSystemIdempotency.resultBytes} else null end
      `,
      boundedResultSha256: sql<Uint8Array | null>`
        case when ${transferableResult}
          then ${fxSystemIdempotency.resultSha256} else null end
      `,
    })
    .from(fxSystemIdempotency)
    .leftJoin(
      fxSystemScopeClocks,
      eq(fxSystemScopeClocks.scopeUuid, fxSystemIdempotency.scopeUuid),
    )
    .leftJoin(
      fxSystemCommits,
      and(
        eq(fxSystemCommits.scopeUuid, fxSystemIdempotency.scopeUuid),
        eq(fxSystemCommits.commitSeq, fxSystemIdempotency.commitSeq),
      ),
    )
    .where(and(
      eq(fxSystemIdempotency.scopeUuid, input.scopeUuid),
      eq(fxSystemIdempotency.requestKey, input.requestKey),
    ))
    .limit(2);
}

type OutcomeQueryV1 = ReturnType<typeof buildOutcomeQuery>;

function observeOutcomeQuery(
  query: OutcomeQueryV1,
  observe: CommittedPointOutcomeResolverOptionsV1["observeQuery"],
): void {
  if (observe === undefined) return;
  const compiled = query.toSQL();
  observe(Object.freeze({
    sql: compiled.sql,
    params: Object.freeze(structuredClone(compiled.params)),
  }));
}

function detachOutcomeRows(
  rows: ReadonlyArray<CapturedOutcomeRowV1>,
): ReadonlyArray<CapturedOutcomeRowV1> {
  return Object.freeze(rows.map((row) => Object.freeze({
    outcomeScopeUuid: row.outcomeScopeUuid,
    outcomeRequestKey: row.outcomeRequestKey,
    identityHashByteLength: row.identityHashByteLength,
    identityMatches: row.identityMatches,
    functionPathValid: row.functionPathValid,
    functionPathMatches: row.functionPathMatches,
    requestHashByteLength: row.requestHashByteLength,
    requestMatches: row.requestMatches,
    epochUuid: row.epochUuid,
    commitSeq: row.commitSeq,
    resultState: row.resultState,
    resultValueCodecVersion: row.resultValueCodecVersion,
    resultSemanticBytes: row.resultSemanticBytes,
    resultByteLength: row.resultByteLength,
    resultSha256ByteLength: row.resultSha256ByteLength,
    resultExpiredAt: detachDriverValue(row.resultExpiredAt),
    createdAt: detachDriverValue(row.createdAt),
    clockScopeUuid: row.clockScopeUuid,
    lastCommitSeq: row.lastCommitSeq,
    oldestAvailableCommitSeq: row.oldestAvailableCommitSeq,
    retainedHeaderScopeUuid: row.retainedHeaderScopeUuid,
    retainedHeaderEpochUuid: row.retainedHeaderEpochUuid,
    retainedHeaderCommitSeq: row.retainedHeaderCommitSeq,
    boundedResultBytes: detachDriverValue(row.boundedResultBytes),
    boundedResultSha256: detachDriverValue(row.boundedResultSha256),
  })));
}

function detachDriverValue(value: unknown): unknown {
  if (isUint8Array(value)) return copyBytes(value);
  if (value instanceof Date) {
    return copyFiniteDate(value) ?? new Date(Number.NaN);
  }
  return value;
}

function validateCapturedOutcome(
  input: ValidatedLookupInputV1,
  rows: ReadonlyArray<CapturedOutcomeRowV1>,
): Result.Result<
  ValidatedOutcomeRowV1 | null,
  CommittedPointOutcomeRequestKeyReuseErrorV1 |
    CommittedPointOutcomeCorruptionErrorV1
> {
  return Result.gen(function* () {
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      return yield* corruption(input, "duplicateOutcome");
    }
    const row = rows[0];
    if (row === undefined) return yield* corruption(input, "outcomeRowInvalid");
    yield* validateCommittedPointOutcomeRequestEvidenceShapeV1(input, row);
    if (row.clockScopeUuid === null) {
      if (row.lastCommitSeq !== null || row.oldestAvailableCommitSeq !== null) {
        return yield* corruption(input, "scopeClockInvalid");
      }
      return yield* corruption(input, "scopeClockMissing");
    }
    if (
      row.clockScopeUuid !== input.scopeUuid ||
      typeof row.lastCommitSeq !== "bigint" ||
      row.lastCommitSeq < 0n ||
      row.lastCommitSeq > MAX_PERSISTED_SIGNED_INT64_V1 ||
      typeof row.oldestAvailableCommitSeq !== "bigint" ||
      row.oldestAvailableCommitSeq < 0n ||
      row.oldestAvailableCommitSeq > row.lastCommitSeq
    ) {
      return yield* corruption(input, "scopeClockInvalid");
    }
    const scalars =
      yield* validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1(
        input,
        row,
        Object.freeze({
          lastCommitSeq: row.lastCommitSeq,
          oldestAvailableCommitSeq: row.oldestAvailableCommitSeq,
        }),
      );
    const token = scalars.token;
    const commitSeq = token.commitSeq;
    if (scalars.state === "expired") {
      if (
        row.boundedResultBytes !== null ||
        row.boundedResultSha256 !== null
      ) {
        return yield* corruption(
          input,
          "expiredResultEvidenceInvalid",
          commitSeq,
        );
      }
      return Object.freeze({
        token,
        state: "expired",
      } satisfies ValidatedExpiredOutcomeRowV1);
    }
    if (
      !isUint8ArrayWithByteLength(
        row.boundedResultBytes,
        scalars.resultByteLength,
      ) ||
      !isUint8ArrayWithByteLength(row.boundedResultSha256, 32)
    ) {
      return yield* corruption(
        input,
        "availableResultEvidenceInvalid",
        commitSeq,
      );
    }
    return Object.freeze({
      token,
      state: "available",
      resultSemanticBytes: scalars.resultSemanticBytes,
      boundedResultBytes: row.boundedResultBytes,
      boundedResultSha256: row.boundedResultSha256,
    } satisfies ValidatedAvailableOutcomeRowV1);
  });
}

const verifyCanonicalResult = Effect.fn(
  "CommittedPointOutcome.verifyCanonicalResult",
)(function* (
  input: ValidatedLookupInputV1,
  token: CommittedPointOutcomeTokenV1,
  canonicalBytes: unknown,
  sha256: unknown,
) {
  if (!isUint8Array(canonicalBytes) || !isUint8Array(sha256)) {
    return yield* corruptionEffect(
      input,
      "availableResultEvidenceInvalid",
      token.commitSeq,
    );
  }
  return yield* Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256,
    }),
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueEvidenceV1Error ||
      cause instanceof FlarexValueCodecV1Error
        ? corruptionEffect(
            input,
            "resultCanonicalEvidenceInvalid",
            token.commitSeq,
          )
        : Effect.die(cause),
    ),
  );
});

function corruption<A = never>(
  input: ValidatedLookupInputV1,
  reason: CommittedPointOutcomeCorruptionReasonV1,
  commitSeq?: CommitSeq,
): Result.Result<A, CommittedPointOutcomeCorruptionErrorV1> {
  return Result.fail(corruptionError(input, reason, commitSeq));
}

function corruptionEffect(
  input: ValidatedLookupInputV1,
  reason: CommittedPointOutcomeCorruptionReasonV1,
  commitSeq?: CommitSeq,
): Effect.Effect<never, CommittedPointOutcomeCorruptionErrorV1> {
  return Effect.fail(corruptionError(input, reason, commitSeq));
}

function corruptionError(
  input: ValidatedLookupInputV1,
  reason: CommittedPointOutcomeCorruptionReasonV1,
  commitSeq?: CommitSeq,
): CommittedPointOutcomeCorruptionErrorV1 {
  return new CommittedPointOutcomeCorruptionErrorV1({
    scopeUuid: input.scopeUuid,
    reason,
    ...(commitSeq === undefined ? {} : { commitSeq }),
  });
}
