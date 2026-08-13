import {
  TaskRunIdV1Schema,
  decodeTaskRequestedEffectSequenceV1,
  type TaskRequestedEffectSequenceV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { asNonArrayRecord } from "@flarex/utils/records";
import { sql, type SQL } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import {
  ReplacementScopeIdV1Schema,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { detachUnknownDriverRows } from "./detachDriverRows";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import type { LocatedTrustedScopeAuthority } from
  "./scopeAuthorityResolution";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
  type TaskSystemScopeAuthorityMismatchV1,
} from "./taskSystemScopeAuthorityV1";
import type { LocatedTaskComputeDeliveryTargetV1 } from
  "./taskComputeDeliveryRepositoryV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "./transactionSessionAttemptKernel";
import {
  configureTaskRepairPostgresTransactionDeadlinesV1,
  createTaskRepairPostgresDeadlinePolicyV1,
  type TaskRepairPostgresDeadlinePolicyInputV1,
  type TaskRepairPostgresDeadlinePolicyV1,
} from "./taskRepairPostgresDeadlinePolicyV1";

export const MAX_TASK_COMPUTE_DELIVERY_DISCOVERY_LIMIT = 100;

export type TaskComputeDeliveryOperation = "dispatch" | "cancellation";

export interface TaskComputeDeliveryContinuationPositionV1 {
  readonly eligibleAt: string;
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: string;
}

/**
 * Inert pagination evidence. It grants no claim, lifecycle, provider, or scope
 * authority; C2 acquisition remains the only transition authority.
 */
export interface TaskComputeDeliveryContinuationV1<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> {
  readonly codecVersion: 1;
  readonly operation: Operation;
  readonly databaseTimeBound: string;
  readonly highWater: TaskComputeDeliveryContinuationPositionV1;
  readonly last: TaskComputeDeliveryContinuationPositionV1;
}

export interface TaskComputeDeliveryCandidate<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> {
  readonly operation: Operation;
  readonly eligibleAt: string;
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
}

export interface TaskComputeDeliveryCandidatePage<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> {
  readonly operation: Operation;
  readonly databaseTimeBound: string;
  readonly candidates: ReadonlyArray<TaskComputeDeliveryCandidate<Operation>>;
  readonly continuation: TaskComputeDeliveryContinuationV1<Operation> | null;
}

export interface TaskComputeDeliveryCandidateDiscovery {
  readonly discoverDispatchCandidates: (
    input: unknown,
  ) => Effect.Effect<
    TaskComputeDeliveryCandidatePage<"dispatch">,
    TaskComputeDeliveryDiscoveryError<"dispatch">
  >;
  readonly discoverCancellationCandidates: (
    input: unknown,
  ) => Effect.Effect<
    TaskComputeDeliveryCandidatePage<"cancellation">,
    TaskComputeDeliveryDiscoveryError<"cancellation">
  >;
}

export type TaskComputeDeliveryContinuationV1CodecOperation =
  | "decode"
  | "encode";

export class TaskComputeDeliveryContinuationV1Error<
  Operation extends TaskComputeDeliveryContinuationV1CodecOperation =
    TaskComputeDeliveryContinuationV1CodecOperation,
> extends Data.TaggedError("TaskComputeDeliveryContinuationV1Error")<{
  readonly operation: Operation;
  readonly issue: "invalid_shape" | "invalid_ordering";
  readonly cause?: unknown;
}> {}

export class TaskComputeDeliveryDiscoveryConfigurationError
  extends Data.TaggedError("TaskComputeDeliveryDiscoveryConfigurationError")<{
    readonly reason:
      | "invalid_scope"
      | "invalid_target"
      | "invalid_deadline_policy";
    readonly cause?: unknown;
  }> {}

export class TaskComputeDeliveryDiscoveryInputError<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> extends Data.TaggedError("TaskComputeDeliveryDiscoveryInputError")<{
  readonly operation: Operation;
  readonly reason:
    | "invalid_input"
    | "continuation_operation_mismatch"
    | "continuation_future";
  readonly cause?: unknown;
}> {}

export class TaskComputeDeliveryDiscoveryStaleScopeAuthorityError<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> extends Data.TaggedError(
  "TaskComputeDeliveryDiscoveryStaleScopeAuthorityError",
)<{
  readonly operation: Operation;
  readonly authority: TaskSystemScopeAuthorityMismatchV1;
}> {}

export type TaskComputeDeliveryDiscoveryCorruptionReason =
  | "driver_result_invalid"
  | "metadata_invalid"
  | "candidate_invalid"
  | "candidate_overflow"
  | "candidate_ordering_invalid"
  | "high_water_invalid";

export class TaskComputeDeliveryDiscoveryCorruptionError<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> extends Data.TaggedError("TaskComputeDeliveryDiscoveryCorruptionError")<{
  readonly operation: Operation;
  readonly reason: TaskComputeDeliveryDiscoveryCorruptionReason;
  readonly cause?: unknown;
}> {}

export class TaskComputeDeliveryDiscoverySqlError<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> extends Data.TaggedError("TaskComputeDeliveryDiscoverySqlError")<{
  readonly operation: Operation;
  readonly phase: "transaction" | "cleanup" | "decision_uncertain";
  readonly cause: unknown;
}> {}

export type TaskComputeDeliveryDiscoveryError<
  Operation extends TaskComputeDeliveryOperation = TaskComputeDeliveryOperation,
> =
  | TaskComputeDeliveryDiscoveryInputError<Operation>
  | TaskComputeDeliveryDiscoveryStaleScopeAuthorityError<Operation>
  | TaskComputeDeliveryDiscoveryCorruptionError<Operation>
  | TaskComputeDeliveryDiscoverySqlError<Operation>;

const CanonicalPostgresIsoTimestampSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isCanonicalIsoTimestamp(value) && /^(?!0000-)[0-9]{4}-/.test(value)
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
      return BigInt(value) <= 9_223_372_036_854_775_807n
        ? undefined
        : "Value exceeds PostgreSQL signed bigint";
    } catch {
      return "Expected a canonical positive signed-int64 integer";
    }
  }),
);

