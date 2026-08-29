import {
  decodeTaskAttemptHistoryRunVersion,
  decodeTaskAttemptHistoryStoreItem,
  MAX_TASK_ATTEMPT_HISTORY_ENTRIES,
  TaskAttemptHistoryStoreFailure,
  type ApplicationTaskAttemptHistoryStoreShape,
  type TaskAttemptHistoryStoreItem,
  type TaskAttemptHistoryStoreSnapshot,
  type ApplicationTaskRunListStoreShape,
} from "@flarex/durable-task/internal/run-projection";
import {
  decodeTaskDatabaseTimeMsV1,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type TaskDatabaseTimeMsV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, asc, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import { makeApplicationTaskRunListStore } from
  "./applicationTaskRunListStore";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
} from "./taskSystemScopeAuthorityV1";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const OPERATION = "list_task_attempts" as const;
const ApplicationTaskReadStoreType = Symbol("ApplicationTaskReadStore");
const applicationTaskReadStoreIssueToken = Symbol(
  "ApplicationTaskReadStore.issue",
);
const issuedApplicationTaskReadStores = new WeakSet<object>();

/** Opaque located owner for list, point, and attempt-history Task reads. */
export interface ApplicationTaskReadStore
  extends ApplicationTaskAttemptHistoryStoreShape,
    Pick<ApplicationTaskSystemRunAttemptStoreShape, "inspectRunAttempt">,
    ApplicationTaskRunListStoreShape {
  readonly [ApplicationTaskReadStoreType]: true;
}

class ApplicationTaskReadStoreHandle implements ApplicationTaskReadStore {
  declare readonly [ApplicationTaskReadStoreType]: true;

  constructor(
    issueToken: typeof applicationTaskReadStoreIssueToken,
    readonly inspectRunAttempt:
      ApplicationTaskReadStore["inspectRunAttempt"],
    readonly listRuns: ApplicationTaskReadStore["listRuns"],
    readonly listAttempts: ApplicationTaskReadStore["listAttempts"],
  ) {
    if (issueToken !== applicationTaskReadStoreIssueToken) {
      throw new TypeError("Application Task read store issuance is unavailable.");
    }
    issuedApplicationTaskReadStores.add(this);
    Object.freeze(this);
  }
}

/** Constructs one private scope-bound Application Task attempt-history store. */
export function makeApplicationTaskAttemptHistoryStore(
  located: LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>,
): ApplicationTaskReadStore {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  const inspectRunAttempt =
    makeApplicationTaskSystemRunAttemptStoreV1(located).inspectRunAttempt;
  const listRuns = makeApplicationTaskRunListStore(located).listRuns;
  return new ApplicationTaskReadStoreHandle(
    applicationTaskReadStoreIssueToken,
    inspectRunAttempt,
    listRuns,
    (runId: TaskRunIdV1) =>
      listAttempts(authority, target, runId),
  );
}

export function isApplicationTaskReadStore(
  candidate: unknown,
): candidate is ApplicationTaskReadStore {
  return typeof candidate === "object"
    && candidate !== null
    && issuedApplicationTaskReadStores.has(candidate);
}

const listAttempts = Effect.fn("ApplicationTaskAttemptHistoryStore.list")(
  function* (
    authority: TrustedScopeAuthority,
    target: LocatedReadCommittedAttemptTargetV1,
    runId: TaskRunIdV1,
  ): Effect.fn.Return<
    TaskAttemptHistoryStoreSnapshot,
    TaskAttemptHistoryStoreFailure
  > {
    const settled = yield* Effect.exit(awaitLocatedTransaction(
      target[RUN_LOCATED_READ_COMMITTED_V1](tx =>
        listAttemptsOnce(tx, authority, target, runId)
      ),
    ));
    if (Exit.isSuccess(settled)) return settled.value;

    const cause = yield* Result.match(Cause.findError(settled.cause), {
      onFailure: Effect.failCause,
      onSuccess: Effect.succeed,
    });
    const classified = classifyTransactionFailure(runId, cause);
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

async function listAttemptsOnce(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  runId: TaskRunIdV1,
): Promise<TaskAttemptHistoryStoreSnapshot> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => rollback(failure(runId, "stale_scope_authority", mismatch)),
  );
  const rows = await tx.select({
    runVersion: fxSystemDurableTaskRunsV1.runVersion,
    attemptId: fxSystemDurableTaskAttemptIdentitiesV1.attemptId,
    attemptNumber: fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber,
    acceptedRunVersion:
      fxSystemDurableTaskAttemptIdentitiesV1.acceptedRunVersion,
  }).from(fxSystemDurableTaskRunsV1).leftJoin(
    fxSystemDurableTaskAttemptIdentitiesV1,
    and(
      eq(
        fxSystemDurableTaskAttemptIdentitiesV1.scopeId,
        fxSystemDurableTaskRunsV1.scopeId,
      ),
      eq(
        fxSystemDurableTaskAttemptIdentitiesV1.runId,
        fxSystemDurableTaskRunsV1.runId,
      ),
    ),
  ).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, runId),
    eq(fxSystemDurableTaskRunsV1.definitionGeneration, "application_v1"),
  )).orderBy(
    asc(fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber),
  ).limit(MAX_TASK_ATTEMPT_HISTORY_ENTRIES + 1);
  const first = rows[0];
  if (first === undefined) {
    throw rollback(failure(runId, "run_not_found", null));
  }
  const runVersion = Result.getOrThrowWith(
    decodeTaskAttemptHistoryRunVersion(first.runVersion),
    cause => rollback(failure(runId, "corrupt_data", cause)),
  );
  const observedAtMs = await readDatabaseNow(tx, authority.scopeId, runId);
  const attempts: TaskAttemptHistoryStoreItem[] = [];
  for (const row of rows) {
    if (
      row.attemptId === null
      && row.attemptNumber === null
      && row.acceptedRunVersion === null
    ) {
      if (rows.length === 1) continue;
      throw rollback(failure(runId, "corrupt_data", row));
    }
    attempts.push(Result.getOrThrowWith(
      decodeTaskAttemptHistoryStoreItem({
        attemptId: row.attemptId,
        attemptNumber: row.attemptNumber,
        acceptedRunVersion: row.acceptedRunVersion,
      }),
      cause => rollback(failure(runId, "corrupt_data", cause)),
    ));
  }
  return Object.freeze({
    observedAtMs,
    runVersion,
    attempts: Object.freeze(attempts),
  });
}

