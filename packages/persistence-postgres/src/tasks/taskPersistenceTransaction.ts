import { Data, Effect, Result } from "effect";
import type { LocatedReadCommittedAttemptTargetV1 } from "../database/locatedTransactionIdentity";
import { runLocatedEffectTransaction } from "../database/locatedEffectTransaction";
import type { AppRowTransaction } from "../storage/documents/appRows";
import { configureTaskRepairPostgresTransactionDeadlinesV1,
  type TaskRepairPostgresDeadlinePolicyV1 } from "./taskRepairPostgresDeadlinePolicyV1";

/** The existing located target with authenticated resource provenance. Generic
 * database targets cannot prove bounded pool acquisition or startup admission. */
export interface DeadlineOwnedTaskPersistenceTarget extends LocatedReadCommittedAttemptTargetV1 {
  readonly _DeadlineOwnedTaskPersistenceTarget: unique symbol;
}
const targets = new WeakMap<object, Readonly<{ policy: TaskRepairPostgresDeadlinePolicyV1;
  lane: "postgres" | "pgliteTest" }>>();

/** INTERNAL resource-construction seam. Only the existing deadline-owned
 * PostgreSQL pool factory and explicit in-process PGlite test owner call this.
 * Recording a policy on an arbitrary located target is not public admission. */
export function retainDeadlineOwnedTaskPersistenceTargetInternal<Target extends LocatedReadCommittedAttemptTargetV1>(
  target: Target,
  policy: TaskRepairPostgresDeadlinePolicyV1,
  lane: "postgres" | "pgliteTest",
): Target & DeadlineOwnedTaskPersistenceTarget {
  targets.set(target, Object.freeze({ policy: Object.freeze({ ...policy }), lane }));
  // SAFETY: the private registry authenticates the exact resource-owned object.
  return target as Target & DeadlineOwnedTaskPersistenceTarget;
}

export class TaskPersistenceTransactionError extends Data.TaggedError("TaskPersistenceTransactionError")<{
  readonly reason: "invalidTarget" | "storeFailure";
  readonly operation: string;
  readonly cause?: unknown;
}> {}

export function requireDeadlineOwnedTaskPersistenceTarget(target: unknown): Result.Result<
  DeadlineOwnedTaskPersistenceTarget, TaskPersistenceTransactionError
> {
  if (typeof target !== "object" || target === null || !targets.has(target))
    return Result.fail(new TaskPersistenceTransactionError({ reason: "invalidTarget", operation: "capture" }));
  // SAFETY: only resource-issued exact object identity reaches this branch.
  return Result.succeed(target as DeadlineOwnedTaskPersistenceTarget);
}

/** Reuses the located transaction's Cause, drain, rollback and connection owner.
 * PostgreSQL acquisition and pre-callback installation locks are bounded by the
 * issuing pool's connection timeout and startup SQL options. Local transaction
 * settings precede Task authority/run locks. PGlite proves only SQL semantics. */
export const runDeadlineOwnedTaskPersistenceTransaction = Effect.fn("TaskPersistence.runTransaction")(
  function* <A, E, IntegrationFailure>(target: DeadlineOwnedTaskPersistenceTarget, operation: string,
    work: (tx: AppRowTransaction) => Effect.Effect<A, E>,
    projectFailure: (error: TaskPersistenceTransactionError) => IntegrationFailure) {
    const authentic = yield* Effect.fromResult(requireDeadlineOwnedTaskPersistenceTarget(target))
      .pipe(Effect.mapError(projectFailure));
    const state = targets.get(authentic);
    if (state === undefined) return yield* Effect.die(new Error("Authenticated Task target lost its resource policy"));
    const integrationFailure = (failedOperation: string, cause: unknown) => projectFailure(new TaskPersistenceTransactionError({
      reason: "storeFailure", operation: failedOperation, cause }));
    return yield* runLocatedEffectTransaction(authentic, operation, tx => Effect.tryPromise({
      try: () => configureTaskRepairPostgresTransactionDeadlinesV1(tx, state.policy),
      catch: cause => integrationFailure(`${operation}.configureDeadlines`, cause),
    }).pipe(Effect.andThen(() => work(tx))), integrationFailure, "Deadline-owned Task transaction rolled back");
  },
);