const TaskComputeDeliveryOperationSchema = Schema.Literals([
  "dispatch",
  "cancellation",
]);

const TaskComputeDeliveryContinuationPositionV1Schema = Schema.Struct({
  eligibleAt: CanonicalPostgresIsoTimestampSchema,
  runId: TaskRunIdV1Schema,
  requestedEffectSequence: CanonicalPositiveInt64TextSchema,
});

const TaskComputeDeliveryContinuationV1Schema = Schema.Struct({
  codecVersion: Schema.Literal(1),
  operation: TaskComputeDeliveryOperationSchema,
  databaseTimeBound: CanonicalPostgresIsoTimestampSchema,
  highWater: TaskComputeDeliveryContinuationPositionV1Schema,
  last: TaskComputeDeliveryContinuationPositionV1Schema,
});

const TaskComputeDeliveryDiscoveryInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({
    minimum: 1,
    maximum: MAX_TASK_COMPUTE_DELIVERY_DISCOVERY_LIMIT,
  })),
  continuation: Schema.optional(TaskComputeDeliveryContinuationV1Schema),
});

const decodeContinuationShapeResult = Schema.decodeUnknownResult(
  TaskComputeDeliveryContinuationV1Schema,
  { onExcessProperty: "error" },
);
const decodeDiscoveryInputResult = Schema.decodeUnknownResult(
  TaskComputeDeliveryDiscoveryInputSchema,
  { onExcessProperty: "error" },
);
const decodeReplacementScopeIdResult = Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
);
const decodeTaskRunIdResult = Schema.decodeUnknownResult(TaskRunIdV1Schema);

type ValidatedDiscoveryInput = typeof TaskComputeDeliveryDiscoveryInputSchema.Type;

interface CapturedPosition {
  readonly eligibleAtMilliseconds: number;
  readonly runId: TaskRunIdV1;
  readonly requestedEffectSequence: TaskRequestedEffectSequenceV1;
}

interface CapturedDiscoveryRows {
  readonly databaseNowMilliseconds: number;
  readonly databaseTimeBoundMilliseconds: number;
  readonly continuationFuture: boolean;
  readonly highWater: CapturedPosition | null;
  readonly candidates: ReadonlyArray<CapturedPosition>;
}

export interface TaskComputeDeliveryDiscoveryStatementInput {
  readonly scopeId: ReplacementScopeIdV1;
  readonly limitPlusOne: number;
  readonly continuation: TaskComputeDeliveryContinuationV1 | undefined;
}

export function decodeTaskComputeDeliveryContinuationV1(
  input: unknown,
): Result.Result<
  TaskComputeDeliveryContinuationV1,
  TaskComputeDeliveryContinuationV1Error<"decode">
> {
  return decodeContinuation(input, "decode");
}

export function encodeTaskComputeDeliveryContinuationV1(
  input: unknown,
): Result.Result<
  TaskComputeDeliveryContinuationV1,
  TaskComputeDeliveryContinuationV1Error<"encode">
> {
  return decodeContinuation(input, "encode");
}

function decodeContinuation<
  Operation extends TaskComputeDeliveryContinuationV1CodecOperation,
>(
  input: unknown,
  operation: Operation,
): Result.Result<
  TaskComputeDeliveryContinuationV1,
  TaskComputeDeliveryContinuationV1Error<Operation>
> {
  const captured = capturePlainDataTree(input);
  if (captured === INVALID_INPUT_CAPTURE) {
    return Result.fail(new TaskComputeDeliveryContinuationV1Error<Operation>({
      operation,
      issue: "invalid_shape",
    }));
  }
  return decodeContinuationShapeResult(captured).pipe(
    Result.mapError((cause) =>
      new TaskComputeDeliveryContinuationV1Error<Operation>({
        operation,
        issue: "invalid_shape",
        cause,
      })
    ),
    Result.flatMap((decoded) => {
      const highWater = captureContinuationPosition(decoded.highWater);
      const last = captureContinuationPosition(decoded.last);
      return comparePositions(last, highWater) <= 0
        ? Result.succeed(Object.freeze({
          codecVersion: 1 as const,
          operation: decoded.operation,
          databaseTimeBound: decoded.databaseTimeBound,
          highWater,
          last,
        }))
        : Result.fail(new TaskComputeDeliveryContinuationV1Error<Operation>({
          operation,
          issue: "invalid_ordering",
        }));
    }),
  );
}

