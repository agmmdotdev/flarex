import { asNonArrayRecord } from "@flarex/utils/records";
import { sql, type SQL } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
  projectScopeIdUuidV1Result,
  type ReplacementScopeIdV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "./deployments";
import { detachUnknownDriverRows } from "./detachDriverRows";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
  type ScopeClockTargetReaderResolver,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
} from "./scopeAuthorityResolution";
import type { PointMutationSessionAttemptSelectorV1 } from
  "./transactionSessionActivation";

export const MAX_POINT_MUTATION_ATTEMPT_DISCOVERY_LIMIT_V1 = 100;

export type PointMutationAttemptDiscoverySourceV1 =
  | "expiredClaim"
  | "finishingSession";

export type PointMutationAttemptDiscoverySelectorV1 =
  PointMutationSessionAttemptSelectorV1;

/**
 * Pagination data only. Possession or alteration of this value grants no
 * execution, claim, lifecycle, journal, or publication authority. A canonical
 * caller alteration can at most skip or repeat bounded inert hints, and
 * concurrent mutation may defer or repeat hints across sweeps. Later pages
 * reuse the captured horizon; newly eligible work waits for a fresh sweep.
 */
export interface PointMutationAttemptDiscoveryContinuationV1 {
  readonly codecVersion: 1;
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly storageGeneration: typeof FlarexDbV1StorageGenerationSchema.Type;
  readonly storageGenerationFence: string;
  readonly epoch: typeof ScopeEpochSchema.Type;
  readonly horizon: string;
  readonly lastEligibleAt: string;
  readonly lastSource: PointMutationAttemptDiscoverySourceV1;
  readonly lastSessionId: TransactionSessionIdV1;
  readonly lastAttemptFence: string;
}

/** An inert locator hint. Exact-selector acquisition remains authoritative. */
export interface PointMutationAttemptDiscoveryCandidateV1 {
  readonly selector: PointMutationAttemptDiscoverySelectorV1;
  readonly source: PointMutationAttemptDiscoverySourceV1;
  readonly eligibleAt: string;
}

export interface PointMutationAttemptDiscoveryPageV1 {
  readonly horizon: string;
  readonly candidates: ReadonlyArray<PointMutationAttemptDiscoveryCandidateV1>;
  readonly continuation: PointMutationAttemptDiscoveryContinuationV1 | null;
}

export interface PointMutationAttemptDiscoveryV1 {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<
    PointMutationAttemptDiscoveryPageV1,
    PointMutationAttemptDiscoveryV1Error
  >;
}

export interface PointMutationAttemptDiscoveryPortsV1 {
  readonly scopeMetadata: ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeDiscoveryTargets:
    ScopeClockTargetReaderResolver<LocatedScopeClockReader>;
}

export class PointMutationAttemptDiscoveryInputV1Error
  extends Data.TaggedError("PointMutationAttemptDiscoveryInputV1Error")<{
    readonly reason: "invalidInput" | "continuationLocatorMismatch";
    readonly cause?: unknown;
  }> {}

export class PointMutationAttemptDiscoveryScopeV1Error
  extends Data.TaggedError("PointMutationAttemptDiscoveryScopeV1Error")<{
    readonly reason:
      | "selectorScopeMismatch"
      | "scopeClockMissing"
      | "scopeAuthorityChanged";
  }> {}

export class PointMutationAttemptDiscoveryTargetV1Error
  extends Data.TaggedError("PointMutationAttemptDiscoveryTargetV1Error")<{
    readonly reason: "unsupportedLocatedTarget";
  }> {}

export type PointMutationAttemptDiscoveryCorruptionReasonV1 =
  | "driverResultInvalid"
  | "scopeClockInvalid"
  | "metadataInconsistent"
  | "candidateInvalid"
  | "candidateOverflow"
  | "candidateOrderingInvalid"
  | "finishingClaimPresent";

