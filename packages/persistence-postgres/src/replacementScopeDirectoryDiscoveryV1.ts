import { asNonArrayRecord } from "@flarex/utils/records";
import { sql, type SQL } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  ReplacementScopeIdV1Schema,
  ScopeIdSchema,
  type ReplacementScopeIdV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import { detachUnknownDriverRows } from "./detachDriverRows";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";

export const MAX_REPLACEMENT_SCOPE_DIRECTORY_DISCOVERY_LIMIT_V1 = 100;

export interface ReplacementScopeDirectoryContinuationV1 {
  readonly codecVersion: 1;
  readonly highWaterScopeId: ScopeId;
  readonly lastScopeId: ScopeId;
}

export interface ReplacementScopeDirectoryCandidateV1<DeploymentId = string> {
  readonly deploymentId: DeploymentId;
  readonly scopeId: ReplacementScopeIdV1;
}

export interface ReplacementScopeDirectoryPageV1<DeploymentId = string> {
  readonly candidates:
    ReadonlyArray<ReplacementScopeDirectoryCandidateV1<DeploymentId>>;
  readonly continuation: ReplacementScopeDirectoryContinuationV1 | null;
}

export type ReplacementScopeDirectoryInputReasonV1 =
  | "invalidInput"
  | "continuationOrderingInvalid";

export type ReplacementScopeDirectoryCorruptionReasonV1 =
  | "driverResultInvalid"
  | "metadataInvalid"
  | "candidateOverflow"
  | "candidateOrderingInvalid";

export interface ReplacementScopeDirectoryPolicyV1<DeploymentId, Failure> {
  readonly operationName: string;
  readonly input: (
    reason: ReplacementScopeDirectoryInputReasonV1,
    cause?: unknown,
  ) => Failure;
  readonly corruption: (
    reason: ReplacementScopeDirectoryCorruptionReasonV1,
    cause?: unknown,
  ) => Failure;
  readonly sql: (cause: unknown) => Failure;
  readonly decodeDeploymentId: (
    value: unknown,
  ) => Result.Result<DeploymentId, Failure>;
}

export interface ReplacementScopeDirectoryDiscoveryV1<DeploymentId, Failure> {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<ReplacementScopeDirectoryPageV1<DeploymentId>, Failure>;
}

const ReplacementScopeDirectoryContinuationSchema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  highWaterScopeId: ScopeIdSchema,
  lastScopeId: ScopeIdSchema,
});

const ReplacementScopeDirectoryInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({
    minimum: 1,
    maximum: MAX_REPLACEMENT_SCOPE_DIRECTORY_DISCOVERY_LIMIT_V1,
  })),
  continuation: Schema.optional(ReplacementScopeDirectoryContinuationSchema),
});

const decodeInputResult = Schema.decodeUnknownResult(
  ReplacementScopeDirectoryInputSchema,
  { onExcessProperty: "error" },
);
const decodeReplacementScopeDirectoryContinuationShapeV1 =
  Schema.decodeUnknownResult(
    ReplacementScopeDirectoryContinuationSchema,
    { onExcessProperty: "error" },
  );

export function decodeReplacementScopeDirectoryContinuationV1(
  input: unknown,
): Result.Result<
  ReplacementScopeDirectoryContinuationV1,
  ReplacementScopeDirectoryInputReasonV1
> {
  return decodeReplacementScopeDirectoryContinuationShapeV1(input).pipe(
    Result.mapError(() => "invalidInput" as const),
    Result.flatMap((continuation) =>
      continuation.lastScopeId <= continuation.highWaterScopeId
        ? Result.succeed(continuation)
        : Result.fail("continuationOrderingInvalid" as const)
    ),
  );
}
const decodeReplacementScopeIdResult = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);
const decodeScopeIdResult = Schema.decodeUnknownResult(ScopeIdSchema);
const INVALID_DRIVER_RESULT = Symbol("invalid replacement-scope directory driver result");

interface DecodedInputV1 {
  readonly limit: number;
  readonly continuation?: ReplacementScopeDirectoryContinuationV1 | undefined;
}

interface CapturedScopeRowsV1<DeploymentId> {
  readonly highWaterScopeId: ScopeId | null;
  readonly candidates:
    ReadonlyArray<ReplacementScopeDirectoryCandidateV1<DeploymentId>>;
  readonly hasMore: boolean;
  readonly lastScannedScopeId: ScopeId | null;
}

