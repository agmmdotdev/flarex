import {
  TaskRunListStoreFailure,
  decodeTaskRunListStoreItem,
  type ApplicationTaskRunListStoreShape,
  type TaskRunListStoreItem,
  type TaskRunListStorePage,
  type TaskRunListStoreRequest,
} from "@flarex/durable-task/internal/run-projection";
import {
  decodeTaskDatabaseTimeMsV1,
  TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
  type TaskDatabaseTimeMsV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, desc, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { Cause, Effect, Encoding, Exit, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import { fxSystemDurableTaskRunsV1, fxSystemScopeClocks } from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
} from "./taskSystemScopeAuthorityV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const OPERATION = "list_task_runs" as const;

/**
 * Constructs one private, scope-bound Application Task run list store.
 * The returned capability cannot select a tenant or bypass captured authority.
 */
export function makeApplicationTaskRunListStore(
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
): ApplicationTaskRunListStoreShape {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  return Object.freeze({
    listRuns: (request: TaskRunListStoreRequest) =>
      listRuns(authority, target, request),
  });
}

const listRuns = Effect.fn("ApplicationTaskRunListStore.listRuns")(
  function* (
    authority: TrustedScopeAuthority,
    target: LocatedReadCommittedAttemptTargetV1,
    request: TaskRunListStoreRequest,
  ): Effect.fn.Return<TaskRunListStorePage, TaskRunListStoreFailure> {
    const settled = yield* Effect.exit(awaitLocatedTransaction(
      target[RUN_LOCATED_READ_COMMITTED_V1](tx =>
        listRunsOnce(tx, authority, target, request)
      ),
    ));
    if (Exit.isSuccess(settled)) return settled.value;

    const cause = yield* Result.match(Cause.findError(settled.cause), {
      onFailure: Effect.failCause,
      onSuccess: Effect.succeed,
    });
    const classified = classifyTransactionFailure(cause);
    switch (classified.kind) {
      case "fail":
        return yield* classified.error;
      case "cleanup":
        return yield* Effect.failCause(Cause.combine(
          Cause.fail(classified.error),
          Cause.die(classified.cause),
        ));
      case "defect":
        return yield* Effect.die(classified.cause);
    }
  },
);

async function listRunsOnce(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  request: TaskRunListStoreRequest,
): Promise<TaskRunListStorePage> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => rollback(failure("stale_scope_authority", mismatch)),
  );
  const cursor = request.cursor;
  const cursorFilter = cursor === null
    ? undefined
    : or(
        lt(
          fxSystemDurableTaskRunsV1.createdAtMs,
          BigInt(cursor.createdAtMs),
        ),
        and(
          eq(
            fxSystemDurableTaskRunsV1.createdAtMs,
            BigInt(cursor.createdAtMs),
          ),
          sql`${fxSystemDurableTaskRunsV1.runId} collate "C" < ${cursor.runId}`,
        ),
      );
  const rows = await tx.select({
    runId: fxSystemDurableTaskRunsV1.runId,
    createdAtMs: fxSystemDurableTaskRunsV1.createdAtMs,
    aggregateCodecVersion: fxSystemDurableTaskRunsV1.aggregateCodecVersion,
    runVersion: fxSystemDurableTaskRunsV1.runVersion,
    phase: fxSystemDurableTaskRunsV1.phase,
    envelopeCodec: sql<string | null>`
      ${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{codec}'
    `,
    aggregateVersion: sql<string | null>`
      ${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{aggregate,version}'
    `,
    aggregateRunId: sql<string | null>`
      ${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{aggregate,runId}'
    `,
    aggregateCreatedAtMs: sql<string | null>`
      ${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{aggregate,createdAtMs}'
    `,
    aggregateRunVersion: sql<string | null>`
      ${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{aggregate,runVersion}'
    `,
    aggregatePhase: sql<string | null>`
      ${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{aggregate,phase}'
    `,
    state: taskRunListStateJson(),
  }).from(fxSystemDurableTaskRunsV1).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.definitionGeneration, "application_v1"),
    cursorFilter,
  )).orderBy(
    desc(fxSystemDurableTaskRunsV1.createdAtMs),
    sql`${fxSystemDurableTaskRunsV1.runId} collate "C" desc`,
  ).limit(request.pageSize + 1);

  // READ COMMITTED takes a new snapshot per statement. Reading database time
  // after the page query guarantees it cannot precede any event visible to
  // that query; the reverse order can race a concurrent lifecycle commit.
  const observedAtMs = await readDatabaseNow(tx, authority.scopeId);
  const hasMore = rows.length > request.pageSize;
  const pageRows = hasMore ? rows.slice(0, request.pageSize) : rows;
  const runs: TaskRunListStoreItem[] = [];
  for (const row of pageRows) runs.push(decodeRow(row));
  return Object.freeze({
    observedAtMs,
    runs: Object.freeze(runs),
    hasMore,
  });
}

