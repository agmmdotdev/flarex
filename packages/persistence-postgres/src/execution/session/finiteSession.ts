import type { ApplicationGraphSessionSelector } from "../../commit/authority/postgresLoader";
import { runPointCommitPromiseEffect } from "../../commit/point/promiseBoundary";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import {
  fxSystemTransactionSessions,
} from "../../database/schema";
import { requireAdmittedTargetInstallationSchema } from "../../installation/installationLifecycle";
import {
  readFiniteExecutionAuthorityObservation,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { mapExecutionClaimRenewalIssue } from "../claims/transactionExecutionClaimErrors";
import { projectExecutionClaimRenewalV1Result } from "../claims/renewalProjection";
import {
  deriveTransactionExecutionClaimV1,
} from "../claims/transactionExecutionClaimPersistence";
import {
  FiniteAttemptAnchorError,
  captureFiniteAttemptAnchor,
  lockFiniteAttemptAnchorInTransaction,
  projectCapturedFiniteAttemptAnchor,
  readFiniteAttemptAnchorRow,
  requireFiniteAttemptIsLive,
  type FiniteAttemptAnchorContext,
  type FiniteAttemptFrontierRow,
} from "../finiteAttemptAnchor";
import {
  acceptFiniteMetadataEntryComparisonVerdict,
  encodeFiniteMetadataComparison,
  prepareFiniteMetadataEntryComparison,
  submitFiniteMetadataEntryComparisonEffect,
  type PreparedFiniteMetadataProjection,
} from "../finiteMetadataDependencies";
import {
  readCapturedFiniteMetadataReservation,
  type CapturedFiniteMetadataReservation,
} from "../finiteMetadataReservation";
import { SessionJournalPersistenceV1Error } from "../journal/errors";
import {
  acceptProtectedMetadataFinalGuardBatch,
  flushProtectedMetadataFinalGuards,
  prepareProtectedMetadataFinalGuardBatch,
} from "../preparation/preparedMetadataEpoch";

import {
  INITIAL_ATTEMPT_FENCE,
  deriveInitialLeaseExpiry,
  lockPointMutationSessionClock,
  readDatabaseNow,
  requireStableAttemptLoadAuthority,
  type LockedPointMutationSessionClockV1,
} from "./attemptAuthority";

import type {
  LocatedPointMutationSessionActivationInputV1,
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "./constructionContracts";
import type {
  PointMutationSessionAttemptSelectorV1,
  SnapshotLeaseRow,
  TransactionSessionRow,
} from "./contracts";
import {
  activationError,
  corruptionError,
  type PointMutationSessionAuthorityCorruptionV1Error,
} from "./errors";
import {
  mapActivationTransactionError,
  mapAttemptLoadTransactionError,
} from "./errorProjections";
import {
  activationResult,
  cloneValidDate,
  decodeCheckedSchemaVersionIdResult,
  nullableBytesEqual,
  nullableJsonEqual,
} from "./inputCapture";
import type {
  ExactRunningAttemptKernelInputV1,
  FiniteEntryAttemptKernelContext,
} from "./kernelContracts";
import {
  bytesEqual,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Effect, Result, Schema } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  FlarexDbV1StorageGenerationSchema,
  SnapshotTokenSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
  replacementScopeIdV1FromUuid,
  type ReplacementScopeIdV1,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1 } from "flarex-protocol/transaction-session";

/** The finite profile has one durable session anchor, never a journal facet. */
export const prepareProvisionalFiniteSessionEffect = Effect.fn("ApplicationMutationSessionActivation.prepareFiniteSession")(
  function* (tx: AppRowTransaction, input: LocatedPointMutationSessionActivationInputV1,
    clock: LockedPointMutationSessionClockV1, afterWrite: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"],
    installed: boolean, databaseNow: Date) {
    const evidence = input.prepared.evidence;
    const hardExpiresAt = cloneValidDate(evidence.authorizationGrantExpiresAt);
    const leaseExpiresAt = yield* Effect.fromResult(deriveInitialLeaseExpiry(databaseNow, hardExpiresAt, input.leaseDurationMilliseconds));
    const snapshotToken = SnapshotTokenSchema.make({ scopeId: input.prepared.scopeId, epoch: clock.record.epoch,
      commitSeq: clock.record.lastCommitSeq });
    const claim = yield* Effect.fromResult(deriveTransactionExecutionClaimV1({ scopeUuid: clock.scopeUuid,
      sessionId: input.candidateSessionId, attemptFence: INITIAL_ATTEMPT_FENCE, claimFence: 1n, claimOwner: input.executionClaimOwner,
      databaseNow, durationMilliseconds: input.executionClaimDurationMilliseconds, leaseExpiresAt,
      authorizationGrantExpiresAt: evidence.authorizationGrantExpiresAt, hardExpiresAt }).pipe(Result.mapError(reason =>
      reason === "authorityExpired" ? activationError({ reason: "authorizationGrantExpired" }) :
        corruptionError(input.prepared.scopeId, "sessionRecordInvalid"))));
    const session = { scopeUuid: clock.scopeUuid, sessionId: input.candidateSessionId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), storageGenerationFence: clock.record.storageGenerationFence,
      ...evidence, executionProfile: "finiteRoot" as const,
      finiteAttemptBytes: null, finiteAttemptSha256: null, finiteMetadataWatermark: null,
      finiteSnapshotEpochUuid: projectScopeEpochUuidV1(snapshotToken.epoch).epochUuid,
      finiteSnapshotCommitSeq: snapshotToken.commitSeq,
      lifecycle: "running" as const, attemptFence: INITIAL_ATTEMPT_FENCE,
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1, hardExpiresAt, createdAt: databaseNow, updatedAt: databaseNow,
      finiteLeaseExpiresAt: leaseExpiresAt, finiteClaimOwner: claim.claimOwner, finiteClaimFence: claim.claimFence,
      finiteClaimedAt: claim.claimedAt, finiteClaimExpiresAt: claim.claimExpiresAt } satisfies TransactionSessionRow;
    // This private owner-authored state is inert until complete insertion and
    // acknowledged COMMIT. In particular, no empty durable anchor is created.
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ session, snapshotToken, provisional: true,
      schemaName: input.preliminaryAuthority.physicalLocator.schemaName, afterWrite, installed }));
    const finiteAttempt: FiniteAttemptAnchorContext = Object.freeze({ session, snapshotToken, reservation: null,
      leaseExpiresAt, executionClaim: Object.freeze({ claimOwner: claim.claimOwner, claimFence: claim.claimFence,
        claimedAt: claim.claimedAt.toISOString(), claimExpiresAt: claim.claimExpiresAt.toISOString() }) });
    const context = yield* finiteEntryAttemptContextFromAnchor(finiteAttempt, input.prepared.deploymentId, clock.record, databaseNow);
    return Object.freeze({ activation: activationResult("created", context.anchor, context.executionClaim), context });
  });