export function createReplacementScopeDirectoryDiscoveryV1<
  DeploymentId,
  Failure,
>(
  db: FlarexMetadataDatabase,
  policy: ReplacementScopeDirectoryPolicyV1<DeploymentId, Failure>,
): ReplacementScopeDirectoryDiscoveryV1<DeploymentId, Failure> {
  const operationName = policy.operationName;
  const inputError = policy.input;
  const corruptionError = policy.corruption;
  const sqlError = policy.sql;
  const decodeDeploymentId = policy.decodeDeploymentId;
  const capturedPolicy = Object.freeze({
    operationName,
    input: inputError,
    corruption: corruptionError,
    sql: sqlError,
    decodeDeploymentId,
  });
  const discoverEffect = Effect.fn(operationName)(function* (
    rawInput: unknown,
  ): Effect.fn.Return<ReplacementScopeDirectoryPageV1<DeploymentId>, Failure> {
    const input = yield* Effect.fromResult(
      decodeInputResult(rawInput).pipe(
        Result.mapError((cause) => inputError("invalidInput", cause)),
      ),
    );
    const continuation = input.continuation;
    const statement = buildReplacementScopeDirectoryDiscoveryStatementV1({
      limitPlusOne: input.limit + 1,
      ...(continuation === undefined ? {} : { continuation }),
    });
    const driverResult = yield* Effect.tryPromise({
      try: () => db.execute(statement),
      catch: sqlError,
    });
    const driverRows = yield* Effect.try({
      try: () => rowsFromDriverExecuteResult(driverResult, () => {
        throw INVALID_DRIVER_RESULT;
      }),
      catch: (cause) =>
        cause === INVALID_DRIVER_RESULT
          ? corruptionError("driverResultInvalid")
          : sqlError(cause),
    });
    const rows = yield* Effect.try({
      try: () => detachUnknownDriverRows(driverRows),
      catch: sqlError,
    });
    const captured = yield* Effect.fromResult(
      captureScopeRows(input, rows, capturedPolicy),
    );
    const nextContinuation =
      captured.hasMore && captured.lastScannedScopeId !== null &&
          captured.highWaterScopeId !== null
        ? Object.freeze({
          codecVersion: 1 as const,
          highWaterScopeId: captured.highWaterScopeId,
          lastScopeId: captured.lastScannedScopeId,
        })
        : null;

    return Object.freeze({
      candidates: Object.freeze(captured.candidates),
      continuation: nextContinuation,
    });
  });

  return Object.freeze({ discoverEffect });
}

export function buildReplacementScopeDirectoryDiscoveryStatementV1(
  input: Readonly<{
    readonly limitPlusOne: number;
    readonly continuation?: ReplacementScopeDirectoryContinuationV1;
  }>,
): SQL {
  const highWaterScopeId = input.continuation?.highWaterScopeId ?? null;
  const lastScopeId = input.continuation?.lastScopeId ?? null;
  return sql`
    with bounds as materialized (
      select coalesce(
        ${highWaterScopeId}::text,
        (
          select scope.id
          from fx_control_scope as scope
          order by scope.id desc
          limit 1
        )
      ) as high_water_scope_id,
      (
        ${highWaterScopeId}::text is null or
        ${lastScopeId}::text is null or
        ${lastScopeId}::text <= ${highWaterScopeId}::text
      ) as continuation_ordering_valid
    ), page_ids as materialized (
      select scope.id
      from fx_control_scope as scope
      cross join bounds
      where bounds.continuation_ordering_valid
        and bounds.high_water_scope_id is not null
        and scope.id <= bounds.high_water_scope_id
        and (${lastScopeId}::text is null or scope.id > ${lastScopeId})
      order by scope.id
      limit ${input.limitPlusOne}
    ), numbered_page_ids as materialized (
      select
        page_ids.id,
        (row_number() over (order by page_ids.id))::integer as scope_ordinal
      from page_ids
    )
    select
      bounds.high_water_scope_id,
      bounds.continuation_ordering_valid,
      scope.id as scope_id,
      scope.deployment_id,
      numbered_page_ids.scope_ordinal
    from bounds
    left join numbered_page_ids on true
    left join fx_control_scope as scope on scope.id = numbered_page_ids.id
    order by numbered_page_ids.scope_ordinal nulls last
  `;
}