export function makeTaskComputeDeliveryCandidateDiscovery(
  located: LocatedTrustedScopeAuthority<LocatedTaskComputeDeliveryTargetV1>,
  deadlinePolicyInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  TaskComputeDeliveryCandidateDiscovery,
  TaskComputeDeliveryDiscoveryConfigurationError
> {
  return createTaskRepairPostgresDeadlinePolicyV1(deadlinePolicyInput).pipe(
    Result.mapError((cause) =>
      new TaskComputeDeliveryDiscoveryConfigurationError({
        reason: "invalid_deadline_policy",
        cause,
      })
    ),
    Result.flatMap((deadlinePolicy) => {
      const authority = captureTaskSystemTrustedScopeAuthorityV1(
        located.authority,
      );
      return decodeReplacementScopeIdResult(authority.scopeId).pipe(
        Result.mapError(() =>
          new TaskComputeDeliveryDiscoveryConfigurationError({
            reason: "invalid_scope",
          })
        ),
        Result.flatMap((scopeId) => {
          const target = located.target;
          const runTransaction = Reflect.get(
            target,
            RUN_LOCATED_READ_COMMITTED_V1,
          );
          if (typeof runTransaction !== "function") {
            return Result.fail(
              new TaskComputeDeliveryDiscoveryConfigurationError({
                reason: "invalid_target",
              }),
            );
          }
          const runLocatedTransaction = <Value>(
            work: (tx: AppRowTransaction) => Promise<Value>,
          ): Promise<Value> => Reflect.apply(runTransaction, target, [work]);

          const discoverDispatchCandidates = makeDiscoveryOperation(
            "dispatch",
            scopeId,
            authority,
            target,
            runLocatedTransaction,
            deadlinePolicy,
            buildTaskComputeDispatchDiscoveryStatement,
          );
          const discoverCancellationCandidates = makeDiscoveryOperation(
            "cancellation",
            scopeId,
            authority,
            target,
            runLocatedTransaction,
            deadlinePolicy,
            buildTaskComputeCancellationDiscoveryStatement,
          );
          return Result.succeed(Object.freeze({
            discoverDispatchCandidates,
            discoverCancellationCandidates,
          }));
        }),
      );
    }),
  );
}

function makeDiscoveryOperation<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  scopeId: ReplacementScopeIdV1,
  authority: ReturnType<typeof captureTaskSystemTrustedScopeAuthorityV1>,
  target: LocatedTaskComputeDeliveryTargetV1,
  runLocatedTransaction: <Value>(
    work: (tx: AppRowTransaction) => Promise<Value>,
  ) => Promise<Value>,
  deadlinePolicy: TaskRepairPostgresDeadlinePolicyV1,
  buildStatement: (input: TaskComputeDeliveryDiscoveryStatementInput) => SQL,
): (
  input: unknown,
) => Effect.Effect<
  TaskComputeDeliveryCandidatePage<Operation>,
  TaskComputeDeliveryDiscoveryError<Operation>
> {
  return Effect.fn(`TaskComputeDeliveryDiscovery.${operation}`)(function* (
    rawInput: unknown,
  ): Effect.fn.Return<
    TaskComputeDeliveryCandidatePage<Operation>,
    TaskComputeDeliveryDiscoveryError<Operation>
  > {
    const input = yield* Effect.fromResult(
      captureDiscoveryInput(rawInput, operation),
    );
    const statement = buildStatement({
      scopeId,
      limitPlusOne: input.limit + 1,
      continuation: input.continuation,
    });
    const rows = yield* runDiscoveryTransaction(
      operation,
      runLocatedTransaction,
      async (tx) => {
        await configureTaskRepairPostgresTransactionDeadlinesV1(
          tx,
          deadlinePolicy,
        );
        await requireLockedTaskSystemScopeAuthorityV1(
          tx,
          authority,
          target,
          (mismatch) => discoveryRollback(
            new TaskComputeDeliveryDiscoveryStaleScopeAuthorityError<Operation>({
              operation,
              authority: mismatch,
            }),
          ),
        );
        const driverResult = await tx.execute(statement);
        let driverRows: ReadonlyArray<unknown>;
        try {
          driverRows = rowsFromDriverExecuteResult(driverResult, () => {
            throw INVALID_DRIVER_RESULT;
          });
        } catch (cause) {
          if (cause !== INVALID_DRIVER_RESULT) throw cause;
          throw discoveryRollback(
            new TaskComputeDeliveryDiscoveryCorruptionError<Operation>({
              operation,
              reason: "driver_result_invalid",
            }),
          );
        }
        return detachUnknownDriverRows(driverRows);
      },
    );
    const captured = yield* Effect.fromResult(
      captureDiscoveryRows(operation, input.limit, rows),
    );
    yield* Effect.fromResult(validateCapturedPage(operation, input, captured));
    if (captured.continuationFuture) {
      return yield* Effect.fail(
        new TaskComputeDeliveryDiscoveryInputError<Operation>({
          operation,
          reason: "continuation_future",
        }),
      );
    }
    return makeDiscoveryPage(operation, input, captured);
  });
}

function validateCapturedPage<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  input: ValidatedDiscoveryInput,
  captured: CapturedDiscoveryRows,
): Result.Result<
  void,
  TaskComputeDeliveryDiscoveryCorruptionError<Operation>
> {
  if (
    captured.continuationFuture !==
      (
        captured.databaseTimeBoundMilliseconds >
        captured.databaseNowMilliseconds
      ) ||
    (
      captured.highWater !== null &&
      captured.highWater.eligibleAtMilliseconds >
        captured.databaseTimeBoundMilliseconds
    ) ||
    (captured.highWater === null && captured.candidates.length > 0)
  ) {
    return Result.fail(corruption(operation, "metadata_invalid"));
  }
  const continuation = input.continuation;
  if (continuation === undefined) return Result.succeed(undefined);
  return Result.gen(function* () {
    const expectedHighWater = yield* capturedContinuationPosition(
      operation,
      continuation.highWater,
    );
    const expectedLast = yield* capturedContinuationPosition(
      operation,
      continuation.last,
    );
    if (
      captured.databaseTimeBoundMilliseconds !==
        Date.parse(continuation.databaseTimeBound) ||
      captured.highWater === null ||
      comparePositions(captured.highWater, expectedHighWater) !== 0
    ) {
      return yield* Result.fail(corruption(operation, "high_water_invalid"));
    }
    if (captured.candidates.some((candidate) =>
      comparePositions(candidate, expectedLast) <= 0
    )) {
      return yield* Result.fail(
        corruption(operation, "candidate_ordering_invalid"),
      );
    }
  });
}