const finiteAttemptContextScalars = Effect.fn("ApplicationMutationSessionActivation.finiteEntryContext")(
  function* <Session extends FiniteAttemptFrontierRow>(finiteAttempt: FiniteAttemptAnchorContext<Session>, deploymentId: PointMutationSessionAttemptSelectorV1["deploymentId"],
    scopeId: PointMutationSessionAttemptSelectorV1["scopeId"], databaseNow: Date) {
    const session = finiteAttempt.session;
    if (session.storageGeneration !== "flarexdb_v1") {
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    }
    const schemaVersionId = yield* Effect.fromResult(decodeCheckedSchemaVersionIdResult(session.schemaVersionId)
      .pipe(Result.mapError(cause => corruptionError(scopeId, "sessionRecordInvalid", cause))));
    if (!isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const hardExpiresAt = yield* Effect.fromResult(Result.fromNullishOr(
      copyFiniteDate(session.hardExpiresAt), () => corruptionError(scopeId, "sessionRecordInvalid")));
    const leaseExpiresAt = yield* Effect.fromResult(Result.fromNullishOr(
      copyFiniteDate(finiteAttempt.leaseExpiresAt), () => corruptionError(scopeId, "sessionRecordInvalid")));
    const createdAt = yield* Effect.fromResult(Result.fromNullishOr(
      copyFiniteDate(session.createdAt), () => corruptionError(scopeId, "sessionRecordInvalid")));
    const updatedAt = yield* Effect.fromResult(Result.fromNullishOr(
      copyFiniteDate(session.updatedAt), () => corruptionError(scopeId, "sessionRecordInvalid")));
    return Object.freeze({ scopeUuid: session.scopeUuid, session, finiteAttempt,
      anchor: Object.freeze({ deploymentId, scopeId: scopeId, sessionId: session.sessionId, requestKey: session.requestKey,
        executionProfile: "finiteRoot" as const, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: session.storageGenerationFence, attemptFence: session.attemptFence,
        snapshotToken: finiteAttempt.snapshotToken, hardExpiresAt: hardExpiresAt.toISOString(),
        leaseExpiresAt: leaseExpiresAt.toISOString(), createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() }),
      executionPin: Object.freeze({ schemaVersionId, functionPath: session.functionPath, functionKind: session.functionKind, executionModule: session.executionModule }),
      executionAuthorityGeneration: session.executionAuthorityGeneration, principalDigest: encodeBytesToLowercaseHex(session.identityAccessPolicySha256),
      authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(), hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(),
      databaseNow, executionClaim: finiteAttempt.executionClaim });
  });

export const finiteEntryAttemptContextFromAnchor = Effect.fn("ApplicationMutationSessionActivation.finiteEntryContext")(
  function* (finiteAttempt: FiniteAttemptAnchorContext, deploymentId: PointMutationSessionAttemptSelectorV1["deploymentId"],
    scopeClock: ScopeClockRecord, databaseNow: Date) {
    return Object.freeze({ ...yield* finiteAttemptContextScalars(finiteAttempt, deploymentId, decodeReplacementScopeIdV1(scopeClock.scopeId), databaseNow), scopeClock });
  });

const finiteEntryAnchorExpectations = new WeakMap<AppRowTransaction, Readonly<{
  session: TransactionSessionRow;
  snapshotToken: SnapshotToken;
  provisional?: true;
  schemaName?: string;
  afterWrite?: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"];
  installed?: boolean;
}>>();

/** Only the private entry issuer can defer the projection check to complete insertion. */
export function hasProvisionalFiniteEntry(tx: AppRowTransaction): boolean {
  return finiteEntryAnchorExpectations.get(tx)?.provisional === true;
}

const FiniteEntryCompletionVerdict = Schema.Struct({
  reason: Schema.Literals(["accepted", "protectedMetadataChanged", "expired", "sessionIdCollision", "storedCorruption"]),
  databaseNow: Schema.NullOr(Schema.Date),
  leaseExpiresAt: Schema.NullOr(Schema.Date), claimExpiresAt: Schema.NullOr(Schema.Date),
  metadataVerdict: Schema.Unknown, guardValid: Schema.NullOr(Schema.Boolean),
});

const decodeFiniteEntryCompletionVerdict = Schema.decodeUnknownResult(FiniteEntryCompletionVerdict);

/** One complete insertion followed by an actual stored-row read inside the
 * installed owner. INSERT RETURNING alone cannot see AFTER-trigger changes. */
const completeProvisionalFiniteEntry = Effect.fn("ApplicationMutationSessionActivation.completeFiniteEntry")(
  function* (tx: AppRowTransaction, context: FiniteEntryAttemptKernelContext,
    anchor: import("../finiteAttemptAnchor").CapturedFiniteAttemptAnchor,
    projection: PreparedFiniteMetadataProjection, schemaName: string, installed: boolean,
    afterWrite: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]) {
    const scopeId = context.anchor.scopeId;
    const expected = finiteEntryAnchorExpectations.get(tx);
    if (expected?.provisional !== true || !sessionAnchorRowsEqual(expected.session, context.session))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const metadata = yield* Effect.fromResult(prepareFiniteMetadataEntryComparison(projection))
      .pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    const guard = installed ? yield* prepareProtectedMetadataFinalGuardBatch(tx).pipe(Effect.mapError(cause =>
      new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))) : undefined;
    if (guard === undefined) {
      yield* submitFiniteMetadataEntryComparisonEffect(tx, scopeId, context.scopeClock.lastMetadataSequence, metadata)
        .pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
      yield* flushProtectedMetadataFinalGuards(tx).pipe(Effect.mapError(cause =>
        new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    }
    const columns = Object.entries(getTableColumns(fxSystemTransactionSessions));
    const row = sql`row(${sql.join(columns.map(([key, column]) =>
      sql`${sql.param(Reflect.get(expected.session, key), column)}::${sql.raw(column.getSQLType())}`), sql`, `)})
      ::${sql.identifier(schemaName)}.fx_finite_entry_expected`;
    // Materialization performs the genuine comparison once. CASE never acquires
    // an epoch lock for a known metadata refusal, including NOWAIT contention.
    const source = guard === undefined ? sql`(values (true, null::jsonb))` : sql`(
      with metadata_check as materialized (select ${sql.identifier(schemaName)}.fx_compare_finite_metadata(
        ${scopeId}::text, ${context.scopeClock.lastMetadataSequence.toString()}::bigint,
        ${encodeFiniteMetadataComparison(metadata)}::jsonb) as verdict),
      epoch_check as materialized (select case when verdict->>'reason' = 'accepted'
        then (select valid from ${guard.source} as actual_epoch(valid)) else null::boolean end as valid,
        verdict from metadata_check)
      select valid, verdict from epoch_check)`;
    const rows = yield* runDrizzleStatementEffect(tx.select({
      guardValid: sql<boolean | null>`epoch_guard.valid`, reason: sql<string>`completion.reason`,
      databaseNow: sql`completion.database_now`.mapWith(fxSystemTransactionSessions.createdAt),
      leaseExpiresAt: sql`completion.lease_expires_at`.mapWith(fxSystemTransactionSessions.finiteLeaseExpiresAt),
      claimExpiresAt: sql`completion.claim_expires_at`.mapWith(fxSystemTransactionSessions.finiteClaimExpiresAt),
      metadataVerdict: sql<unknown>`epoch_guard.verdict`,
    }).from(sql`${source} as epoch_guard(valid, verdict) cross join lateral
      ${sql.identifier(schemaName)}.fx_complete_finite_entry(${row}, epoch_guard.valid) completion`), mapActivationTransactionError);
    if (rows.length !== 1) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const verdict = yield* Effect.fromResult(decodeFiniteEntryCompletionVerdict(rows[0])).pipe(
      Effect.mapError(cause => corruptionError(scopeId, "sessionRecordInvalid", cause)));
    if (guard !== undefined) {
      yield* Effect.fromResult(acceptFiniteMetadataEntryComparisonVerdict(verdict.metadataVerdict, metadata, context.scopeClock.lastMetadataSequence)
        .pipe(Result.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))));
      // Only accepted metadata may correlate with an evaluated Boolean guard.
      // NULL denotes the unexecuted metadata-refusal branch.
      if (verdict.guardValid === null) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
      yield* acceptProtectedMetadataFinalGuardBatch(tx, [{ valid: verdict.guardValid }])
        .pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    }
    if (verdict.reason === "expired") return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "expired" }));
    if (verdict.reason === "sessionIdCollision") return yield* Effect.fail(activationError({ reason: "sessionIdCollision" }));
    if (verdict.reason !== "accepted") return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const { databaseNow, leaseExpiresAt, claimExpiresAt } = verdict;
    if (databaseNow === null || leaseExpiresAt === null || claimExpiresAt === null ||
      ![databaseNow, leaseExpiresAt, claimExpiresAt].every(date => Number.isSafeInteger(date.getTime())))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const current = context.finiteAttempt;
    const projected = yield* Effect.fromResult(projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds: databaseNow.getTime(), currentLeaseExpiresAtMilliseconds: current.leaseExpiresAt.getTime(),
      currentClaimExpiresAtMilliseconds: Date.parse(current.executionClaim.claimExpiresAt),
      authorizationGrantExpiresAtMilliseconds: context.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: context.hardExpiresAtMilliseconds,
      claimDurationMilliseconds: Date.parse(current.executionClaim.claimExpiresAt) - Date.parse(current.executionClaim.claimedAt),
      leaseRenewalDurationMilliseconds: current.leaseExpiresAt.getTime() - Date.parse(current.executionClaim.claimedAt),
      maximumLiveSnapshotRetentionMilliseconds: current.leaseExpiresAt.getTime() - Date.parse(current.executionClaim.claimedAt),
      phase: "open",
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)));
    if (leaseExpiresAt.getTime() !== projected.targetLeaseExpiresAtMilliseconds ||
      claimExpiresAt.getTime() !== projected.targetClaimExpiresAtMilliseconds)
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const session = { ...expected.session, finiteLeaseExpiresAt: leaseExpiresAt, finiteClaimExpiresAt: claimExpiresAt };
    const accepted = yield* readFiniteAttemptAnchorRow(session, anchor);
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ session, snapshotToken: expected.snapshotToken }));
    if (afterWrite !== undefined) {
      yield* runPointCommitPromiseEffect(async () => afterWrite("sessionInserted"), mapActivationTransactionError);
      // The test hook may perform a real trusted write after the installed
      // proof. Such a mutation requires a new complete actual-row correlation.
      yield* requireCorrelatedFiniteEntryEffect(tx, scopeId);
    }
    return Object.freeze({ ...context, session, finiteAttempt: accepted, databaseNow,
      executionClaim: accepted.executionClaim, anchor: Object.freeze({ ...context.anchor,
        leaseExpiresAt: leaseExpiresAt.toISOString() }) });
  });