function captureScopeRows<DeploymentId, Failure>(
  input: DecodedInputV1,
  rows: ReadonlyArray<unknown>,
  policy: ReplacementScopeDirectoryPolicyV1<DeploymentId, Failure>,
): Result.Result<CapturedScopeRowsV1<DeploymentId>, Failure> {
  return Result.gen(function* () {
    if (rows.length === 0 || rows.length > input.limit + 1) {
      return yield* Result.fail(policy.corruption(
        rows.length === 0 ? "metadataInvalid" : "candidateOverflow",
      ));
    }

    let highWaterScopeId: ScopeId | null | undefined;
    let lastScannedScopeId: ScopeId | null = null;
    const candidates: ReplacementScopeDirectoryCandidateV1<DeploymentId>[] = [];
    const scannedRows = rows.slice(0, input.limit);
    for (let index = 0; index < scannedRows.length; index += 1) {
      const capturedRow = yield* captureDirectoryRowResult({
        rawRow: scannedRows[index],
        expectedHighWaterScopeId: highWaterScopeId,
        expectedOrdinal: index + 1,
        isOnlyRow: rows.length === 1,
      }, policy);
      highWaterScopeId = capturedRow.highWaterScopeId;
      if (capturedRow.scopeId !== null) lastScannedScopeId = capturedRow.scopeId;
      if (capturedRow.candidate !== null) candidates.push(capturedRow.candidate);
    }

    if (highWaterScopeId === undefined) {
      return yield* Result.fail(policy.corruption("metadataInvalid"));
    }
    return Object.freeze({
      highWaterScopeId,
      candidates: Object.freeze(candidates),
      hasMore: rows.length > input.limit,
      lastScannedScopeId,
    });
  });
}

function captureDirectoryRowResult<DeploymentId, Failure>(
  input: Readonly<{
    readonly rawRow: unknown;
    readonly expectedHighWaterScopeId: ScopeId | null | undefined;
    readonly expectedOrdinal: number;
    readonly isOnlyRow: boolean;
  }>,
  policy: ReplacementScopeDirectoryPolicyV1<DeploymentId, Failure>,
): Result.Result<
  Readonly<{
    readonly highWaterScopeId: ScopeId | null;
    readonly scopeId: ScopeId | null;
    readonly candidate: ReplacementScopeDirectoryCandidateV1<DeploymentId> | null;
  }>,
  Failure
> {
  return Result.gen(function* () {
    const row = asNonArrayRecord(input.rawRow);
    if (row === null) {
      return yield* Result.fail(policy.corruption("metadataInvalid"));
    }
    const highWaterScopeId = yield* (
      row.high_water_scope_id === null
        ? Result.succeed(null)
        : decodeScopeIdResult(row.high_water_scope_id).pipe(
          Result.mapError((cause) => policy.corruption("metadataInvalid", cause)),
        )
    );
    if (
      input.expectedHighWaterScopeId !== undefined &&
      input.expectedHighWaterScopeId !== highWaterScopeId
    ) {
      return yield* Result.fail(policy.corruption("metadataInvalid"));
    }
    if (typeof row.continuation_ordering_valid !== "boolean") {
      return yield* Result.fail(policy.corruption("metadataInvalid"));
    }
    if (!row.continuation_ordering_valid) {
      return yield* Result.fail(policy.input("continuationOrderingInvalid"));
    }
    if (row.scope_id === null && row.deployment_id === null) {
      if (!input.isOnlyRow || row.scope_ordinal !== null) {
        return yield* Result.fail(policy.corruption("metadataInvalid"));
      }
      return Object.freeze({
        highWaterScopeId,
        scopeId: null,
        candidate: null,
      });
    }
    const scopeId = yield* decodeScopeIdResult(row.scope_id).pipe(
      Result.mapError((cause) => policy.corruption("metadataInvalid", cause)),
    );
    if (highWaterScopeId === null || row.scope_ordinal !== input.expectedOrdinal) {
      return yield* Result.fail(policy.corruption("candidateOrderingInvalid"));
    }
    const replacementScopeId = decodeReplacementScopeIdResult(scopeId);
    const candidate = yield* Result.match(replacementScopeId, {
      onFailure: () => Result.succeed(null),
      onSuccess: (validatedScopeId) =>
        policy.decodeDeploymentId(row.deployment_id).pipe(
          Result.map((deploymentId) =>
            Object.freeze({
              deploymentId,
              scopeId: validatedScopeId,
            })
          ),
        ),
    });
    return Object.freeze({
      highWaterScopeId,
      scopeId,
      candidate,
    });
  });
}
