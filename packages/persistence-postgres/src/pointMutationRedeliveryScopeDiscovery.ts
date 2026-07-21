import { asNonArrayRecord } from "@flarex/utils/records";
import { sql, type SQL } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

import {
  ReplacementScopeIdV1Schema,
  ScopeIdSchema,
  type ReplacementScopeIdV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";

import type { FlarexMetadataDatabase } from "./deployments";
import { detachUnknownDriverRows } from "./detachDriverRows";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";

export const MAX_POINT_MUTATION_REDELIVERY_SCOPE_DISCOVERY_LIMIT_V1 = 100;

/**
 * Pagination data only. Altering it can at most skip or repeat inert scope
 * hints. It grants no placement, claim, journal, lifecycle, or execution
 * authority.
 */
export interface PointMutationRedeliveryScopeDiscoveryContinuationV1 {
  readonly codecVersion: 1;
  readonly highWaterScopeId: ScopeId;
  readonly lastScopeId: ScopeId;
}

/**
 * An inert control-plane locator. Exact per-scope authority is resolved again
 * by point-attempt discovery and only locked C06-A acquisition may mint an
 * execution capability.
 */
export interface PointMutationRedeliveryScopeCandidateV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
}

export interface PointMutationRedeliveryScopeDiscoveryPageV1 {
  readonly candidates: ReadonlyArray<PointMutationRedeliveryScopeCandidateV1>;
  readonly continuation:
    | PointMutationRedeliveryScopeDiscoveryContinuationV1
    | null;
}

export interface PointMutationRedeliveryScopeDiscoveryV1 {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<
    PointMutationRedeliveryScopeDiscoveryPageV1,
    PointMutationRedeliveryScopeDiscoveryV1Error,
    never
  >;
}

export class PointMutationRedeliveryScopeDiscoveryInputV1Error
  extends Data.TaggedError(
    "PointMutationRedeliveryScopeDiscoveryInputV1Error",
  )<{
    readonly reason: "invalidInput" | "continuationOrderingInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationRedeliveryScopeDiscoveryCorruptionV1Error",
  )<{
    readonly reason:
      | "driverResultInvalid"
      | "metadataInvalid"
      | "candidateOverflow"
      | "candidateOrderingInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationRedeliveryScopeDiscoverySqlV1Error
  extends Data.TaggedError(
    "PointMutationRedeliveryScopeDiscoverySqlV1Error",
  )<{
    readonly operation: "discover";
    readonly cause: unknown;
  }> {}

export type PointMutationRedeliveryScopeDiscoveryV1Error =
  | PointMutationRedeliveryScopeDiscoveryInputV1Error
  | PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
  | PointMutationRedeliveryScopeDiscoverySqlV1Error;

const PointMutationRedeliveryScopeDiscoveryContinuationSchema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  highWaterScopeId: ScopeIdSchema,
  lastScopeId: ScopeIdSchema,
});

const PointMutationRedeliveryScopeDiscoveryInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({
    minimum: 1,
    maximum: MAX_POINT_MUTATION_REDELIVERY_SCOPE_DISCOVERY_LIMIT_V1,
  })),
  continuation: Schema.optional(
    PointMutationRedeliveryScopeDiscoveryContinuationSchema,
  ),
});

const decodeInputResult = Schema.decodeUnknownResult(
  PointMutationRedeliveryScopeDiscoveryInputSchema,
  { onExcessProperty: "error" },
);
const decodeReplacementScopeIdResult = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);
const decodeScopeIdResult = Schema.decodeUnknownResult(ScopeIdSchema);
const decodeDeploymentIdResult = Schema.decodeUnknownResult(
  TransactionGrantDeploymentIdV1Schema,
);

const INVALID_DRIVER_RESULT = Symbol("invalid redelivery scope driver result");
interface DecodedInputV1 {
  readonly limit: number;
  readonly continuation?:
    | PointMutationRedeliveryScopeDiscoveryContinuationV1
    | undefined;
}

