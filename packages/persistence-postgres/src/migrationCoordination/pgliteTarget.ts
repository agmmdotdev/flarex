import { Cause, Effect, Exit } from "effect";
import { sql } from "drizzle-orm";

import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { PGliteFlarexPersistence } from "../pglite";
import type { ScopePhysicalLocator } from "../scopeMetadataTypes";
import {
  FrameworkMigrationDecisionUncertainIssue,
  FrameworkMigrationSessionResourceIssue,
  makeFrameworkMigrationSessionDriver,
  makeFrameworkMigrationTargetEffect,
  type FrameworkMigrationDriverTransactionRequest,
  type FrameworkMigrationSessionFailure,
  type FrameworkMigrationTarget,
  type FrameworkMigrationTargetCompositionError,
  type RunFrameworkMigrationDriverTransaction,
} from "./targetSession";
import type { FrameworkMigrationValueError } from "./errors";

export interface MakePGliteFrameworkMigrationTargetInput {
  readonly persistence: Pick<PGliteFlarexPersistence, "drizzle">;
  readonly deploymentId: string;
  readonly canonicalPhysicalDatabaseIdentity: string;
  readonly physicalLocator: ScopePhysicalLocator;
}

/**
 * Private functional/test-only adapter. The caller supplies the canonical
 * physical-database identity; this issuer only binds it process-locally to the
 * exact Drizzle instance. Each invocation uses a fresh transaction callback
 * and opaque logical session identity. PGlite cannot resolve physical aliases,
 * prove connection exclusion, or establish genuine PostgreSQL recovery.
 */
export const makePGliteFrameworkMigrationTargetEffect = Effect.fn(
  "FrameworkMigrationPGliteTarget.make",
)(function* (
  input: MakePGliteFrameworkMigrationTargetInput,
): Effect.fn.Return<
  FrameworkMigrationTarget,
  FrameworkMigrationValueError | FrameworkMigrationTargetCompositionError
> {
  const database: FlarexMetadataDatabase = input.persistence.drizzle;
  const driver = makeFrameworkMigrationSessionDriver(
    database,
    makePGliteRunTransactionEffect(database),
  );
  return yield* makeFrameworkMigrationTargetEffect({
    database,
    driver,
    deploymentId: input.deploymentId,
    canonicalPhysicalDatabaseIdentity:
      input.canonicalPhysicalDatabaseIdentity,
    physicalLocator: input.physicalLocator,
  });
});

function makePGliteRunTransactionEffect(
  database: FlarexMetadataDatabase,
): RunFrameworkMigrationDriverTransaction {
  const runTransactionEffect: RunFrameworkMigrationDriverTransaction =
    Effect.fn("FrameworkMigrationPGliteTarget.runTransaction")(<Value, Failure>(
    request: FrameworkMigrationDriverTransactionRequest,
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ): Effect.Effect<
    Value,
    Failure | FrameworkMigrationSessionFailure,
    never
  > => Effect.uninterruptible(Effect.gen(function* () {
    // PGlite cannot quarantine a physical backend. We therefore wait for the
    // transaction to settle before releasing the caller; a pending interrupt
    // may be delivered afterward and is not evidence of a non-commit.
    let callbackCause:
      | Cause.Cause<Failure | FrameworkMigrationSessionResourceIssue>
      | undefined;
    let callbackCompleted = false;
    const rollbackSignal = new Error(
      "Framework migration PGlite callback requested rollback",
    );
    const settled = yield* Effect.tryPromise({
      try: () => database.transaction(async transaction => {
        const callback = await Effect.runPromise(Effect.exit(
          configureTransactionEffect(transaction, request).pipe(
            Effect.flatMap(() => work(transaction)),
          ),
        ));
        if (Exit.isFailure(callback)) {
          callbackCause = callback.cause;
          throw rollbackSignal;
        }
        callbackCompleted = true;
        return callback.value;
      }, { isolationLevel: "read committed" }),
      catch: cause => cause,
    }).pipe(Effect.exit);
    if (Exit.isSuccess(settled)) return settled.value;

    const error = Cause.findErrorOption(settled.cause);
    if (
      error._tag === "Some" && error.value === rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (callbackCause !== undefined) {
      const cleanupCause = error._tag === "Some"
        ? error.value
        : settled.cause;
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.fail(new FrameworkMigrationSessionResourceIssue({
          phase: "rollbackOrCleanup",
          cause: cleanupCause,
        })),
      ));
    }
    const cause = error._tag === "Some"
      ? error.value
      : settled.cause;
    if (callbackCompleted) {
      return yield* Effect.fail(new FrameworkMigrationDecisionUncertainIssue({
        sessionIdentity: request.sessionIdentity,
        cause,
      }));
    }
    return yield* Effect.fail(new FrameworkMigrationSessionResourceIssue({
      phase: "beginOrConfigure",
      cause,
    }));
  })));
  return runTransactionEffect;
}

const configureTransactionEffect = Effect.fn(
  "FrameworkMigrationPGliteTarget.configureTransaction",
)(function* (
  transaction: FlarexMetadataTransaction,
  request: FrameworkMigrationDriverTransactionRequest,
): Effect.fn.Return<void, FrameworkMigrationSessionResourceIssue> {
  const lockTimeout = `${request.lockTimeoutMilliseconds}ms`;
  const statementTimeout = `${request.statementTimeoutMilliseconds}ms`;
  yield* runConfigurationStatementEffect(() =>
    transaction.execute(sql.raw(
      `set local lock_timeout = '${lockTimeout}'`,
    )),
  );
  yield* runConfigurationStatementEffect(() =>
    transaction.execute(sql.raw(
      `set local statement_timeout = '${statementTimeout}'`,
    )),
  );
});

const runConfigurationStatementEffect = Effect.fn(
  "FrameworkMigrationPGliteTarget.runConfigurationStatement",
)(<Value>(
  run: () => PromiseLike<Value>,
): Effect.Effect<void, FrameworkMigrationSessionResourceIssue, never> =>
  Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: cause => new FrameworkMigrationSessionResourceIssue({
      phase: "beginOrConfigure",
      cause,
    }),
  }).pipe(Effect.asVoid));