/** Bind each owner-authored column once. The database compares the complete
 * previous and resulting rows, including changes made by BEFORE triggers. */
function correlatedFiniteSessionUpdateStatement(tx: AppRowTransaction,
  previous: Readonly<TransactionSessionRow>, changes: Readonly<Partial<TransactionSessionRow>>) {
  const projectionName = "finite_entry_row";
  const fields: Record<string, SQL.Aliased> = {};
  const updates: Record<string, SQL> = {};
  const previousChecks: SQL[] = [], resultingChecks: SQL[] = [];
  const reference = (name: string) => sql`${sql.identifier(projectionName)}.${sql.identifier(name)}`;
  for (const [key, column] of Object.entries(getTableColumns(fxSystemTransactionSessions))) {
    const originalName = `original_${key}`;
    fields[originalName] = sql`${sql.param(Reflect.get(previous, key), column)}::${sql.raw(column.getSQLType())}`.as(originalName);
    previousChecks.push(sql`${column} is not distinct from ${reference(originalName)}`);
    if (Object.hasOwn(changes, key)) {
      const resultingName = `resulting_${key}`;
      fields[resultingName] = sql`${sql.param(Reflect.get(changes, key), column)}::${sql.raw(column.getSQLType())}`.as(resultingName);
      updates[key] = reference(resultingName);
      resultingChecks.push(sql`${column} is not distinct from ${reference(resultingName)}`);
    } else {
      resultingChecks.push(sql`${column} is not distinct from ${reference(originalName)}`);
    }
  }
  const projection = tx.$with(projectionName).as(tx.select(fields)
    .from(sql`(values (true)) as finite_entry_source(present)`));
  return tx.with(projection).update(fxSystemTransactionSessions).set(updates).from(projection)
    .where(sql.join(previousChecks, sql` and `))
    .returning({ matches: sql<boolean>`(${sql.join(resultingChecks, sql` and `)})` });
}