export class PointMutationAttemptDiscoveryCorruptionV1Error
  extends Data.TaggedError("PointMutationAttemptDiscoveryCorruptionV1Error")<{
    readonly reason: PointMutationAttemptDiscoveryCorruptionReasonV1;
    readonly cause?: unknown;
  }> {}

export class PointMutationAttemptDiscoverySqlV1Error
  extends Data.TaggedError("PointMutationAttemptDiscoverySqlV1Error")<{
    readonly operation: "discover";
    readonly cause: unknown;
  }> {}

export type PointMutationAttemptDiscoveryV1Error =
  | TrustedScopeAuthorityError
  | PointMutationAttemptDiscoveryInputV1Error
  | PointMutationAttemptDiscoveryScopeV1Error
  | PointMutationAttemptDiscoveryTargetV1Error
  | PointMutationAttemptDiscoveryCorruptionV1Error
  | PointMutationAttemptDiscoverySqlV1Error;

const CanonicalPostgresIsoTimestampSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalIsoTimestamp(value) &&
      /^(?!0000-)[0-9]{4}-/.test(value)
      ? undefined
      : "Expected a canonical PostgreSQL-safe ISO timestamp"
  ),
);

const CanonicalPositiveInt64TextSchema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!/^[1-9][0-9]*$/.test(value)) {
      return "Expected a canonical positive signed-int64 integer";
    }
    try {
      const parsed = BigInt(value);
      return parsed <= MAX_PERSISTED_SIGNED_INT64_V1
        ? undefined
        : "Value exceeds PostgreSQL signed bigint";
    } catch {
      return "Expected a canonical positive signed-int64 integer";
    }
  }),
);

const PointMutationAttemptDiscoverySourceSchema = Schema.Literals([
  "expiredClaim",
  "finishingSession",
]);

const PointMutationAttemptDiscoveryContinuationSchema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  storageGeneration: FlarexDbV1StorageGenerationSchema,
  storageGenerationFence: CanonicalPositiveInt64TextSchema,
  epoch: ScopeEpochSchema,
  horizon: CanonicalPostgresIsoTimestampSchema,
  lastEligibleAt: CanonicalPostgresIsoTimestampSchema,
  lastSource: PointMutationAttemptDiscoverySourceSchema,
  lastSessionId: TransactionSessionIdV1Schema,
  lastAttemptFence: CanonicalPositiveInt64TextSchema,
});

const PointMutationAttemptDiscoveryInputSchema = Schema.Struct({
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  limit: Schema.Int.check(Schema.isBetween({
    minimum: 1,
    maximum: MAX_POINT_MUTATION_ATTEMPT_DISCOVERY_LIMIT_V1,
  })),
  continuation: Schema.optional(
    PointMutationAttemptDiscoveryContinuationSchema,
  ),
});

const decodePointMutationAttemptDiscoveryInputResult =
  Schema.decodeUnknownResult(
    PointMutationAttemptDiscoveryInputSchema,
    { onExcessProperty: "error" },
  );
const decodeScopeUuidResult = Schema.decodeUnknownResult(ScopeUuidV1Schema);
const decodeStorageGenerationResult = Schema.decodeUnknownResult(
  Schema.toType(FlarexDbV1StorageGenerationSchema),
);
const decodeStorageGenerationFenceResult = Schema.decodeUnknownResult(
  StorageGenerationFenceSchema,
);
const decodeScopeEpochResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeSessionIdResult = Schema.decodeUnknownResult(
  TransactionSessionIdV1Schema,
);
const decodeAttemptFenceResult = Schema.decodeUnknownResult(
  TransactionAttemptFenceSchema,
);

type ValidatedDiscoveryInputV1 =
  typeof PointMutationAttemptDiscoveryInputSchema.Type;

export const DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1: unique symbol =
  Symbol("FlarexDB/discoverLocatedPointMutationAttemptsV1");