async function readDatabaseNow(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
): Promise<TaskDatabaseTimeMsV1> {
  const rows = await tx.select({
    milliseconds: sql<string>`
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
    `,
  }).from(fxSystemScopeClocks).where(
    eq(fxSystemScopeClocks.scopeId, scopeId),
  ).limit(1);
  const value = rows[0]?.milliseconds;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw rollback(failure("corrupt_data", value));
  }
  return Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(value)),
    cause => rollback(failure("corrupt_data", cause)),
  );
}

function decodeRow(input: Readonly<{
  readonly runId: unknown;
  readonly createdAtMs: unknown;
  readonly aggregateCodecVersion: unknown;
  readonly runVersion: unknown;
  readonly phase: unknown;
  readonly envelopeCodec: unknown;
  readonly aggregateVersion: unknown;
  readonly aggregateRunId: unknown;
  readonly aggregateCreatedAtMs: unknown;
  readonly aggregateRunVersion: unknown;
  readonly aggregatePhase: unknown;
  readonly state: unknown;
}>): TaskRunListStoreItem {
  if (
    typeof input.runId !== "string"
    || input.aggregateRunId !== input.runId
    || typeof input.createdAtMs !== "bigint"
    || input.aggregateCreatedAtMs !== input.createdAtMs.toString()
    || input.aggregateCodecVersion !== 1
    || input.envelopeCodec !== TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1
    || input.aggregateVersion !== "flarex.task-run-attempt-aggregate.v1"
    || typeof input.runVersion !== "bigint"
    || input.aggregateRunVersion !== input.runVersion.toString()
    || typeof input.phase !== "string"
    || input.aggregatePhase !== input.phase
  ) {
    throw rollback(failure("corrupt_data", "row_correlation_invalid"));
  }
  const createdAtMs = typeof input.createdAtMs === "bigint"
    ? Number(input.createdAtMs)
    : input.createdAtMs;
  const state = Result.getOrThrowWith(
    normalizeSucceededResult(input.state),
    cause => rollback(failure("corrupt_data", cause)),
  );
  return Result.getOrThrowWith(
    decodeTaskRunListStoreItem({
      runId: input.runId,
      createdAtMs,
      runVersion: input.runVersion,
      state,
    }),
    cause => rollback(failure("corrupt_data", cause)),
  );
}

function normalizeSucceededResult(
  state: unknown,
): Result.Result<unknown, "invalid_result_sha256"> {
  if (!isNonArrayRecord(state) || state.kind !== "succeeded") {
    return Result.succeed(state);
  }
  const result = state.result;
  if (result === null) return Result.succeed(state);
  if (!isNonArrayRecord(result)) return Result.fail("invalid_result_sha256");
  const spelling = result.sha256Base64Url;
  if (typeof spelling !== "string" || spelling.length !== 43) {
    return Result.fail("invalid_result_sha256");
  }
  return Encoding.decodeBase64Url(spelling).pipe(
    Result.mapError(() => "invalid_result_sha256" as const),
    Result.flatMap(bytes =>
      bytes.byteLength === 32 && Encoding.encodeBase64Url(bytes) === spelling
        ? Result.succeed(bytes)
        : Result.fail("invalid_result_sha256" as const)
    ),
    Result.map(bytes => {
      const { sha256Base64Url: _, ...resultWithoutSha256 } = result;
      return {
        ...state,
        result: {
          ...resultWithoutSha256,
          sha256Hex: Encoding.encodeHex(bytes),
        },
      };
    }),
  );
}