/** The same transaction that issued entry owns its final post-wait admission.
 * No historical session row or confirmed-entry handle can request this write. */
export const acceptFiniteEntryForContinuationInTransactionEffect = Effect.fn("ApplicationMutationSessionActivation.acceptFiniteContinuation")(
  function* (tx: AppRowTransaction, context: FiniteEntryAttemptKernelContext,
    anchor: import("../finiteAttemptAnchor").CapturedFiniteAttemptAnchor,
    projection?: PreparedFiniteMetadataProjection) {
    const expected = finiteEntryAnchorExpectations.get(tx);
    const scopeId = context.anchor.scopeId;
    if (expected === undefined || !sessionAnchorRowsEqual(expected.session, context.session))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    if (expected.provisional === true) {
      if (projection === undefined || expected.schemaName === undefined)
        return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
      return yield* completeProvisionalFiniteEntry(tx, context, anchor, projection, expected.schemaName, expected.installed === true, expected.afterWrite);
    }
    const session = expected.session;
    const current = yield* readFiniteAttemptAnchorRow(session, anchor);
    const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, scopeId), catch: mapActivationTransactionError });
    yield* Effect.fromResult(requireFiniteAttemptIsLive(current, databaseNow));
    const claimedAt = Date.parse(current.executionClaim.claimedAt);
    const claimDurationMilliseconds = Date.parse(current.executionClaim.claimExpiresAt) - claimedAt;
    const leaseDurationMilliseconds = current.leaseExpiresAt.getTime() - claimedAt;
    const projected = yield* Effect.fromResult(projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds: databaseNow.getTime(), currentLeaseExpiresAtMilliseconds: current.leaseExpiresAt.getTime(),
      currentClaimExpiresAtMilliseconds: Date.parse(current.executionClaim.claimExpiresAt),
      authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(),
      hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(), claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds: leaseDurationMilliseconds, maximumLiveSnapshotRetentionMilliseconds: leaseDurationMilliseconds,
      phase: "open",
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)));
    const next = { ...session, finiteLeaseExpiresAt: new Date(projected.targetLeaseExpiresAtMilliseconds),
      finiteClaimExpiresAt: new Date(projected.targetClaimExpiresAtMilliseconds) };
    const rows = yield* runDrizzleStatementEffect(correlatedFiniteSessionUpdateStatement(tx, session, {
      finiteLeaseExpiresAt: next.finiteLeaseExpiresAt, finiteClaimExpiresAt: next.finiteClaimExpiresAt,
    }), mapActivationTransactionError);
    if (rows.length !== 1 || rows[0]?.matches !== true)
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const accepted = yield* readFiniteAttemptAnchorRow(next, anchor);
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ ...expected, session: next }));
    return yield* finiteEntryAttemptContextFromAnchor(accepted, context.anchor.deploymentId, context.scopeClock, databaseNow);
  });