export interface LocatedPointMutationAttemptDiscoveryTargetV1
  extends LocatedScopeClockReader {
  readonly [DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1]: (
    input: LocatedPointMutationAttemptDiscoveryInputV1,
  ) => Effect.Effect<
    PointMutationAttemptDiscoveryPageV1,
    | PointMutationAttemptDiscoveryInputV1Error
    | PointMutationAttemptDiscoveryScopeV1Error
    | PointMutationAttemptDiscoveryCorruptionV1Error
    | PointMutationAttemptDiscoverySqlV1Error
  >;
}

interface LocatedPointMutationAttemptDiscoveryInputV1 {
  readonly input: ValidatedDiscoveryInputV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
}

interface PointMutationAttemptDiscoveryStatementInputV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly limitPlusOne: number;
  readonly continuation:
    | ValidatedDiscoveryInputV1["continuation"]
    | undefined;
}

interface CapturedDiscoveryMetadataV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly storageGeneration: typeof FlarexDbV1StorageGenerationSchema.Type;
  readonly storageGenerationFence:
    TrustedScopeAuthority["storageGenerationFence"];
  readonly epoch: TrustedScopeAuthority["epoch"];
  readonly databaseNowMilliseconds: number;
  readonly horizonMilliseconds: number;
  readonly continuationFuture: boolean;
  readonly finishingClaimPresent: boolean;
}

interface CapturedDiscoveryCandidateV1 {
  readonly source: PointMutationAttemptDiscoverySourceV1;
  readonly sourceRank: 0 | 1;
  readonly eligibleAtMilliseconds: number;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
}

interface CapturedDiscoveryRowsV1 {
  readonly metadata: CapturedDiscoveryMetadataV1;
  readonly candidates: ReadonlyArray<CapturedDiscoveryCandidateV1>;
}

export function createPointMutationAttemptDiscoveryV1(
  ports: PointMutationAttemptDiscoveryPortsV1,
): PointMutationAttemptDiscoveryV1 {
  const discoverEffect = Effect.fn(
    "PointMutationAttemptDiscovery.discover",
  )(function* (
    rawInput: unknown,
  ): Effect.fn.Return<
    PointMutationAttemptDiscoveryPageV1,
    PointMutationAttemptDiscoveryV1Error
  > {
    const input = yield* Effect.fromResult(
      decodePointMutationAttemptDiscoveryInputResult(rawInput).pipe(
        Result.mapError((cause) =>
          new PointMutationAttemptDiscoveryInputV1Error({
            reason: "invalidInput",
            cause,
          })
        ),
      ),
    );
    if (
      input.continuation !== undefined &&
      (
        input.continuation.deploymentId !== input.deploymentId ||
        input.continuation.scopeId !== input.scopeId
      )
    ) {
      return yield* Effect.fail(
        new PointMutationAttemptDiscoveryInputV1Error({
          reason: "continuationLocatorMismatch",
        }),
      );
    }

    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      input.deploymentId,
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeDiscoveryTargets,
      },
    );
    if (located.authority.scopeId !== input.scopeId) {
      return yield* Effect.fail(
        new PointMutationAttemptDiscoveryScopeV1Error({
          reason: "selectorScopeMismatch",
        }),
      );
    }
    if (
      input.continuation !== undefined &&
      (
        input.continuation.storageGeneration !==
          located.authority.storageGeneration ||
        input.continuation.storageGenerationFence !==
          located.authority.storageGenerationFence.toString() ||
        input.continuation.epoch !== located.authority.epoch
      )
    ) {
      return yield* Effect.fail(
        new PointMutationAttemptDiscoveryScopeV1Error({
          reason: "scopeAuthorityChanged",
        }),
      );
    }
    const target = located.target;
    if (!isLocatedPointMutationAttemptDiscoveryTargetV1(target)) {
      return yield* Effect.fail(
        new PointMutationAttemptDiscoveryTargetV1Error({
          reason: "unsupportedLocatedTarget",
        }),
      );
    }
    return yield* target[DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1]({
      input,
      preliminaryAuthority: located.authority,
    });
  });

  return Object.freeze({ discoverEffect });
}