function capturedContinuationPosition<
  Operation extends TaskComputeDeliveryOperation,
>(
  operation: Operation,
  position: TaskComputeDeliveryContinuationPositionV1,
): Result.Result<
  CapturedPosition,
  TaskComputeDeliveryDiscoveryCorruptionError<Operation>
> {
  return decodeTaskRequestedEffectSequenceV1(
    position.requestedEffectSequence,
  ).pipe(
    Result.mapError(() => corruption(operation, "high_water_invalid")),
    Result.map((requestedEffectSequence) => Object.freeze({
      eligibleAtMilliseconds: Date.parse(position.eligibleAt),
      runId: position.runId,
      requestedEffectSequence,
    })),
  );
}

function captureDiscoveryInput<Operation extends TaskComputeDeliveryOperation>(
  input: unknown,
  operation: Operation,
): Result.Result<
  ValidatedDiscoveryInput,
  TaskComputeDeliveryDiscoveryInputError<Operation>
> {
  const captured = capturePlainDataTree(input);
  if (captured === INVALID_INPUT_CAPTURE) {
    return Result.fail(new TaskComputeDeliveryDiscoveryInputError<Operation>({
      operation,
      reason: "invalid_input",
    }));
  }
  return decodeDiscoveryInputResult(captured).pipe(
    Result.mapError((cause) =>
      new TaskComputeDeliveryDiscoveryInputError<Operation>({
        operation,
        reason: "invalid_input",
        cause,
      })
    ),
    Result.flatMap((decoded) => {
      if (
        decoded.continuation !== undefined &&
        decoded.continuation.operation !== operation
      ) {
        return Result.fail(
          new TaskComputeDeliveryDiscoveryInputError<Operation>({
            operation,
            reason: "continuation_operation_mismatch",
          }),
        );
      }
      if (decoded.continuation === undefined) return Result.succeed(decoded);
      return decodeTaskComputeDeliveryContinuationV1(
        decoded.continuation,
      ).pipe(
        Result.mapError((cause) =>
          new TaskComputeDeliveryDiscoveryInputError<Operation>({
            operation,
            reason: "invalid_input",
            cause,
          })
        ),
        Result.map((continuation) => Object.freeze({
          limit: decoded.limit,
          continuation,
        })),
      );
    }),
  );
}

export function buildTaskComputeDispatchDiscoveryStatement(
  input: TaskComputeDeliveryDiscoveryStatementInput,
): SQL {
  return buildDiscoveryStatement("dispatch", input);
}

export function buildTaskComputeCancellationDiscoveryStatement(
  input: TaskComputeDeliveryDiscoveryStatementInput,
): SQL {
  return buildDiscoveryStatement("cancellation", input);
}

function buildDiscoveryStatement(
  operation: TaskComputeDeliveryOperation,
  input: TaskComputeDeliveryDiscoveryStatementInput,
): SQL {
  const continuation = input.continuation;
  const requestedKind = operation === "dispatch"
    ? "dispatch_attempt"
    : "request_execution_cancellation";
  const checkpointTable = operation === "dispatch"
    ? sql.raw("fx_system_durable_task_compute_dispatch_v1")
    : sql.raw("fx_system_durable_task_compute_cancellation_v1");
  const initialStates = operation === "dispatch"
    ? ["prepared"] as const
    : ["waiting_dispatch", "prepared"] as const;
  const timeBound = continuation?.databaseTimeBound ?? null;
  const effectiveTimeBound = sql`coalesce(
    ${timeBound}::timestamptz,
    date_trunc('milliseconds', statement_timestamp())
  )`;
  const highWater = continuation?.highWater;
  const last = continuation?.last;
  const highWaterHeads = [
    pendingDiscoveryBranch({
      scopeId: input.scopeId,
      requestedKind,
      timeBound: effectiveTimeBound,
      direction: "desc",
      limit: 1,
      highWater,
      last: undefined,
    }),
    ...initialStates.map((state) => checkpointInitialDiscoveryBranch({
      scopeId: input.scopeId,
      checkpointTable,
      timeBound: effectiveTimeBound,
      state,
      direction: "desc",
      limit: 1,
      highWater,
      last: undefined,
    })),
    checkpointRetryDiscoveryBranch({
      scopeId: input.scopeId,
      checkpointTable,
      timeBound: effectiveTimeBound,
      direction: "desc",
      limit: 1,
      highWater,
      last: undefined,
    }),
    checkpointClaimDiscoveryBranch({
      scopeId: input.scopeId,
      checkpointTable,
      timeBound: effectiveTimeBound,
      direction: "desc",
      limit: 1,
      highWater,
      last: undefined,
    }),
  ];
  const pageBranches = [
    pendingDiscoveryBranch({
      scopeId: input.scopeId,
      requestedKind,
      timeBound: effectiveTimeBound,
      direction: "asc",
      limit: input.limitPlusOne,
      highWater,
      last,
    }),
    ...initialStates.map((state) => checkpointInitialDiscoveryBranch({
      scopeId: input.scopeId,
      checkpointTable,
      timeBound: effectiveTimeBound,
      state,
      direction: "asc",
      limit: input.limitPlusOne,
      highWater,
      last,
    })),
    checkpointRetryDiscoveryBranch({
      scopeId: input.scopeId,
      checkpointTable,
      timeBound: effectiveTimeBound,
      direction: "asc",
      limit: input.limitPlusOne,
      highWater,
      last,
    }),
    checkpointClaimDiscoveryBranch({
      scopeId: input.scopeId,
      checkpointTable,
      timeBound: effectiveTimeBound,
      direction: "asc",
      limit: input.limitPlusOne,
      highWater,
      last,
    }),
  ];
  return sql`
    with discovery_context as materialized (
      select
        date_trunc('milliseconds', statement_timestamp()) as database_now,
        coalesce(
          ${timeBound}::timestamptz,
          date_trunc('milliseconds', statement_timestamp())
        ) as time_bound
    ),
    candidate_high_water_heads as materialized (
      ${sql.join(highWaterHeads, sql` union all `)}
    ),
    high_water as materialized (
      select
        ${highWater?.eligibleAt ?? null}::timestamptz as eligible_at,
        ${highWater?.runId ?? null}::text as run_id,
        ${highWater?.requestedEffectSequence ?? null}::bigint
          as requested_effect_sequence
      where ${highWater?.eligibleAt ?? null}::timestamptz is not null
      union all
      (
        select eligible_at, run_id, requested_effect_sequence
        from candidate_high_water_heads
        where ${highWater?.eligibleAt ?? null}::timestamptz is null
        order by eligible_at desc, run_id desc, requested_effect_sequence desc
        limit 1
      )
    ),
    branch_page_candidates as materialized (
      ${sql.join(pageBranches, sql` union all `)}
    ),
    page_candidates as materialized (
      select *
      from branch_page_candidates
      order by
        eligible_at asc,
        run_id asc,
        requested_effect_sequence asc
      limit ${input.limitPlusOne}
    )
    select
      floor(extract(epoch from context.database_now) * 1000)::bigint::text
        as "databaseNowEpochMillisecondsText",
      floor(extract(epoch from context.time_bound) * 1000)::bigint::text
        as "databaseTimeBoundEpochMillisecondsText",
      context.time_bound > context.database_now as "continuationFuture",
      floor(extract(epoch from high_water.eligible_at) * 1000)::bigint::text
        as "highWaterEligibleAtEpochMillisecondsText",
      (
        high_water.eligible_at is null or
        high_water.eligible_at = date_trunc('milliseconds', high_water.eligible_at)
      ) as "highWaterTimestampAligned",
      high_water.run_id as "highWaterRunId",
      high_water.requested_effect_sequence::text
        as "highWaterRequestedEffectSequenceText",
      floor(extract(epoch from candidate.eligible_at) * 1000)::bigint::text
        as "candidateEligibleAtEpochMillisecondsText",
      (
        candidate.eligible_at is null or
        candidate.eligible_at = date_trunc('milliseconds', candidate.eligible_at)
      ) as "candidateTimestampAligned",
      candidate.run_id as "candidateRunId",
      candidate.requested_effect_sequence::text
        as "candidateRequestedEffectSequenceText"
    from discovery_context as context
    left join high_water on true
    left join page_candidates as candidate on true
    order by
      candidate.eligible_at asc nulls last,
      candidate.run_id asc nulls last,
      candidate.requested_effect_sequence asc nulls last
  `;
}