/** Complete private entry construction without creating a durable placeholder.
 * Replacement retains the existing exact-row update of its durable anchor. */
export const captureFiniteAttemptReservationInTransaction = Effect.fn("ApplicationMutationSessionActivation.captureFiniteMetadata")(
  function* (tx: AppRowTransaction, selector: PointMutationSessionAttemptSelectorV1,
    reservation: CapturedFiniteMetadataReservation) {
    const expected = finiteEntryAnchorExpectations.get(tx);
    if (expected === undefined)
      return yield* Effect.fail(corruptionError(selector.scopeId, "sessionRecordInvalid"));
    const { session, snapshotToken } = expected;
    if (session.lifecycle !== "running" || session.finiteMetadataWatermark !== null)
      return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "lifecycleChanged" }));
    const issued = readCapturedFiniteMetadataReservation(reservation);
    if (issued === null || issued.deploymentId !== selector.deploymentId || issued.sessionId !== selector.sessionId ||
      issued.attemptFence !== selector.attemptFence || issued.scopeId !== selector.scopeId ||
      session.sessionId !== selector.sessionId || session.attemptFence !== selector.attemptFence ||
      snapshotToken.scopeId !== selector.scopeId || issued.storageGenerationFence !== session.storageGenerationFence ||
      issued.schemaVersionId !== session.schemaVersionId)
      return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "invalidInput" }));
    const anchor = yield* captureFiniteAttemptAnchor({ snapshotToken, reservation });
    const values = yield* Effect.fromResult(projectCapturedFiniteAttemptAnchor(anchor));
    if (expected.provisional !== true) {
      const rows = yield* runDrizzleStatementEffect(correlatedFiniteSessionUpdateStatement(tx, session, values),
        cause => new FiniteAttemptAnchorError({ reason: "resourceFailure", cause }));
      if (rows.length !== 1) return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "storedCorruption" }));
      if (rows[0]?.matches !== true)
        return yield* Effect.fail(corruptionError(selector.scopeId, "sessionRecordInvalid"));
    }
    const complete = { ...session, ...values };
    const context = yield* readFiniteAttemptAnchorRow(complete, anchor);
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ ...expected, session: complete }));
    return Object.freeze({ anchor, context });
  },
);