export const discoverLocatedPointMutationAttemptsEffectV1 = Effect.fn(
  "PointMutationAttemptDiscovery.discoverLocated",
)(function* (
  db: FlarexMetadataDatabase,
  request: LocatedPointMutationAttemptDiscoveryInputV1,
): Effect.fn.Return<
  PointMutationAttemptDiscoveryPageV1,
  | PointMutationAttemptDiscoveryInputV1Error
  | PointMutationAttemptDiscoveryScopeV1Error
  | PointMutationAttemptDiscoveryCorruptionV1Error
  | PointMutationAttemptDiscoverySqlV1Error
> {
  const projected = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(request.input.scopeId).pipe(
      Result.mapError((cause) =>
        new PointMutationAttemptDiscoveryInputV1Error({
          reason: "invalidInput",
          cause,
        })
      ),
    ),
  );
  const statement = buildPointMutationAttemptDiscoveryStatementV1({
    scopeUuid: projected.scopeUuid,
    limitPlusOne: request.input.limit + 1,
    continuation: request.input.continuation,
  });
  const driverResult = yield* Effect.tryPromise({
    try: () => db.execute(statement),
    catch: (cause) => new PointMutationAttemptDiscoverySqlV1Error({
      operation: "discover",
      cause,
    }),
  });
  const driverRows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(driverResult, () => {
      throw INVALID_DISCOVERY_DRIVER_RESULT;
    }),
    catch: (cause) =>
      cause === INVALID_DISCOVERY_DRIVER_RESULT
        ? new PointMutationAttemptDiscoveryCorruptionV1Error({
          reason: "driverResultInvalid",
        })
        : new PointMutationAttemptDiscoverySqlV1Error({
          operation: "discover",
          cause,
        }),
  });
  const rawRows = yield* Effect.try({
    try: () => detachUnknownDriverRows(driverRows),
    catch: (cause) => new PointMutationAttemptDiscoverySqlV1Error({
      operation: "discover",
      cause,
    }),
  });
  const captured = yield* Effect.fromResult(
    captureDiscoveryRows(
      projected.scopeUuid,
      request.input.limit,
      rawRows,
    ),
  );
  if (
    captured.metadata.scopeUuid !== projected.scopeUuid ||
    request.preliminaryAuthority.scopeId !== request.input.scopeId
  ) {
    return yield* Effect.fail(
      new PointMutationAttemptDiscoveryScopeV1Error({
        reason: "scopeClockMissing",
      }),
    );
  }
  if (
    captured.metadata.storageGeneration !==
      request.preliminaryAuthority.storageGeneration ||
    captured.metadata.storageGenerationFence !==
      request.preliminaryAuthority.storageGenerationFence ||
    captured.metadata.epoch !== request.preliminaryAuthority.epoch
  ) {
    return yield* Effect.fail(
      new PointMutationAttemptDiscoveryScopeV1Error({
        reason: "scopeAuthorityChanged",
      }),
    );
  }
  if (captured.metadata.continuationFuture) {
    return yield* Effect.fail(
      new PointMutationAttemptDiscoveryInputV1Error({
        reason: "invalidInput",
        cause: new Error("Discovery continuation horizon is in the future."),
      }),
    );
  }
  if (captured.metadata.finishingClaimPresent) {
    return yield* Effect.fail(
      new PointMutationAttemptDiscoveryCorruptionV1Error({
        reason: "finishingClaimPresent",
      }),
    );
  }
  return captureDiscoveryPage(request.input, captured);
});