interface DiscoveryBranchInput {
  readonly scopeId: ReplacementScopeIdV1;
  readonly checkpointTable: SQL;
  readonly timeBound: SQL;
  readonly direction: "asc" | "desc";
  readonly limit: number;
  readonly highWater: TaskComputeDeliveryContinuationPositionV1 | undefined;
  readonly last: TaskComputeDeliveryContinuationPositionV1 | undefined;
}

function pendingDiscoveryBranch(
  input: Omit<DiscoveryBranchInput, "checkpointTable"> &
    Readonly<{ readonly requestedKind: string }>,
): SQL {
  const eligibleAt = sql`pending.eligible_at`;
  const identity = Object.freeze({
    eligibleAt,
    runId: sql`pending.run_id`,
    sequence: sql`pending.requested_effect_sequence`,
  });
  return sql`
    (
      select
        ${eligibleAt} as eligible_at,
        pending.run_id,
        pending.requested_effect_sequence
      from fx_system_durable_task_compute_pending_v1 as pending
      join fx_system_durable_task_run_v1 as run
        on run.scope_id = pending.scope_id
        and run.run_id = pending.run_id
      ${pageHighWaterJoin(input.last)}
      where pending.scope_id = ${input.scopeId}
        and run.definition_generation = 'legacy_definition_v1'
        and pending.kind = ${input.requestedKind}
        and ${eligibleAt} <= ${input.timeBound}
        and ${branchPositionPredicate(identity, input.highWater, input.last)}
      order by
        eligible_at ${sql.raw(input.direction)},
        pending.run_id ${sql.raw(input.direction)},
        pending.requested_effect_sequence ${sql.raw(input.direction)}
      limit ${input.limit}
    )
  `;
}

function checkpointInitialDiscoveryBranch(
  input: DiscoveryBranchInput & Readonly<{ readonly state: string }>,
): SQL {
  const eligibleAt = input.timeBound;
  const identity = Object.freeze({
    eligibleAt,
    runId: sql`checkpoint.run_id`,
    sequence: sql`checkpoint.requested_effect_sequence`,
  });
  return sql`
    (
      select
        ${eligibleAt} as eligible_at,
        checkpoint.run_id,
        checkpoint.requested_effect_sequence
      from ${input.checkpointTable} as checkpoint
      join fx_system_durable_task_run_v1 as run
        on run.scope_id = checkpoint.scope_id
        and run.run_id = checkpoint.run_id
      ${pageHighWaterJoin(input.last)}
      where checkpoint.scope_id = ${input.scopeId}
        and run.definition_generation = 'legacy_definition_v1'
        and checkpoint.delivery_state = ${input.state}
        and checkpoint.claim_owner is null
        and checkpoint.next_attempt_at is null
        and ${eligibleAt} <= ${input.timeBound}
        and ${branchPositionPredicate(identity, input.highWater, input.last)}
      order by
        checkpoint.run_id ${sql.raw(input.direction)},
        checkpoint.requested_effect_sequence ${sql.raw(input.direction)}
      limit ${input.limit}
    )
  `;
}