function sessionAnchorRowsEqual(left: Readonly<TransactionSessionRow>, right: Readonly<TransactionSessionRow>): boolean {
  return Object.keys(getTableColumns(fxSystemTransactionSessions)).every(key => {
    const a = Reflect.get(left, key), b = Reflect.get(right, key);
    return a === b || a instanceof Uint8Array && b instanceof Uint8Array && bytesEqual(a, b) ||
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime() ||
      a !== null && b !== null && typeof a === "object" && typeof b === "object" && nullableJsonEqual(a, b);
  });
}

export const requireCorrelatedFiniteEntryEffect = Effect.fn("ApplicationMutationSessionActivation.correlateFiniteEntry")(
  function* (tx: AppRowTransaction, scopeId: ReplacementScopeIdV1) {
    const capture = finiteEntryAnchorExpectations.get(tx);
    if (capture === undefined) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const expected = capture.session;
    // Preparation authenticates an inert issuer, not an absent stored row.
    // The completion function proves every stored column after the sole INSERT.
    if (capture.provisional === true) return;
    const rows = yield* Effect.tryPromise({ try: () => tx.select({ matches: sql<boolean>`(${freshSessionRowCorrelationSql(fxSystemTransactionSessions, expected)})` })
      .from(fxSystemTransactionSessions).where(and(eq(fxSystemTransactionSessions.scopeUuid, expected.scopeUuid),
        eq(fxSystemTransactionSessions.sessionId, expected.sessionId))).limit(2), catch: mapActivationTransactionError });
    if (rows.length !== 1 || rows[0]?.matches !== true) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
  });

