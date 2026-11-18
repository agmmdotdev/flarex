import { databaseTimestampFromUnknown } from "../../database/databaseTimestamp";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { isRetryableSqlTransactionCause } from "../../database/locatedReadCommittedEffect";
import { fxSystemScopeClocks } from "../../database/schema";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";
import {
  type LocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { ApplicationActivationContext } from "./constructionContracts";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { eq, sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { Cause, Effect, Exit } from "effect";

export function databaseTime(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<Date, ApplicationActivationError> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
    operation,
    revisionId,
  ).pipe(Effect.flatMap(rows => {
    // SAFETY: rows is the driver's generic row array; the first row is a
    // string-keyed record when the query returned one.
    const first = rows[0] as Readonly<Record<string, unknown>> | undefined;
    const value = first === undefined ? null : databaseTimestampFromUnknown(first.now);
    return value === null
      ? activationFailure(operation, "storedState", revisionId)
      : Effect.succeed(value);
  }));
}

export function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: host - SHA-256 of an owned ArrayBuffer copy is treated as a non-rejecting WebCrypto digest
  return Effect.promise(() =>
    globalThis.crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes))
      .then(value => new Uint8Array(value))
  );
}

export function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<ReadonlyArray<Row>, ApplicationActivationError> {
  return runDrizzleStatementEffect(
    statement,
    cause => activationError(
      operation,
      "resourceFailure",
      revisionId,
      retryableDrizzleStatementCause(cause),
      cause,
    ),
  );
}

function retryableDrizzleStatementCause(cause: unknown): boolean {
  return isRetryableSqlTransactionCause(
    cause instanceof DrizzleQueryError ? cause.cause : cause,
  );
}

export const runLocatedTransaction = Effect.fn("ApplicationActivation.runTransaction")(
function* <A, E>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: ApplicationActivationError["operation"],
  revisionId: string | undefined,
  body: (tx: AppRowTransaction) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | ApplicationActivationError> {
  const rollbackSignal = Object.freeze({ kind: "ApplicationActivationRollback" });
  let callbackCause: Cause.Cause<E> | undefined;
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const result = await Effect.runPromiseExit(body(tx));
    if (Exit.isSuccess(result)) return result.value;
    callbackCause = result.cause;
    throw rollbackSignal;
  });
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => promise,
    catch: cause => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const error = Cause.findErrorOption(settled.cause);
  if (error._tag === "None") {
    return yield* Effect.failCause(Cause.map(
      settled.cause,
      cause => activationError(
        operation,
        "resourceFailure",
        revisionId,
        false,
        cause,
      ),
    ));
  }
  const cause = error.value;
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === rollbackSignal && callbackCause !== undefined) {
    return yield* Effect.failCause(callbackCause);
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" && callbackCause !== undefined) {
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(activationError(
        operation,
        "resourceFailure",
        revisionId,
        false,
        cause,
      )),
    ));
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain") {
    return yield* activationFailure(
      operation,
      "decisionUncertain",
      revisionId,
      false,
      cause,
    );
  }
  return yield* activationFailure(
    operation,
    "resourceFailure",
    revisionId,
    retryableCause(cause),
    cause,
  );
});

export function runFault(
  faultAfter: ApplicationActivationContext<unknown, unknown>["faultAfter"],
  point: "activationInserted" | "indexMaintenanceWritten" | "uniqueMaintenanceWritten" | "headWritten",
  revisionId: string,
): Effect.Effect<void, ApplicationActivationError> {
  return faultAfter === undefined
    ? Effect.void
    : Effect.tryPromise({
        try: async () => { await faultAfter(point); },
        catch: cause => activationError(
          "activate",
          "resourceFailure",
          revisionId,
          false,
          cause,
        ),
      });
}

export function retryableCause(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}