async function readDatabaseNow(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  runId: TaskRunIdV1,
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
    throw rollback(failure(runId, "corrupt_data", value));
  }
  return Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(value)),
    cause => rollback(failure(runId, "corrupt_data", cause)),
  );
}

function awaitLocatedTransaction<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => transaction,
    catch: cause => cause,
  }));
}

class AttemptHistoryRollback {
  constructor(readonly error: TaskAttemptHistoryStoreFailure) {}
}

function rollback(
  error: TaskAttemptHistoryStoreFailure,
): AttemptHistoryRollback {
  return new AttemptHistoryRollback(error);
}

function failure(
  runId: TaskRunIdV1,
  reason: TaskAttemptHistoryStoreFailure["reason"],
  cause: unknown,
): TaskAttemptHistoryStoreFailure {
  return new TaskAttemptHistoryStoreFailure({
    operation: OPERATION,
    runId,
    reason,
    cause,
  });
}

type ClassifiedTransactionFailure =
  | Readonly<{
      readonly kind: "fail";
      readonly error: TaskAttemptHistoryStoreFailure;
    }>
  | Readonly<{
      readonly kind: "cleanup";
      readonly error: TaskAttemptHistoryStoreFailure;
      readonly cause: LocatedReadCommittedTransactionFailureV1;
    }>
  | Readonly<{ readonly kind: "defect"; readonly cause: unknown }>;

function classifyTransactionFailure(
  runId: TaskRunIdV1,
  cause: unknown,
): ClassifiedTransactionFailure {
  if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
    return Object.freeze({ kind: "defect", cause });
  }
  switch (cause.issue.kind) {
    case "callbackRolledBack": {
      const expected = unwrapRollback(cause.issue.callbackCause);
      if (expected !== null) {
        return Object.freeze({ kind: "fail", error: expected });
      }
      const known = classifySqlFailure(
        runId,
        cause.issue.callbackCause,
        cause,
      );
      return known === null
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "fail", error: known });
    }
    case "callbackCleanupFailed": {
      const expected = unwrapRollback(cause.issue.callbackCause);
      const classified = expected ?? classifySqlFailure(
        runId,
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
        error: failure(runId, "transient", cause),
      });
    case "infrastructureFailure": {
      const known = classifySqlFailure(runId, cause.issue.cause, cause);
      if (known !== null) return Object.freeze({ kind: "fail", error: known });
      return Object.freeze({
        kind: "fail",
        error: failure(
          runId,
          cause.issue.phase === "beginOrConfigure"
            ? "unsupported"
            : "unavailable",
          cause,
        ),
      });
    }
  }
}

function unwrapRollback(
  cause: unknown,
): TaskAttemptHistoryStoreFailure | null {
  return cause instanceof AttemptHistoryRollback ? cause.error : null;
}

function classifySqlFailure(
  runId: TaskRunIdV1,
  sqlCause: unknown,
  retainedCause: unknown,
): TaskAttemptHistoryStoreFailure | null {
  const code = sqlState(sqlCause);
  return code?.startsWith("08") === true || code === "57014"
    || code === "55P03" || code === "40001" || code === "40P01"
    ? failure(runId, "transient", retainedCause)
    : null;
}

function sqlState(cause: unknown): string | null {
  if (cause === null || typeof cause !== "object") return null;
  const code = Reflect.get(cause, "code");
  return typeof code === "string" ? code : null;
}