/** Package-internal exact statement builder used by real-Postgres plan proof. */
export function buildPointMutationAttemptDiscoveryStatementV1(
  input: PointMutationAttemptDiscoveryStatementInputV1,
): SQL {
  const continuationHorizon = input.continuation?.horizon ?? null;
  const expiredAfter = discoveryKeysetPredicate(
    0,
    sql`claim.claim_expires_at`,
    sql`claim.session_id`,
    sql`claim.attempt_fence`,
    input.continuation,
  );
  const finishingAfter = discoveryKeysetPredicate(
    1,
    sql`session.updated_at`,
    sql`session.session_id`,
    sql`session.attempt_fence`,
    input.continuation,
  );

  return sql`
    with discovery_context as materialized (
      select
        date_trunc('milliseconds', statement_timestamp()) as database_now,
        coalesce(
          ${continuationHorizon}::timestamptz,
          date_trunc('milliseconds', statement_timestamp())
        ) as horizon,
        clock.scope_uuid,
        clock.storage_generation,
        clock.storage_generation_fence,
        clock.epoch
      from (select 1) as singleton
      left join fx_system_scope_clock as clock
        on clock.scope_uuid = ${input.scopeUuid}::uuid
    ),
    expired_claim_candidates as materialized (
      select candidate.*
      from discovery_context as context
      cross join lateral (
        select
          'expiredClaim'::text as source,
          0::integer as source_rank,
          claim.claim_expires_at as eligible_at,
          claim.session_id,
          claim.attempt_fence,
          false::boolean as finishing_claim_present
        from fx_system_tx_execution_claim as claim
        cross join lateral (
          select 1
          from fx_system_tx_session as session
          where session.scope_uuid = claim.scope_uuid
            and session.session_id = claim.session_id
            and session.attempt_fence = claim.attempt_fence
            and session.storage_generation = context.storage_generation
            and session.storage_generation_fence =
              context.storage_generation_fence
            and session.lifecycle = 'running'
          limit 1
          offset 0
        ) as current_session
        where context.horizon <= context.database_now
          and claim.scope_uuid = context.scope_uuid
          and claim.claim_expires_at <= context.horizon
          and ${expiredAfter}
        order by
          claim.claim_expires_at asc,
          claim.session_id asc,
          claim.attempt_fence asc
        limit ${input.limitPlusOne}
      ) as candidate
    ),
    finishing_session_candidates as materialized (
      select
        candidate.*,
        coalesce(exact_claim.finishing_claim_present, false)
          as finishing_claim_present
      from discovery_context as context
      cross join lateral (
        select
          'finishingSession'::text as source,
          1::integer as source_rank,
          session.updated_at as eligible_at,
          session.session_id,
          session.attempt_fence
        from fx_system_tx_session as session
        where context.horizon <= context.database_now
          and session.scope_uuid = context.scope_uuid
          and session.storage_generation = context.storage_generation
          and session.storage_generation_fence = context.storage_generation_fence
          and session.lifecycle = 'finishing'
          and session.updated_at <= context.horizon
          and ${finishingAfter}
        order by
          session.updated_at asc,
          session.session_id asc,
          session.attempt_fence asc
        limit ${input.limitPlusOne}
      ) as candidate
      left join lateral (
        select true as finishing_claim_present
          from fx_system_tx_execution_claim as claim
          where claim.scope_uuid = context.scope_uuid
            and claim.session_id = candidate.session_id
            and claim.attempt_fence = candidate.attempt_fence
          limit 1
          offset 0
      ) as exact_claim on true
    ),
    merged_candidates as materialized (
      select *
      from (
        select * from expired_claim_candidates
        union all
        select * from finishing_session_candidates
      ) as candidates
      order by
        eligible_at asc,
        source_rank asc,
        session_id asc,
        attempt_fence asc
      limit ${input.limitPlusOne}
    )
    select
      context.scope_uuid::text as "clockScopeUuid",
      context.storage_generation as "clockStorageGeneration",
      context.storage_generation_fence::text
        as "clockStorageGenerationFenceText",
      context.epoch as "clockEpoch",
      floor(extract(epoch from context.database_now) * 1000)::bigint::text
        as "databaseNowEpochMillisecondsText",
      floor(extract(epoch from context.horizon) * 1000)::bigint::text
        as "horizonEpochMillisecondsText",
      (context.horizon > context.database_now) as "continuationFuture",
      exists(
        select 1
        from merged_candidates
        where finishing_claim_present
      )
        as "finishingClaimPresent",
      candidate.source as "candidateSource",
      candidate.source_rank as "candidateSourceRank",
      floor(extract(epoch from candidate.eligible_at) * 1000)::bigint::text
        as "candidateEligibleAtEpochMillisecondsText",
      candidate.eligible_at = date_trunc('milliseconds', candidate.eligible_at)
        as "candidateEligibleAtMillisecondAligned",
      candidate.session_id::text as "candidateSessionId",
      candidate.attempt_fence::text as "candidateAttemptFenceText"
    from discovery_context as context
    left join merged_candidates as candidate on true
    order by
      candidate.eligible_at asc nulls last,
      candidate.source_rank asc nulls last,
      candidate.session_id asc nulls last,
      candidate.attempt_fence asc nulls last
  `;
}