interface CapturedScopeRowsV1 {
  readonly highWaterScopeId: ScopeId | null;
  readonly candidates: ReadonlyArray<PointMutationRedeliveryScopeCandidateV1>;
  readonly hasMore: boolean;
  readonly lastScannedScopeId: ScopeId | null;
}

export function createPointMutationRedeliveryScopeDiscoveryV1(
  db: FlarexMetadataDatabase,
): PointMutationRedeliveryScopeDiscoveryV1 {
  const discoverEffect = Effect.fn(
    "PointMutationRedeliveryScopeDiscovery.discover",
  )(function* (
    rawInput: unknown,
  ): Effect.fn.Return<
    PointMutationRedeliveryScopeDiscoveryPageV1,
    PointMutationRedeliveryScopeDiscoveryV1Error
  > {
    const input = yield* Effect.fromResult(
      decodeInputResult(rawInput).pipe(
        Result.mapError((cause) =>
          new PointMutationRedeliveryScopeDiscoveryInputV1Error({
            reason: "invalidInput",
            cause,
          })
        ),
      ),
    );
    const continuation = input.continuation;
    const statement = buildPointMutationRedeliveryScopeDiscoveryStatementV1({
      limitPlusOne: input.limit + 1,
      ...(continuation === undefined ? {} : { continuation }),
    });
    const driverResult = yield* Effect.tryPromise({
      try: () => db.execute(statement),
      catch: (cause) =>
        new PointMutationRedeliveryScopeDiscoverySqlV1Error({
          operation: "discover",
          cause,
        }),
    });
    const driverRows = yield* Effect.try({
      try: () => rowsFromDriverExecuteResult(driverResult, () => {
        throw INVALID_DRIVER_RESULT;
      }),
      catch: (cause) =>
        cause === INVALID_DRIVER_RESULT
          ? new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
            reason: "driverResultInvalid",
          })
          : new PointMutationRedeliveryScopeDiscoverySqlV1Error({
            operation: "discover",
            cause,
          }),
    });
    const rows = yield* Effect.try({
      try: () => detachUnknownDriverRows(driverRows),
      catch: (cause) =>
        new PointMutationRedeliveryScopeDiscoverySqlV1Error({
          operation: "discover",
          cause,
        }),
    });
    const captured = yield* Effect.fromResult(
      captureScopeRows(input, rows),
    );
    const candidates = captured.candidates;
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
      candidates: Object.freeze(candidates),
      continuation: nextContinuation,
    });
  });

  return Object.freeze({ discoverEffect });
}

export function buildPointMutationRedeliveryScopeDiscoveryStatementV1(
  input: Readonly<{
    readonly limitPlusOne: number;
    readonly continuation?:
      PointMutationRedeliveryScopeDiscoveryContinuationV1;
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

function captureScopeRows(
  input: DecodedInputV1,
  rows: ReadonlyArray<unknown>,
): Result.Result<
  CapturedScopeRowsV1,
  | PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
  | PointMutationRedeliveryScopeDiscoveryInputV1Error
> {
  return Result.gen(function* () {
    if (rows.length === 0 || rows.length > input.limit + 1) {
      return yield* Result.fail(
        new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
          reason: rows.length === 0
            ? "metadataInvalid"
            : "candidateOverflow",
        }),
      );
    }

    let highWaterScopeId: ScopeId | null | undefined;
    let lastScannedScopeId: ScopeId | null = null;
    const candidates: PointMutationRedeliveryScopeCandidateV1[] = [];
    const scannedRows = rows.slice(0, input.limit);
    for (let index = 0; index < scannedRows.length; index += 1) {
      const capturedRow = yield* captureDirectoryRowResult({
        rawRow: scannedRows[index],
        expectedHighWaterScopeId: highWaterScopeId,
        expectedOrdinal: index + 1,
        isOnlyRow: rows.length === 1,
      });
      highWaterScopeId = capturedRow.highWaterScopeId;
      if (capturedRow.scopeId !== null) {
        lastScannedScopeId = capturedRow.scopeId;
      }
      if (capturedRow.candidate !== null) {
        candidates.push(capturedRow.candidate);
      }
    }

    if (highWaterScopeId === undefined) return yield* metadataFailure();
    return Object.freeze({
      highWaterScopeId,
      candidates: Object.freeze(candidates),
      hasMore: rows.length > input.limit,
      lastScannedScopeId,
    });
  });
}