function checkpointRetryDiscoveryBranch(input: DiscoveryBranchInput): SQL {
  const eligibleAt = sql`checkpoint.next_attempt_at`;
  const identity = Object.freeze({
    eligibleAt,
    runId: sql`checkpoint.run_id`,
    sequence: sql`checkpoint.requested_effect_sequence`,
  });
  return sql`
    (
      select
        ${eligibleAt} as eligible_at,
        checkpoint.run_id,
        checkpoint.requested_effect_sequence
      from ${input.checkpointTable} as checkpoint
      join fx_system_durable_task_run_v1 as run
        on run.scope_id = checkpoint.scope_id
        and run.run_id = checkpoint.run_id
      ${pageHighWaterJoin(input.last)}
      where checkpoint.scope_id = ${input.scopeId}
        and run.definition_generation = 'legacy_definition_v1'
        and checkpoint.delivery_state = 'retry_wait'
        and checkpoint.claim_owner is null
        and checkpoint.next_attempt_at <= ${input.timeBound}
        and ${branchPositionPredicate(identity, input.highWater, input.last)}
      order by
        eligible_at ${sql.raw(input.direction)},
        checkpoint.run_id ${sql.raw(input.direction)},
        checkpoint.requested_effect_sequence ${sql.raw(input.direction)}
      limit ${input.limit}
    )
  `;
}

function checkpointClaimDiscoveryBranch(input: DiscoveryBranchInput): SQL {
  const eligibleAt = sql`checkpoint.claim_expires_at`;
  const identity = Object.freeze({
    eligibleAt,
    runId: sql`checkpoint.run_id`,
    sequence: sql`checkpoint.requested_effect_sequence`,
  });
  return sql`
    (
      select
        ${eligibleAt} as eligible_at,
        checkpoint.run_id,
        checkpoint.requested_effect_sequence
      from ${input.checkpointTable} as checkpoint
      join fx_system_durable_task_run_v1 as run
        on run.scope_id = checkpoint.scope_id
        and run.run_id = checkpoint.run_id
      ${pageHighWaterJoin(input.last)}
      where checkpoint.scope_id = ${input.scopeId}
        and run.definition_generation = 'legacy_definition_v1'
        and checkpoint.claim_owner is not null
        and checkpoint.claim_expires_at <= ${input.timeBound}
        and ${branchPositionPredicate(identity, input.highWater, input.last)}
      order by
        eligible_at ${sql.raw(input.direction)},
        checkpoint.run_id ${sql.raw(input.direction)},
        checkpoint.requested_effect_sequence ${sql.raw(input.direction)}
      limit ${input.limit}
    )
  `;
}

function pageHighWaterJoin(
  last: TaskComputeDeliveryContinuationPositionV1 | undefined,
): SQL {
  return last === undefined ? sql`` : sql`cross join high_water`;
}

function branchPositionPredicate(
  identity: Readonly<{
    readonly eligibleAt: SQL;
    readonly runId: SQL;
    readonly sequence: SQL;
  }>,
  highWater: TaskComputeDeliveryContinuationPositionV1 | undefined,
  last: TaskComputeDeliveryContinuationPositionV1 | undefined,
): SQL {
  if (last === undefined) {
    return highWater === undefined
      ? sql`true`
      : sql`false`;
  }
  return sql`
    (${identity.eligibleAt}, ${identity.runId}, ${identity.sequence}) > (
      ${last.eligibleAt}::timestamptz,
      ${last.runId}::text,
      ${last.requestedEffectSequence}::bigint
    )
    and (${identity.eligibleAt}, ${identity.runId}, ${identity.sequence}) <= (
      high_water.eligible_at,
      high_water.run_id,
      high_water.requested_effect_sequence
    )
  `;
}

function captureDiscoveryRows<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  requestedLimit: number,
  rawRows: ReadonlyArray<unknown>,
): Result.Result<
  CapturedDiscoveryRows,
  TaskComputeDeliveryDiscoveryCorruptionError<Operation>
> {
  return Result.gen(function* () {
    if (rawRows.length === 0) {
      return yield* Result.fail(corruption(operation, "metadata_invalid"));
    }
    if (rawRows.length > requestedLimit + 1) {
      return yield* Result.fail(corruption(operation, "candidate_overflow"));
    }
    const first = yield* captureMetadata(operation, rawRows[0]);
    const candidates: CapturedPosition[] = [];
    let nullCandidateCount = 0;
    for (const rawRow of rawRows) {
      const metadata = yield* captureMetadata(operation, rawRow);
      if (!sameMetadata(first, metadata)) {
        return yield* Result.fail(corruption(operation, "metadata_invalid"));
      }
      const candidate = yield* captureCandidate(operation, rawRow);
      if (candidate === null) nullCandidateCount += 1;
      else candidates.push(candidate);
    }
    if (
      nullCandidateCount > 0 &&
      (rawRows.length !== 1 || candidates.length !== 0)
    ) {
      return yield* Result.fail(corruption(operation, "candidate_invalid"));
    }
    for (let index = 1; index < candidates.length; index += 1) {
      const previous = candidates[index - 1];
      const current = candidates[index];
      if (
        previous === undefined ||
        current === undefined ||
        comparePositions(previous, current) >= 0
      ) {
        return yield* Result.fail(
          corruption(operation, "candidate_ordering_invalid"),
        );
      }
    }
    const highWater = first.highWater;
    if (
      highWater !== null &&
      candidates.some((candidate) =>
        comparePositions(candidate, highWater) > 0
      )
    ) {
      return yield* Result.fail(corruption(operation, "high_water_invalid"));
    }
    return Object.freeze({
      databaseNowMilliseconds: first.databaseNowMilliseconds,
      databaseTimeBoundMilliseconds: first.databaseTimeBoundMilliseconds,
      continuationFuture: first.continuationFuture,
      highWater: first.highWater,
      candidates: Object.freeze(candidates),
    });
  });
}