function taskRunListStateJson(): SQL<unknown> {
  const row = fxSystemDurableTaskRunsV1;
  const aggregate = row.aggregateJson;
  return sql<unknown>`case ${row.phase}
    when 'ready' then jsonb_build_object(
      'kind', 'ready',
      'eligibleAtMs', ${aggregate} #> '{aggregate,ready,eligibleAtMs}',
      'retry', case
        when ${aggregate} #>> '{aggregate,ready,kind}' = 'immediate_retry'
        then jsonb_build_object(
          'previousAttemptNumber', ${aggregate} #> '{aggregate,ready,acceptedRetry,previousAttempt,attemptNumber}',
          'acceptedAtMs', ${aggregate} #> '{aggregate,ready,acceptedRetry,acceptedAtMs}',
          'eligibleAtMs', ${aggregate} #> '{aggregate,ready,acceptedRetry,notBeforeMs}',
          'nextComputeProfile', ${aggregate} #> '{aggregate,ready,acceptedRetry,nextComputeProfile}',
          'cause', jsonb_build_object(
            'kind', ${aggregate} #> '{aggregate,ready,acceptedRetry,cause,kind}',
            'failure', jsonb_build_object(
              'kind', ${aggregate} #> '{aggregate,ready,acceptedRetry,cause,failure,kind}',
              'code', ${aggregate} #> '{aggregate,ready,acceptedRetry,cause,failure,code}'
            )
          )
        ) else null end,
      'cancellation', jsonb_build_object(
        'kind', ${aggregate} #> '{aggregate,cancellation,kind}'
      )
    )
    when 'attempt_granted' then ${activeStateJson("attempt_granted")}
    when 'executing' then ${activeStateJson("executing")}
    when 'retry_waiting' then jsonb_build_object(
      'kind', 'retry_waiting',
      'retry', ${retryJson("retry")},
      'cancellation', jsonb_build_object(
        'kind', ${aggregate} #> '{aggregate,cancellation,kind}'
      )
    )
    when 'terminal' then case ${aggregate} #>> '{aggregate,terminal,kind}'
      when 'succeeded' then jsonb_build_object(
        'kind', 'succeeded',
        'completedAtMs', ${aggregate} #> '{aggregate,terminal,completedAtMs}',
        'attemptNumber', ${aggregate} #> '{aggregate,terminal,attempt,attemptNumber}',
        'executionDurationMs', ${aggregate} #> '{aggregate,terminal,executionDurationMs}',
        'result', case
          when ${aggregate} #> '{aggregate,terminal,result}' = 'null'::jsonb
          then null
          else jsonb_build_object(
            'codec', ${aggregate} #> '{aggregate,terminal,result,codec}',
            'byteLength', ${aggregate} #> '{aggregate,terminal,result,byteLength}',
            'sha256Base64Url', ${aggregate} #> '{aggregate,terminal,result,sha256,$flarex.uint8array.v1}'
          ) end,
        'cancellation', ${terminalCancellationJson()}
      )
      when 'failed' then jsonb_build_object(
        'kind', 'failed',
        'completedAtMs', ${aggregate} #> '{aggregate,terminal,completedAtMs}',
        'attemptNumber', ${aggregate} #> '{aggregate,terminal,attempt,attemptNumber}',
        'executionDurationMs', ${aggregate} #> '{aggregate,terminal,executionDurationMs}',
        'failure', jsonb_build_object(
          'kind', ${aggregate} #> '{aggregate,terminal,failure,kind}',
          'code', ${aggregate} #> '{aggregate,terminal,failure,code}'
        ),
        'cancellation', ${terminalCancellationJson()}
      )
      when 'cancelled' then jsonb_build_object(
        'kind', 'cancelled',
        'completedAtMs', ${aggregate} #> '{aggregate,terminal,completedAtMs}',
        'attemptNumber', ${aggregate} #> '{aggregate,terminal,attempt,attemptNumber}',
        'executionDurationMs', ${aggregate} #> '{aggregate,terminal,executionDurationMs}',
        'cancellation', ${terminalCancellationJson()}
      )
      else null end
    else null end`;
}

function activeStateJson(kind: "attempt_granted" | "executing"): SQL<unknown> {
  const aggregate = fxSystemDurableTaskRunsV1.aggregateJson;
  return sql<unknown>`jsonb_build_object(
    'kind', ${sql.raw(`'${kind}'`)},
    'attempt', jsonb_build_object(
      'attemptNumber', ${aggregate} #> '{aggregate,currentAttempt,attemptNumber}',
      'computeProfile', ${aggregate} #> '{aggregate,currentAttempt,computeProfile}',
      'grantedAtMs', ${aggregate} #> '{aggregate,currentAttempt,grantedAtMs}',
      'leaseExpiresAtMs', ${aggregate} #> '{aggregate,currentAttempt,lease,expiresAtMs}'
    ),
    'cancellation', case ${aggregate} #>> '{aggregate,cancellation,kind}'
      when 'requested'
      then jsonb_build_object(
        'kind', 'requested',
        'code', ${aggregate} #> '{aggregate,cancellation,reason,code}',
        'requestedAtMs', ${aggregate} #> '{aggregate,cancellation,requestedAtMs}'
      )
      when 'not_requested' then jsonb_build_object('kind', 'not_requested')
      else null end
  )`;
}