const finiteEntryLeaseExpectations = new WeakMap<AppRowTransaction, SnapshotLeaseRow>();

/** Root-only recognition of its checked reservation write; every other lease column stays exact. */
export function recognizeFiniteMetadataReservationUpdate(tx: AppRowTransaction,
  previous: Readonly<SnapshotLeaseRow>, updated: SnapshotLeaseRow,
): Result.Result<void, PointMutationSessionAuthorityCorruptionV1Error> {
  const expected = finiteEntryLeaseExpectations.get(tx);
  if (expected === undefined || expected.scopeUuid !== previous.scopeUuid || expected.sessionId !== previous.sessionId
    || expected.attemptFence !== previous.attemptFence || expected.snapshotEpochUuid !== previous.snapshotEpochUuid
    || expected.snapshotCommitSeq !== previous.snapshotCommitSeq || expected.leaseExpiresAt.getTime() !== previous.leaseExpiresAt.getTime()
    || expected.metadataWatermark !== previous.metadataWatermark
    || !nullableBytesEqual(expected.finiteMetadataReservationBytes, previous.finiteMetadataReservationBytes)
    || !nullableBytesEqual(expected.finiteMetadataReservationSha256, previous.finiteMetadataReservationSha256)
    || updated.scopeUuid !== expected.scopeUuid || updated.sessionId !== expected.sessionId || updated.attemptFence !== expected.attemptFence
    || updated.snapshotEpochUuid !== expected.snapshotEpochUuid || updated.snapshotCommitSeq !== expected.snapshotCommitSeq
    || updated.leaseExpiresAt.getTime() !== expected.leaseExpiresAt.getTime() || updated.metadataWatermark === null
    || updated.finiteMetadataReservationBytes === null || updated.finiteMetadataReservationSha256 === null
    || updated.finiteMetadataReservationBytes.byteLength < 1 || updated.finiteMetadataReservationBytes.byteLength > 65536
    || updated.metadataWatermark < 0n || updated.finiteMetadataReservationSha256.byteLength !== 32) return Result.fail(corruptionError(
      replacementScopeIdV1FromUuid(previous.scopeUuid), "snapshotLeaseInvalid"));
  finiteEntryLeaseExpectations.set(tx, updated);
  return Result.succeed(undefined);
}

function freshSessionRowCorrelationSql(table: PgTable, expected: Readonly<Record<string, unknown>>): SQL {
  return sql.join(Object.entries(getTableColumns(table)).map(([key, column]) =>
    sql`${column} is not distinct from ${sql.param(expected[key], column)}`), sql` and `);
}

/** Trusted replacement owner only: the caller owns this admitted transaction,
 * final guards and COMMIT. Close this capture after entry correlation, and
 * confirm the prepared finite entry only after that COMMIT succeeds. */
