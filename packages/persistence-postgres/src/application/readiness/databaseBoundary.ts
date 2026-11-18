import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  Effect,
  Cause,
  Exit,
} from "effect";
import {
  sql,
  eq,
} from "drizzle-orm";
import {
  deployments,
  fxSystemScopeClocks,
} from "../../database/schema";
import {
  type ApplicationReadinessError,
  readinessFailure,
  readinessFailureValue,
} from "./errors";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { databaseTimestampFromUnknown } from "../../database/databaseTimestamp";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { isRetryableSqlTransactionCause } from "../../database/locatedReadCommittedEffect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import type { FlarexMetadataDatabase } from "../deployments";
import { runEffectTransaction } from "../../database/effectTransaction";
import {
  type LocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";

export function controlDatabaseTime(
  tx: AppRowTransaction,
  deploymentId: string,
): Effect.Effect<Date, ApplicationReadinessError> {
  return databaseTimeFromRows(query(
    tx.select({ now: sql<Date>`current_timestamp` }).from(deployments).where(
      eq(deployments.deploymentId, deploymentId),
    ).limit(1),
  ));
}

export function targetDatabaseTime(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
): Effect.Effect<Date, ApplicationReadinessError> {
  return databaseTimeFromRows(query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ));
}

function databaseTimeFromRows(
  rowsEffect: Effect.Effect<ReadonlyArray<{ readonly now: Date }>, ApplicationReadinessError>,
): Effect.Effect<Date, ApplicationReadinessError> {
  return rowsEffect.pipe(Effect.flatMap(rows => {
    const value = databaseTimestampFromUnknown(rows[0]?.now);
    return value === null
      ? readinessFailure("storedState")
      : Effect.succeed(value);
  }));
}

export function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationReadinessError> {
  return runDrizzleStatementEffect(
    statement,
    cause => readinessFailureValue(
      "resourceFailure",
      retryableDrizzleStatementCause(cause),
      cause,
    ),
  );
}

export function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationReadinessError> {
  return runDrizzleStatementEffect(
    statement,
    cause => readinessFailureValue(
      "resourceFailure",
      retryableDrizzleStatementCause(cause),
      cause,
    ),
  ).pipe(Effect.asVoid);
}

function retryableDrizzleStatementCause(cause: unknown): boolean {
  return isRetryableSqlTransactionCause(
    cause instanceof DrizzleQueryError ? cause.cause : cause,
  );
}

export function runTransaction<A>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<A, ApplicationReadinessError>,
): Effect.Effect<A, ApplicationReadinessError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application readiness transaction rolled back.",
    body,
    cause => readinessFailureValue(
      "resourceFailure",
      retryableCause(cause),
      cause,
    ),
  );
}

export const runLocatedTransaction = Effect.fn(
  "ApplicationReadiness.runLocatedTransaction",
)(function* <A, E>(
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | ApplicationReadinessError> {
    const rollbackSignal = Object.freeze({
      kind: "ApplicationReadinessRollback",
    });
    let callbackCause: Cause.Cause<E> | undefined;
    const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
      const result = await Effect.runPromiseExit(body(tx));
      if (Exit.isSuccess(result)) return result.value;
      callbackCause = result.cause;
      throw rollbackSignal;
    });
    const settled = yield* Effect.uninterruptible(Effect.exit(
      Effect.tryPromise({
        try: () => promise,
        catch: cause => cause,
      }),
    ));
    if (Exit.isSuccess(settled)) return settled.value;
    const error = Cause.findErrorOption(settled.cause);
    if (error._tag === "None") {
      return yield* Effect.failCause(Cause.map(
        settled.cause,
        cause => readinessFailureValue(
          "resourceFailure",
          false,
          cause,
        ),
      ));
    }
    const cause = error.value;
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === rollbackSignal &&
      callbackCause !== undefined) {
      return yield* Effect.failCause(callbackCause);
    }
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      cause.issue.callbackCause === rollbackSignal &&
      callbackCause !== undefined) {
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(readinessFailureValue(
          "resourceFailure",
          false,
          cause,
        )),
      ));
    }
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "decisionUncertain") {
      return yield* readinessFailure("decisionUncertain", false, cause);
    }
    return yield* readinessFailure(
      "resourceFailure",
      retryableCause(cause),
      cause,
    );
  },
);

export function retryableCause(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}
