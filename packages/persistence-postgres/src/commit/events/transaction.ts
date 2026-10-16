import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result, type CommitSeq, type ScopeId, type ScopeUuidV1, type ScopeEpochUuidV1 } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { captureExactTrustedScopeAuthorityResolutionPorts, resolveLocatedTrustedScopeAuthorityByIdEffect,
  TrustedScopeAuthorityPortError, TrustedScopeAuthorityResolutionError,
  type ExactTrustedScopeAuthorityResolutionPorts } from "../../scope/scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1, type LocatedReadCommittedAttemptTargetV1 } from "../../database/locatedTransactionIdentity";
import { hasRelationalSessionDatabase, runRelationalSession, type RelationalSession } from "../../database/relationalTransaction/session";
import { lockScopeClockForShareInTransactionEffect } from "../../scope/scopeClock";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { fxSystemScopeClocks } from "../../database/schema/scope";
import { eventError, CommitEventError } from "./model";

export interface CommitEventScopePins { readonly scopeUuid: ScopeUuidV1; readonly epochUuid: ScopeEpochUuidV1 }
export interface CommitEventTransactionInput {
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
}
const statement = <A>(query: PromiseLike<A>) => runDrizzleStatementEffect(query, cause => eventError("statementFailure", cause));
/** One authority/clock/short-session owner for delivery and eligibility management. */
export const makeCommitEventTransactionRunner = Effect.fn("CommitEvents.makeTransactionRunner")(function* (input: CommitEventTransactionInput) {
  const { database, session, deploymentId, scopeId } = input;
  if (!hasRelationalSessionDatabase(session, database)) return yield* Effect.fail(eventError("invalidAuthority"));
  const authority = captureExactTrustedScopeAuthorityResolutionPorts(input.authority);
  const transact = Effect.fn("CommitEvents.transaction")(function* <A>(work: (tx: FlarexMetadataTransaction,
    pins: CommitEventScopePins, now: Date, lastCommitSeq: CommitSeq) => Effect.Effect<A, CommitEventError>) {
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority).pipe(
      Effect.mapError(cause => eventError(cause instanceof TrustedScopeAuthorityPortError ||
        (cause instanceof TrustedScopeAuthorityResolutionError && cause.failure.reason === "scopeClockTargetResolutionFailed")
        ? "resourceFailure" : "invalidAuthority", cause)));
    if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(eventError("invalidAuthority"));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(located.authority.scopeId)).pipe(Effect.mapError(cause => eventError("invalidAuthority", cause)));
    return yield* runRelationalSession(session, "command", tx => Effect.gen(function* () {
      yield* statement(tx.execute(sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`));
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, located.authority.scopeId).pipe(Effect.mapError(cause => eventError("invalidAuthority", cause)));
      if (clock.epoch !== located.authority.epoch || clock.storageGeneration !== located.authority.storageGeneration || clock.storageGenerationFence !== located.authority.storageGenerationFence) return yield* Effect.fail(eventError("invalidAuthority"));
      const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(clock.epoch)).pipe(Effect.mapError(cause => eventError("invalidAuthority", cause)));
      const times = yield* statement(tx.select({ now: sql<string>`clock_timestamp()::text` }).from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, scope.scopeUuid)));
      const now = new Date(times[0]?.now ?? "");
      if (finiteDateMilliseconds(now) === undefined) return yield* Effect.fail(eventError("storedCorruption"));
      return yield* work(tx, { scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid }, now, clock.lastCommitSeq);
    })).pipe(Effect.mapError(cause => cause instanceof CommitEventError ? cause : eventError("resourceFailure", cause)));
  });
  return transact;
});