export const captureFiniteReplacementAttemptInTransactionEffect = Effect.fn(
  "PointMutationSessionActivation.captureFiniteReplacementAttemptInTransaction",
)(function* (tx: AppRowTransaction, input: ExactRunningAttemptKernelInputV1,
  original?: NonNullable<ReturnType<typeof import("../journal/finiteEntry").readOriginalFiniteExecutionAuthority>>) {
  yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx));
  if (readFiniteExecutionAuthorityObservation(tx, input.selector.scopeId) !== undefined)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  const clock = yield* Effect.tryPromise({ try: () => lockPointMutationSessionClock(tx, input.selector.scopeId),
    catch: mapAttemptLoadTransactionError });
  yield* Effect.fromResult(requireStableAttemptLoadAuthority(clock, input));
  const finiteAttempt = yield* lockFiniteAttemptAnchorInTransaction(tx, input.selector, input.executionClaim)
    .pipe(Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)));
  const session = finiteAttempt.session;
  const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, input.selector.scopeId),
    catch: mapAttemptLoadTransactionError });
  yield* Effect.fromResult(requireFiniteAttemptIsLive(finiteAttempt, databaseNow)).pipe(
    Effect.mapError(cause => corruptionError(input.selector.scopeId, "executionClaimInvalid", cause)));
  if (finiteAttempt.snapshotToken.epoch !== clock.record.epoch ||
    finiteAttempt.snapshotToken.commitSeq !== clock.record.lastCommitSeq || finiteAttempt.reservation !== null)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "snapshotLeaseInvalid"));
  finiteEntryAnchorExpectations.set(tx, Object.freeze({ session, snapshotToken: finiteAttempt.snapshotToken }));
  yield* requireCorrelatedFiniteEntryEffect(tx, input.selector.scopeId);
  if (session.executionAuthorityGeneration !== "application_v1" ||
    session.applicationExecutionAuthorityJson === null ||
    session.applicationExecutionAuthorityCanonicalBytes === null ||
    session.applicationExecutionAuthoritySha256 === null)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  if (original !== undefined && (original.context.anchor.deploymentId !== input.selector.deploymentId ||
    original.context.anchor.scopeId !== input.selector.scopeId || original.context.anchor.sessionId !== input.selector.sessionId ||
    original.context.anchor.attemptFence >= input.selector.attemptFence ||
    !bytesEqual(original.context.session.requestSha256, session.requestSha256) ||
    !bytesEqual(original.context.session.identityAccessPolicySha256, session.identityAccessPolicySha256) ||
    !bytesEqual(original.context.session.validatedArgsSha256, session.validatedArgsSha256) ||
    !bytesEqual(original.context.session.authorizationGrantSha256, session.authorizationGrantSha256)))
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  const canonical = original === undefined
    ? yield* canonicalizeApplicationMutationExecutionAuthorityV1(session.applicationExecutionAuthorityJson)
      .pipe(Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)))
    : original.canonicalExecutionAuthority;
  const authority = canonical.authority;
  if (!nullableJsonEqual(canonical.authority, session.applicationExecutionAuthorityJson) ||
    !bytesEqual(canonical.canonicalBytes, session.applicationExecutionAuthorityCanonicalBytes) ||
    !bytesEqual(canonical.sha256, session.applicationExecutionAuthoritySha256) ||
    authority.runtimeTarget.scopeId !== input.selector.scopeId ||
    authority.schemaVersionId !== session.schemaVersionId ||
    authority.runtimeTarget.function.path !== session.functionPath ||
    authority.runtimeTarget.function.kind !== session.functionKind)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  const applicationSelector = Object.freeze({
    executionAuthorityGeneration: session.executionAuthorityGeneration,
    applicationExecutionAuthorityFormat: authority.format,
    applicationExecutionAuthorityVersionText: authority.version.toString(),
    applicationExecutionAuthorityActivationSequence: authority.activationSequence,
    applicationExecutionAuthorityRevisionId: authority.runtimeTarget.revisionId,
    applicationExecutionAuthorityFunctionPath: authority.runtimeTarget.function.path,
    applicationExecutionAuthoritySchemaSha256: authority.runtimeTarget.schemaSha256,
  }) satisfies ApplicationGraphSessionSelector;
  const context = yield* finiteEntryAttemptContextFromAnchor(finiteAttempt, input.selector.deploymentId, clock.record, databaseNow);
  return Object.freeze({ context, applicationSelector, executionAuthority: authority, canonicalExecutionAuthority: canonical,
    session: Object.freeze({ ...session }),
    verifyFinalRows: requireCorrelatedFiniteEntryEffect(tx, input.selector.scopeId),
    close: () => { finiteEntryAnchorExpectations.delete(tx); },
  });
});

/** Seed only the original authenticated running finite lease for this transaction. */
export function seedFiniteEntryLeaseExpectation(tx: AppRowTransaction, lease: SnapshotLeaseRow): void {
  finiteEntryLeaseExpectations.set(tx, lease);
}

/** End the exact finite anchor expectation with its native transaction lifetime. */
export function closeFiniteEntryAnchorExpectation(tx: AppRowTransaction): void {
  finiteEntryAnchorExpectations.delete(tx);
}

/** End the exact running finite lease expectation with its native transaction lifetime. */
export function closeFiniteEntryLeaseExpectation(tx: AppRowTransaction): void {
  finiteEntryLeaseExpectations.delete(tx);
}