interface CapturedMetadata {
  readonly databaseNowMilliseconds: number;
  readonly databaseTimeBoundMilliseconds: number;
  readonly continuationFuture: boolean;
  readonly highWater: CapturedPosition | null;
}

function captureMetadata<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  rawRow: unknown,
): Result.Result<
  CapturedMetadata,
  TaskComputeDeliveryDiscoveryCorruptionError<Operation>
> {
  const row = asNonArrayRecord(rawRow);
  if (
    row === null ||
    typeof row.continuationFuture !== "boolean" ||
    row.highWaterTimestampAligned !== true
  ) {
    return Result.fail(corruption(operation, "metadata_invalid"));
  }
  const continuationFuture = row.continuationFuture;
  return Result.all({
    databaseNowMilliseconds: decodeEpochMillisecondsText(
      row.databaseNowEpochMillisecondsText,
    ),
    databaseTimeBoundMilliseconds: decodeEpochMillisecondsText(
      row.databaseTimeBoundEpochMillisecondsText,
    ),
    highWater: captureNullablePosition(
      row.highWaterEligibleAtEpochMillisecondsText,
      row.highWaterRunId,
      row.highWaterRequestedEffectSequenceText,
    ),
  }).pipe(
    Result.mapError(() => corruption(operation, "metadata_invalid")),
    Result.map((decoded) => Object.freeze({
      ...decoded,
      continuationFuture,
    })),
  );
}

function captureCandidate<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  rawRow: unknown,
): Result.Result<
  CapturedPosition | null,
  TaskComputeDeliveryDiscoveryCorruptionError<Operation>
> {
  const row = asNonArrayRecord(rawRow);
  if (row === null || row.candidateTimestampAligned !== true) {
    return Result.fail(corruption(operation, "candidate_invalid"));
  }
  return captureNullablePosition(
    row.candidateEligibleAtEpochMillisecondsText,
    row.candidateRunId,
    row.candidateRequestedEffectSequenceText,
  ).pipe(
    Result.mapError(() => corruption(operation, "candidate_invalid")),
  );
}

function captureNullablePosition(
  eligibleAt: unknown,
  runId: unknown,
  sequence: unknown,
): Result.Result<CapturedPosition | null, unknown> {
  if (eligibleAt === null && runId === null && sequence === null) {
    return Result.succeed(null);
  }
  if (typeof runId !== "string") return Result.fail(runId);
  return Result.all({
    eligibleAtMilliseconds: decodeEpochMillisecondsText(eligibleAt),
    runId: decodeTaskRunIdResult(runId),
    requestedEffectSequence: decodeTaskRequestedEffectSequenceV1(sequence),
  }).pipe(Result.map((position) => Object.freeze(position)));
}

function decodeEpochMillisecondsText(
  value: unknown,
): Result.Result<number, unknown> {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(value);
  }
  try {
    const milliseconds = Number(BigInt(value));
    return Number.isSafeInteger(milliseconds) &&
        Number.isFinite(new Date(milliseconds).valueOf())
      ? Result.succeed(milliseconds)
      : Result.fail(value);
  } catch (cause) {
    return Result.fail(cause);
  }
}

function makeDiscoveryPage<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  input: ValidatedDiscoveryInput,
  captured: CapturedDiscoveryRows,
): TaskComputeDeliveryCandidatePage<Operation> {
  const selected = captured.candidates.slice(0, input.limit);
  const candidates = Object.freeze(selected.map((candidate) => Object.freeze({
    operation,
    eligibleAt: new Date(candidate.eligibleAtMilliseconds).toISOString(),
    runId: candidate.runId,
    requestedEffectSequence: candidate.requestedEffectSequence,
  })));
  const last = selected.at(-1);
  const continuation = captured.candidates.length > input.limit &&
      captured.highWater !== null &&
      last !== undefined
    ? Object.freeze({
      codecVersion: 1 as const,
      operation,
      databaseTimeBound: new Date(
        captured.databaseTimeBoundMilliseconds,
      ).toISOString(),
      highWater: continuationPosition(captured.highWater),
      last: continuationPosition(last),
    }) satisfies TaskComputeDeliveryContinuationV1<Operation>
    : null;
  return Object.freeze({
    operation,
    databaseTimeBound: new Date(
      captured.databaseTimeBoundMilliseconds,
    ).toISOString(),
    candidates,
    continuation,
  });
}

function continuationPosition(
  position: CapturedPosition,
): TaskComputeDeliveryContinuationPositionV1 {
  return Object.freeze({
    eligibleAt: new Date(position.eligibleAtMilliseconds).toISOString(),
    runId: position.runId,
    requestedEffectSequence: position.requestedEffectSequence.toString(),
  });
}

function captureContinuationPosition(
  position: TaskComputeDeliveryContinuationPositionV1,
): TaskComputeDeliveryContinuationPositionV1 {
  return Object.freeze({
    eligibleAt: position.eligibleAt,
    runId: position.runId,
    requestedEffectSequence: position.requestedEffectSequence,
  });
}