function captureDirectoryRowResult(input: Readonly<{
  readonly rawRow: unknown;
  readonly expectedHighWaterScopeId: ScopeId | null | undefined;
  readonly expectedOrdinal: number;
  readonly isOnlyRow: boolean;
}>): Result.Result<
  Readonly<{
    readonly highWaterScopeId: ScopeId | null;
    readonly scopeId: ScopeId | null;
    readonly candidate: PointMutationRedeliveryScopeCandidateV1 | null;
  }>,
  | PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
  | PointMutationRedeliveryScopeDiscoveryInputV1Error
> {
  return Result.gen(function* () {
    const row = asNonArrayRecord(input.rawRow);
    if (row === null) return yield* metadataFailure();
    const highWaterScopeId = yield* (
      row.high_water_scope_id === null
        ? Result.succeed(null)
        : decodeScopeIdResult(row.high_water_scope_id)
          .pipe(Result.mapError((cause) => metadataError(cause)))
    );
    if (
      input.expectedHighWaterScopeId !== undefined &&
      input.expectedHighWaterScopeId !== highWaterScopeId
    ) {
      return yield* metadataFailure();
    }
    if (typeof row.continuation_ordering_valid !== "boolean") {
      return yield* metadataFailure();
    }
    if (!row.continuation_ordering_valid) {
      return yield* Result.fail(
        new PointMutationRedeliveryScopeDiscoveryInputV1Error({
          reason: "continuationOrderingInvalid",
        }),
      );
    }
    if (row.scope_id === null && row.deployment_id === null) {
      if (!input.isOnlyRow || row.scope_ordinal !== null) {
        return yield* metadataFailure();
      }
      return Object.freeze({
        highWaterScopeId,
        scopeId: null,
        candidate: null,
      });
    }
    const scopeId = yield* decodeScopeIdResult(row.scope_id)
      .pipe(Result.mapError((cause) => metadataError(cause)));
    if (highWaterScopeId === null || row.scope_ordinal !== input.expectedOrdinal) {
      return yield* Result.fail(
        new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
          reason: "candidateOrderingInvalid",
        }),
      );
    }
    const replacementScopeId = decodeReplacementScopeIdResult(scopeId);
    if (Result.isFailure(replacementScopeId)) {
      return Object.freeze({
        highWaterScopeId,
        scopeId,
        candidate: null,
      });
    }
    const deploymentId = yield* decodeDeploymentIdResult(row.deployment_id)
      .pipe(Result.mapError((cause) => metadataError(cause)));
    return Object.freeze({
      highWaterScopeId,
      scopeId,
      candidate: Object.freeze({
        deploymentId,
        scopeId: replacementScopeId.success,
      }),
    });
  });
}

function metadataError(
  cause: unknown,
): PointMutationRedeliveryScopeDiscoveryCorruptionV1Error {
  return new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
    reason: "metadataInvalid",
    cause,
  });
}

function metadataFailure(
  cause?: unknown,
): Result.Result<
  never,
  PointMutationRedeliveryScopeDiscoveryCorruptionV1Error
> {
  return Result.fail(
    new PointMutationRedeliveryScopeDiscoveryCorruptionV1Error({
      reason: "metadataInvalid",
      ...(cause === undefined ? {} : { cause }),
    }),
  );
}