function retryJson(path: "retry"): SQL<unknown> {
  const aggregate = fxSystemDurableTaskRunsV1.aggregateJson;
  return sql<unknown>`jsonb_build_object(
    'previousAttemptNumber', ${aggregate} #> '{aggregate,${sql.raw(path)},previousAttempt,attemptNumber}',
    'acceptedAtMs', ${aggregate} #> '{aggregate,${sql.raw(path)},acceptedAtMs}',
    'eligibleAtMs', ${aggregate} #> '{aggregate,${sql.raw(path)},notBeforeMs}',
    'nextComputeProfile', ${aggregate} #> '{aggregate,${sql.raw(path)},nextComputeProfile}',
    'cause', jsonb_build_object(
      'kind', ${aggregate} #> '{aggregate,${sql.raw(path)},cause,kind}',
      'failure', jsonb_build_object(
        'kind', ${aggregate} #> '{aggregate,${sql.raw(path)},cause,failure,kind}',
        'code', ${aggregate} #> '{aggregate,${sql.raw(path)},cause,failure,code}'
      )
    )
  )`;
}

function terminalCancellationJson(): SQL<unknown> {
  const aggregate = fxSystemDurableTaskRunsV1.aggregateJson;
  return sql<unknown>`case
    when ${aggregate} #>> '{aggregate,cancellation,kind}' = 'not_requested'
    then jsonb_build_object('kind', 'not_requested')
    else jsonb_build_object(
      'kind', 'resolved',
      'code', ${aggregate} #> '{aggregate,cancellation,reason,code}',
      'requestedAtMs', ${aggregate} #> '{aggregate,cancellation,requestedAtMs}',
      'resolvedAtMs', ${aggregate} #> '{aggregate,cancellation,resolvedAtMs}',
      'resolution', ${aggregate} #> '{aggregate,cancellation,resolution}'
    ) end`;
}

function awaitLocatedTransaction<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => transaction,
    catch: cause => cause,
  }));
}

class ListRollback {
  constructor(readonly error: TaskRunListStoreFailure) {}
}

function rollback(error: TaskRunListStoreFailure): ListRollback {
  return new ListRollback(error);
}

function failure(
  reason: TaskRunListStoreFailure["reason"],
  cause: unknown,
): TaskRunListStoreFailure {
  return new TaskRunListStoreFailure({ operation: OPERATION, reason, cause });
}

type ClassifiedTransactionFailure =
  | Readonly<{ readonly kind: "fail"; readonly error: TaskRunListStoreFailure }>
  | Readonly<{
      readonly kind: "cleanup";
      readonly error: TaskRunListStoreFailure;
      readonly cause: LocatedReadCommittedTransactionFailureV1;
    }>
  | Readonly<{ readonly kind: "defect"; readonly cause: unknown }>;

function classifyTransactionFailure(cause: unknown): ClassifiedTransactionFailure {
  if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
    return Object.freeze({ kind: "defect", cause });
  }
  switch (cause.issue.kind) {
    case "callbackRolledBack": {
      const expected = unwrapRollback(cause.issue.callbackCause);
      if (expected !== null) return Object.freeze({ kind: "fail", error: expected });
      const known = classifySqlFailure(cause.issue.callbackCause, cause);
      return known === null
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "fail", error: known });
    }
    case "callbackCleanupFailed": {
      const expected = unwrapRollback(cause.issue.callbackCause);
      const classified = expected ?? classifySqlFailure(
        cause.issue.callbackCause,
        cause,
      );
      return classified === null
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "cleanup", error: classified, cause });
    }
    case "decisionUncertain":
      return Object.freeze({
        kind: "fail",
        error: failure("transient", cause),
      });
    case "infrastructureFailure": {
      const known = classifySqlFailure(cause.issue.cause, cause);
      if (known !== null) return Object.freeze({ kind: "fail", error: known });
      return Object.freeze({
        kind: "fail",
        error: failure(
          cause.issue.phase === "beginOrConfigure" ? "unsupported" : "unavailable",
          cause,
        ),
      });
    }
  }
}

function unwrapRollback(cause: unknown): TaskRunListStoreFailure | null {
  return cause instanceof ListRollback ? cause.error : null;
}

function classifySqlFailure(
  sqlCause: unknown,
  retainedCause: unknown,
): TaskRunListStoreFailure | null {
  const code = sqlState(sqlCause);
  return code?.startsWith("08") === true || code === "57014"
    || code === "55P03" || code === "40001" || code === "40P01"
    ? failure("transient", retainedCause)
    : null;
}

function sqlState(cause: unknown): string | null {
  if (cause === null || typeof cause !== "object") return null;
  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : null;
}