function discoveryKeysetPredicate(
  sourceRank: 0 | 1,
  eligibleAt: SQL,
  sessionId: SQL,
  attemptFence: SQL,
  continuation: ValidatedDiscoveryInputV1["continuation"] | undefined,
): SQL {
  if (continuation === undefined) return sql`true`;
  const lastSourceRank = sourceRankOf(continuation.lastSource);
  return sql`
    (${eligibleAt}, ${sourceRank}, ${sessionId}, ${attemptFence}) >
    (
      ${continuation.lastEligibleAt}::timestamptz,
      ${lastSourceRank},
      ${continuation.lastSessionId}::uuid,
      ${continuation.lastAttemptFence}::bigint
    )
  `;
}

function isLocatedPointMutationAttemptDiscoveryTargetV1(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationAttemptDiscoveryTargetV1 {
  return typeof Reflect.get(
    target,
    DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1,
  ) === "function";
}

function captureDiscoveryRows(
  expectedScopeUuid: ScopeUuidV1,
  requestedLimit: number,
  rawRows: ReadonlyArray<unknown>,
): Result.Result<
  CapturedDiscoveryRowsV1,
  | PointMutationAttemptDiscoveryScopeV1Error
  | PointMutationAttemptDiscoveryCorruptionV1Error
> {
  return Result.gen(function* () {
    if (rawRows.length === 0) {
      return yield* Result.fail(
        new PointMutationAttemptDiscoveryScopeV1Error({
          reason: "scopeClockMissing",
        }),
      );
    }
    const metadata = yield* captureDiscoveryMetadata(
      expectedScopeUuid,
      rawRows[0],
    );
    const candidates: CapturedDiscoveryCandidateV1[] = [];
    for (const rawRow of rawRows) {
      const rowMetadata = yield* captureDiscoveryMetadata(
        expectedScopeUuid,
        rawRow,
      );
      if (!sameDiscoveryMetadata(metadata, rowMetadata)) {
        return yield* Result.fail(corruption("metadataInconsistent"));
      }
      const candidate = yield* captureDiscoveryCandidate(rawRow);
      if (candidate !== null) candidates.push(candidate);
    }
    if (candidates.length > requestedLimit + 1) {
      return yield* Result.fail(corruption("candidateOverflow"));
    }
    for (let index = 1; index < candidates.length; index += 1) {
      const previous = candidates[index - 1];
      const current = candidates[index];
      if (
        previous === undefined ||
        current === undefined ||
        compareDiscoveryCandidates(previous, current) >= 0
      ) {
        return yield* Result.fail(corruption("candidateOrderingInvalid"));
      }
    }
    return Object.freeze({
      metadata,
      candidates: Object.freeze(candidates),
    });
  });
}

function captureDiscoveryMetadata(
  expectedScopeUuid: ScopeUuidV1,
  rawRow: unknown,
): Result.Result<
  CapturedDiscoveryMetadataV1,
  | PointMutationAttemptDiscoveryScopeV1Error
  | PointMutationAttemptDiscoveryCorruptionV1Error
> {
  const row = asNonArrayRecord(rawRow);
  if (row === null) return Result.fail(corruption("metadataInconsistent"));
  if (row.clockScopeUuid === null) {
    return Result.fail(new PointMutationAttemptDiscoveryScopeV1Error({
      reason: "scopeClockMissing",
    }));
  }
  return Result.all({
    scopeUuid: decodeScopeUuidResult(row.clockScopeUuid),
    storageGeneration: decodeStorageGenerationResult(
      row.clockStorageGeneration,
    ),
    storageGenerationFence: decodeStorageGenerationFenceResult(
      row.clockStorageGenerationFenceText,
    ),
    epoch: decodeScopeEpochResult(row.clockEpoch),
    databaseNow: decodeEpochMillisecondsText(
      row.databaseNowEpochMillisecondsText,
    ),
    horizon: decodeEpochMillisecondsText(
      row.horizonEpochMillisecondsText,
    ),
  }).pipe(
    Result.mapError(() => corruption("scopeClockInvalid")),
    Result.flatMap((decoded) => {
      if (
        typeof row.continuationFuture !== "boolean" ||
        typeof row.finishingClaimPresent !== "boolean" ||
        decoded.scopeUuid !== expectedScopeUuid
      ) {
        return Result.fail(corruption("scopeClockInvalid"));
      }
      return Result.succeed(Object.freeze({
        scopeUuid: decoded.scopeUuid,
        storageGeneration: decoded.storageGeneration,
        storageGenerationFence: decoded.storageGenerationFence,
        epoch: decoded.epoch,
        databaseNowMilliseconds: decoded.databaseNow,
        horizonMilliseconds: decoded.horizon,
        continuationFuture: row.continuationFuture,
        finishingClaimPresent: row.finishingClaimPresent,
      }));
    }),
  );
}

function captureDiscoveryCandidate(
  rawRow: unknown,
): Result.Result<
  CapturedDiscoveryCandidateV1 | null,
  PointMutationAttemptDiscoveryCorruptionV1Error
> {
  const row = asNonArrayRecord(rawRow);
  if (row === null) return Result.fail(corruption("candidateInvalid"));
  if (
    row.candidateSource === null &&
    row.candidateSourceRank === null &&
    row.candidateEligibleAtEpochMillisecondsText === null &&
    row.candidateEligibleAtMillisecondAligned === null &&
    row.candidateSessionId === null &&
    row.candidateAttemptFenceText === null
  ) {
    return Result.succeed(null);
  }
  return Result.all({
    source: decodeDiscoverySource(row.candidateSource),
    sourceRank: decodeSourceRank(row.candidateSourceRank),
    eligibleAt: decodeEpochMillisecondsText(
      row.candidateEligibleAtEpochMillisecondsText,
    ),
    sessionId: decodeSessionIdResult(row.candidateSessionId),
    attemptFence: decodeAttemptFenceResult(
      row.candidateAttemptFenceText,
    ),
  }).pipe(
    Result.mapError(() => corruption("candidateInvalid")),
    Result.flatMap((decoded) => {
      if (
        row.candidateEligibleAtMillisecondAligned !== true ||
        decoded.sourceRank !== sourceRankOf(decoded.source)
      ) {
        return Result.fail(corruption("candidateInvalid"));
      }
      return Result.succeed(Object.freeze({
        source: decoded.source,
        sourceRank: decoded.sourceRank,
        eligibleAtMilliseconds: decoded.eligibleAt,
        sessionId: decoded.sessionId,
        attemptFence: decoded.attemptFence,
      }));
    }),
  );
}

function decodeDiscoverySource(
  value: unknown,
): Result.Result<PointMutationAttemptDiscoverySourceV1, unknown> {
  return value === "expiredClaim" || value === "finishingSession"
    ? Result.succeed(value)
    : Result.fail(value);
}

function decodeSourceRank(
  value: unknown,
): Result.Result<0 | 1, unknown> {
  return value === 0 || value === 1
    ? Result.succeed(value)
    : Result.fail(value);
}

function decodeEpochMillisecondsText(
  value: unknown,
): Result.Result<number, unknown> {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(value);
  }
  try {
    const milliseconds = Number(BigInt(value));
    if (
      !Number.isSafeInteger(milliseconds) ||
      !Number.isFinite(new Date(milliseconds).valueOf())
    ) {
      return Result.fail(value);
    }
    return Result.succeed(milliseconds);
  } catch (cause) {
    return Result.fail(cause);
  }
}