function comparePositions(
  left: TaskComputeDeliveryContinuationPositionV1 | CapturedPosition,
  right: TaskComputeDeliveryContinuationPositionV1 | CapturedPosition,
): number {
  const leftMilliseconds = "eligibleAt" in left
    ? Date.parse(left.eligibleAt)
    : left.eligibleAtMilliseconds;
  const rightMilliseconds = "eligibleAt" in right
    ? Date.parse(right.eligibleAt)
    : right.eligibleAtMilliseconds;
  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds < rightMilliseconds ? -1 : 1;
  }
  if (left.runId !== right.runId) return left.runId < right.runId ? -1 : 1;
  const leftSequence = "requestedEffectSequence" in left &&
      typeof left.requestedEffectSequence === "string"
    ? BigInt(left.requestedEffectSequence)
    : left.requestedEffectSequence;
  const rightSequence = "requestedEffectSequence" in right &&
      typeof right.requestedEffectSequence === "string"
    ? BigInt(right.requestedEffectSequence)
    : right.requestedEffectSequence;
  if (leftSequence === rightSequence) return 0;
  return leftSequence < rightSequence ? -1 : 1;
}

function sameMetadata(left: CapturedMetadata, right: CapturedMetadata): boolean {
  return left.databaseNowMilliseconds === right.databaseNowMilliseconds &&
    left.databaseTimeBoundMilliseconds === right.databaseTimeBoundMilliseconds &&
    left.continuationFuture === right.continuationFuture &&
    (
      left.highWater === null
        ? right.highWater === null
        : right.highWater !== null &&
          comparePositions(left.highWater, right.highWater) === 0
    );
}

const runDiscoveryTransaction = Effect.fn(
  "TaskComputeDeliveryDiscovery.transaction",
)(function* <Operation extends TaskComputeDeliveryOperation, Value>(
  operation: Operation,
  runLocatedTransaction: <ResultValue>(
    work: (tx: AppRowTransaction) => Promise<ResultValue>,
  ) => Promise<ResultValue>,
  work: (tx: AppRowTransaction) => Promise<Value>,
): Effect.fn.Return<Value, TaskComputeDeliveryDiscoveryError<Operation>> {
  const settled = yield* Effect.exit(Effect.uninterruptible(Effect.tryPromise({
    try: () => runLocatedTransaction(work),
    catch: (cause) => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = yield* Cause.findError(settled.cause).pipe(
    Result.match({
      onFailure: (cause) => Effect.failCause(cause),
      onSuccess: Effect.succeed,
    }),
  );
  if (!(failure instanceof LocatedReadCommittedTransactionFailureV1)) {
    return yield* Effect.die(failure);
  }
  switch (failure.issue.kind) {
    case "callbackRolledBack":
      if (failure.issue.callbackCause instanceof DiscoveryRollback) {
        return yield* Effect.fail(failure.issue.callbackCause.error);
      }
      return yield* Effect.fail(new TaskComputeDeliveryDiscoverySqlError({
        operation,
        phase: "transaction",
        cause: failure,
      }));
    case "callbackCleanupFailed":
      if (failure.issue.callbackCause instanceof DiscoveryRollback) {
        return yield* Effect.failCause(Cause.combine(
          Cause.fail(failure.issue.callbackCause.error),
          Cause.die(failure),
        ));
      }
      return yield* Effect.fail(new TaskComputeDeliveryDiscoverySqlError({
        operation,
        phase: "cleanup",
        cause: failure,
      }));
    case "decisionUncertain":
      return yield* Effect.fail(new TaskComputeDeliveryDiscoverySqlError({
        operation,
        phase: "decision_uncertain",
        cause: failure,
      }));
    case "infrastructureFailure":
      return yield* Effect.fail(new TaskComputeDeliveryDiscoverySqlError({
        operation,
        phase: "transaction",
        cause: failure,
      }));
  }
});

class DiscoveryRollback<Operation extends TaskComputeDeliveryOperation> {
  constructor(readonly error: TaskComputeDeliveryDiscoveryError<Operation>) {}
}

function discoveryRollback<Operation extends TaskComputeDeliveryOperation>(
  error: TaskComputeDeliveryDiscoveryError<Operation>,
): DiscoveryRollback<Operation> {
  return new DiscoveryRollback(error);
}

function corruption<Operation extends TaskComputeDeliveryOperation>(
  operation: Operation,
  reason: TaskComputeDeliveryDiscoveryCorruptionReason,
  cause?: unknown,
): TaskComputeDeliveryDiscoveryCorruptionError<Operation> {
  return new TaskComputeDeliveryDiscoveryCorruptionError<Operation>({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

const INVALID_DRIVER_RESULT = Symbol(
  "FlarexDB/invalidTaskComputeDeliveryDiscoveryDriverResult",
);

const INVALID_INPUT_CAPTURE = Symbol(
  "FlarexDB/invalidTaskComputeDeliveryDiscoveryInputCapture",
);

function capturePlainDataTree(
  input: unknown,
): unknown | typeof INVALID_INPUT_CAPTURE {
  try {
    return capturePlainDataValue(input, new WeakSet<object>());
  } catch {
    return INVALID_INPUT_CAPTURE;
  }
}

function capturePlainDataValue(
  value: unknown,
  seen: WeakSet<object>,
): unknown | typeof INVALID_INPUT_CAPTURE {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value) || seen.has(value)) return INVALID_INPUT_CAPTURE;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return INVALID_INPUT_CAPTURE;
  }
  seen.add(value);
  const captured: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return INVALID_INPUT_CAPTURE;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) return INVALID_INPUT_CAPTURE;
    const nested = capturePlainDataValue(descriptor.value, seen);
    if (nested === INVALID_INPUT_CAPTURE) return INVALID_INPUT_CAPTURE;
    Object.defineProperty(captured, key, {
      value: nested,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  seen.delete(value);
  return captured;
}