function sameDiscoveryMetadata(
  left: CapturedDiscoveryMetadataV1,
  right: CapturedDiscoveryMetadataV1,
): boolean {
  return left.scopeUuid === right.scopeUuid &&
    left.storageGeneration === right.storageGeneration &&
    left.storageGenerationFence === right.storageGenerationFence &&
    left.epoch === right.epoch &&
    left.databaseNowMilliseconds === right.databaseNowMilliseconds &&
    left.horizonMilliseconds === right.horizonMilliseconds &&
    left.continuationFuture === right.continuationFuture &&
    left.finishingClaimPresent === right.finishingClaimPresent;
}

const INVALID_DISCOVERY_DRIVER_RESULT = Symbol(
  "FlarexDB/invalidPointMutationAttemptDiscoveryDriverResult",
);

function compareDiscoveryCandidates(
  left: CapturedDiscoveryCandidateV1,
  right: CapturedDiscoveryCandidateV1,
): number {
  if (left.eligibleAtMilliseconds !== right.eligibleAtMilliseconds) {
    return left.eligibleAtMilliseconds < right.eligibleAtMilliseconds ? -1 : 1;
  }
  if (left.sourceRank !== right.sourceRank) {
    return left.sourceRank < right.sourceRank ? -1 : 1;
  }
  if (left.sessionId !== right.sessionId) {
    return left.sessionId < right.sessionId ? -1 : 1;
  }
  if (left.attemptFence === right.attemptFence) return 0;
  return left.attemptFence < right.attemptFence ? -1 : 1;
}

function captureDiscoveryPage(
  input: ValidatedDiscoveryInputV1,
  captured: CapturedDiscoveryRowsV1,
): PointMutationAttemptDiscoveryPageV1 {
  const selected = captured.candidates.slice(0, input.limit);
  const candidates = Object.freeze(selected.map((candidate) =>
    Object.freeze({
      selector: Object.freeze({
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        sessionId: candidate.sessionId,
        attemptFence: candidate.attemptFence,
      }),
      source: candidate.source,
      eligibleAt: new Date(candidate.eligibleAtMilliseconds).toISOString(),
    })
  ));
  const last = selected.at(-1);
  const continuation = captured.candidates.length > input.limit &&
      last !== undefined
    ? Object.freeze({
      codecVersion: 1 as const,
      deploymentId: input.deploymentId,
      scopeId: input.scopeId,
      storageGeneration: captured.metadata.storageGeneration,
      storageGenerationFence:
        captured.metadata.storageGenerationFence.toString(),
      epoch: captured.metadata.epoch,
      horizon: new Date(
        captured.metadata.horizonMilliseconds,
      ).toISOString(),
      lastEligibleAt: new Date(last.eligibleAtMilliseconds).toISOString(),
      lastSource: last.source,
      lastSessionId: last.sessionId,
      lastAttemptFence: last.attemptFence.toString(),
    }) satisfies PointMutationAttemptDiscoveryContinuationV1
    : null;
  return Object.freeze({
    horizon: new Date(captured.metadata.horizonMilliseconds).toISOString(),
    candidates,
    continuation,
  });
}

function sourceRankOf(source: PointMutationAttemptDiscoverySourceV1): 0 | 1 {
  return source === "expiredClaim" ? 0 : 1;
}

function corruption(
  reason: PointMutationAttemptDiscoveryCorruptionReasonV1,
  cause?: unknown,
): PointMutationAttemptDiscoveryCorruptionV1Error {
  return new PointMutationAttemptDiscoveryCorruptionV1Error({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
