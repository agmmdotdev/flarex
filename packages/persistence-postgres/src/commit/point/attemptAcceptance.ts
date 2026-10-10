import {
  Effect,
  Schema,
  Result,
} from "effect";
import {
  type TrustedScopeSelection,
  type LocatedTrustedScopeAuthority,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";
import {
  type PointCommitFinishingTransitionV1Error,
  corruption,
  type PointCommitStaleAuthorityV1Error,
  type PointCommitCorruptionV1Error,
} from "./errors";
import {
  routeAuthorityResolutionFailure,
  PointCommitSqlFailureMarkerV1,
  observeDrizzleQuery,
  sqlCall,
  stale,
  committedOutcomeCorruption,
} from "./sqlFailures";
import {
  ScopeUuidV1Schema,
  ScopeEpochUuidV1Schema,
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  projectScopeEpochUuidV1Result,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionAuthorizationRevocationEpochSchema,
  MAX_TRANSACTION_ATTEMPT_FENCE,
  TransactionAttemptFenceSchema,
} from "flarex-protocol/transaction-session";
import type {
  AppRowTransaction,
} from "../../storage/documents/appRows";
import {
  type PreparedPointCommitAuthorityCommandV1,
  pointCommitCommandScopeUuid,
  type PreparedPointCommitDependencyCommandV1,
  type PreparedPointCommitTransactionCommandV1,
  type PointCommitSessionLockModeV1,
  type PreparedPointCommitAttemptScalarCommandV1,
} from "./preparedCommands";
import type {
  PointCommitTransactionProofOptionsV1,
} from "./constructionContracts";
import type {
  LockedPointCommitClockV1,
  PointCommitScopeClockRowV1,
  LockedCommittedPointOutcomeV1,
  LockedPointCommitSessionV1,
  LockedPointCommitLeaseV1,
} from "./lockedState";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
} from "./promiseBoundary";
import {
  lockScopeExecutionAuthorityInTransactionEffect,
  ScopeAuthorizationRevocationEpochPersistenceError,
  selectScopeClockRows,
  lockScopeClockRowsForOrdinaryWriteInTransactionEffect,
  decodeScopeClockRecordResult,
} from "../../scope/scopeClock";
import {
  eq,
  sql,
  and,
  inArray,
} from "drizzle-orm";
import {
  fxSystemScopeClocks,
  fxSystemIdempotency,
  fxSystemCommits,
  fxSystemApplicationReadinessV1,
  fxSystemSnapshotLeases,
  fxSystemTransactionSessions,
  fxSystemTransactionJournals,
} from "../../database/schema";
import {
  captureCommittedOutcomeLookup,
  decodePointCommitSchemaVersionIdResult,
} from "./capture";
import {
  type CommittedPointOutcomeStoredScalarEvidenceV1,
  validateCommittedPointOutcomeRequestEvidenceShapeV1,
  validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1,
} from "../committedPointOutcome";
import type {
  RecoveredApplicationRelationActiveSelection,
} from "./relationRecovery";
import {
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
} from "../../application/applicationActiveHeadRead";
import {
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
  bytesEqualFullScan as bytesEqual,
} from "@flarex/utils/bytes";
import type {
  PreparedPointCommitApplicationRelations,
  LocatedPreparedPointCommitApplicationRelations,
} from "../../storage/materialization/model";
import {
  fxSystemApplicationActiveHeads,
} from "../../application/applicationActivationSchema";
import {
  ApplicationRelationCommitUnavailableError,
} from "../../application/relations/applicationRelationCommit";
import {
  fxSystemApplicationReadiness,
} from "../../application/relations/applicationRelationSchema";
import {
  readStoredFiniteMetadataReservation,
} from "../../execution/finiteMetadataReservation";
import {
  observeExecution,
} from "../../execution/diagnostics/operation";
import {
  finiteDateMilliseconds,
} from "@flarex/utils/dates";
import type {
  PointCommitAuthorityPinsV1,
  PointCommitSessionScalarsV1,
} from "./contracts";
import {
  type SessionJournal,
  decodeCanonicalSessionJournalEffect,
} from "flarex-protocol/commit-protocol";

export const resolvePointCommitAuthority = Effect.fn(
  "PointCommitTransaction.resolveAuthority",
)((
  selection: TrustedScopeSelection,
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): Effect.Effect<
  LocatedTrustedScopeAuthority,
  PointCommitFinishingTransitionV1Error
> =>
  resolveLocatedTrustedScopeAuthorityByIdEffect(selection, {
    scopeMetadata: ports.scopeMetadata,
    provisioningReceipts: ports.provisioningReceipts,
    scopeClockTargets: ports.scopeSessionTargets,
  }).pipe(
    // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: transaction - this owner projects every typed authority-resolution failure; the router preserves unexpected defects.
    Effect.catch(routeAuthorityResolutionFailure)));

const decodePointCommitScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);

const decodePointCommitScopeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);

export const decodePointCommitRetainedFloorResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);

const decodePointCommitAuthorizationRevocationEpochResult =
  Schema.decodeUnknownResult(
    Schema.toType(TransactionAuthorizationRevocationEpochSchema),
  );

export async function lockPointCommitClock(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  protection: "key share" | "no key update" = "no key update",
): Promise<LockedPointCommitClockV1> {
  if (protection === "key share") projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    lockScopeExecutionAuthorityInTransactionEffect(tx, command.authorityPins.scopeId, "key share").pipe(Effect.mapError(cause =>
      cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
        ? new PointCommitSqlFailureMarkerV1("lockScopeClock", cause.cause) : corruption("scopeClockInvalid")))));
  const query = selectScopeClockRows(tx)
    .where(eq(
      fxSystemScopeClocks.scopeId,
      command.authorityPins.scopeId,
    ))
    .limit(2)
    .for(protection, { of: fxSystemScopeClocks });
  if (protection === "key share") observeDrizzleQuery("lockScopeClock", query, options);
  const rows = protection === "no key update"
    ? projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, command.authorityPins.scopeId, options.observeQuery).pipe(Effect.mapError(cause =>
        cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
          ? new PointCommitSqlFailureMarkerV1("lockScopeClock", cause.cause) : corruption("scopeClockInvalid")))))
    : await sqlCall("lockScopeClock", () => query);
  return projectPointCommitTransactionResult(
    materializeLockedPointCommitClockResult(rows),
  );
}

function materializeLockedPointCommitClockResult(
  rows: ReadonlyArray<PointCommitScopeClockRowV1>,
): Result.Result<
  LockedPointCommitClockV1,
  PointCommitStaleAuthorityV1Error | PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    if (rows.length === 0) {
      return yield* Result.fail(stale("scopeChanged"));
    }
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    return yield* decodeLockedPointCommitClockResult(row);
  });
}

export function decodeLockedPointCommitClockResult(
  row: PointCommitScopeClockRowV1,
): Result.Result<LockedPointCommitClockV1, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const record = yield* pointCommitClockFieldResult(
      decodeScopeClockRecordResult(row),
    );
    const scopeUuid = yield* pointCommitClockFieldResult(
      decodePointCommitScopeUuidResult(row.scopeUuid),
    );
    const epochUuid = yield* pointCommitClockFieldResult(
      decodePointCommitScopeEpochUuidResult(row.epochUuid),
    );
    const scopeProjection = yield* pointCommitClockFieldResult(
      projectScopeIdUuidV1Result(record.scopeId),
    );
    if (scopeUuid !== scopeProjection.scopeUuid) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const epochProjection = yield* pointCommitClockFieldResult(
      projectScopeEpochUuidV1Result(record.epoch),
    );
    if (epochUuid !== epochProjection.epochUuid) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const oldestAvailableCommitSeq = yield* pointCommitClockFieldResult(
      decodePointCommitRetainedFloorResult(row.oldestAvailableCommitSeq),
    );
    if (oldestAvailableCommitSeq > record.lastCommitSeq) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const authorizationRevocationEpoch = yield* pointCommitClockFieldResult(
      decodePointCommitAuthorizationRevocationEpochResult(
        row.authorizationRevocationEpoch,
      ),
    );
    return Object.freeze({
      record,
      oldestAvailableCommitSeq,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch,
    });
  });
}

function pointCommitClockFieldResult<Value>(
  result: Result.Result<Value, unknown>,
): Result.Result<Value, PointCommitCorruptionV1Error> {
  return result.pipe(
    Result.mapError(() => corruption("scopeClockInvalid")),
  );
}

export async function inspectCommittedOutcomeInTransaction(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedCommittedPointOutcomeV1 | null> {
  const lookup = captureCommittedOutcomeLookup(command);
  const query = tx
    .select({
      outcomeScopeUuid: fxSystemIdempotency.scopeUuid,
      outcomeRequestKey: fxSystemIdempotency.requestKey,
      identityHashByteLength: sql<number>`
        octet_length(${fxSystemIdempotency.identityAccessPolicySha256})
      `,
      identityMatches: sql<boolean>`
        ${fxSystemIdempotency.identityAccessPolicySha256} =
          ${lookup.expectedIdentityAccessPolicySha256}
      `,
      functionPathValid: sql<boolean>`
        btrim(
          ${fxSystemIdempotency.functionPath},
          U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff'
        ) <> ''
      `,
      functionPathMatches: sql<boolean>`
        ${fxSystemIdempotency.functionPath} = ${lookup.expectedFunctionPath}
      `,
      requestHashByteLength: sql<number>`
        octet_length(${fxSystemIdempotency.requestSha256})
      `,
      requestMatches: sql<boolean>`
        ${fxSystemIdempotency.requestSha256} = ${lookup.expectedRequestSha256}
      `,
      epochUuid: fxSystemIdempotency.epochUuid,
      commitSeq: fxSystemIdempotency.commitSeq,
      resultState: fxSystemIdempotency.resultState,
      resultEncoding: fxSystemIdempotency.resultEncoding,
      resultValueCodecVersion: fxSystemIdempotency.resultValueCodecVersion,
      resultSemanticBytes: fxSystemIdempotency.resultSemanticBytes,
      resultByteLength: sql<number | null>`
        case when ${fxSystemIdempotency.resultBytes} is null then null
          else octet_length(${fxSystemIdempotency.resultBytes}) end
      `,
      resultSha256ByteLength: sql<number | null>`
        case when ${fxSystemIdempotency.resultSha256} is null then null
          else octet_length(${fxSystemIdempotency.resultSha256}) end
      `,
      resultExpiredAt: fxSystemIdempotency.resultExpiredAt,
      createdAt: fxSystemIdempotency.createdAt,
      retainedHeaderScopeUuid: fxSystemCommits.scopeUuid,
      retainedHeaderEpochUuid: fxSystemCommits.epochUuid,
      retainedHeaderCommitSeq: fxSystemCommits.commitSeq,
    })
    .from(fxSystemIdempotency)
    .leftJoin(
      fxSystemCommits,
      and(
        eq(fxSystemCommits.scopeUuid, fxSystemIdempotency.scopeUuid),
        eq(fxSystemCommits.commitSeq, fxSystemIdempotency.commitSeq),
      ),
    )
    .where(and(
      eq(fxSystemIdempotency.scopeUuid, pointCommitCommandScopeUuid(command)),
      eq(fxSystemIdempotency.requestKey, command.authorityPins.requestKey),
    ))
    .limit(2);
  observeDrizzleQuery("recheckOutcome", query, options);
  const rows = await sqlCall("recheckOutcome", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length > 1) {
      return yield* Result.fail(
        committedOutcomeCorruption(lookup, "duplicateOutcome"),
      );
    }
    const row = rows[0];
    if (row === undefined) return null;
    return yield* acceptObservedCommittedOutcomeResult(row, clock, command);
  }));
}

export function acceptObservedCommittedOutcomeResult(row: CommittedPointOutcomeStoredScalarEvidenceV1,
  clock: LockedPointCommitClockV1, command: PreparedPointCommitAuthorityCommandV1) {
  const lookup = captureCommittedOutcomeLookup(command);
  return Result.gen(function* () {
    yield* validateCommittedPointOutcomeRequestEvidenceShapeV1(lookup, row);
    const scalars =
      yield* validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1(
        lookup,
        row,
        Object.freeze({
          lastCommitSeq: clock.record.lastCommitSeq,
          oldestAvailableCommitSeq: clock.oldestAvailableCommitSeq,
        }),
      );
    return Object.freeze({
      state: scalars.state,
      commitSeq: scalars.token.commitSeq,
    });
  });
}

export function requireLockedClockAuthorityResult(
  clock: LockedPointCommitClockV1,
  preliminary: TrustedScopeAuthority,
  command: PreparedPointCommitAuthorityCommandV1,
): Result.Result<
  void,
  PointCommitStaleAuthorityV1Error | PointCommitCorruptionV1Error
> {
  const pins = command.authorityPins;
  return Result.gen(function* () {
    if (
      clock.record.scopeId !== pins.scopeId ||
      preliminary.scopeId !== pins.scopeId ||
      preliminary.deploymentId !== pins.deploymentId ||
      clock.scopeUuid !== pointCommitCommandScopeUuid(command)
    ) {
      return yield* Result.fail(stale("scopeChanged"));
    }
    if (
      clock.record.storageGeneration !== "flarexdb_v1" ||
      preliminary.storageGeneration !== "flarexdb_v1" ||
      clock.record.storageGeneration !== pins.storageGeneration ||
      preliminary.storageGeneration !== pins.storageGeneration ||
      clock.record.storageGenerationFence !== pins.storageGenerationFence ||
      preliminary.storageGenerationFence !== pins.storageGenerationFence
    ) {
      return yield* Result.fail(stale("generationChanged"));
    }
    if (
      clock.record.epoch !== pins.snapshotToken.epoch ||
      preliminary.epoch !== pins.snapshotToken.epoch
    ) {
      return yield* Result.fail(stale("epochChanged"));
    }
    if (
      clock.authorizationRevocationEpoch !==
        pins.authorizationRevocationEpoch
    ) {
      return yield* Result.fail(stale("revocationEpochChanged"));
    }
    if (pins.snapshotToken.commitSeq > clock.record.lastCommitSeq) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
  });
}

export async function validateActiveRelationSelectionForPointCommit(
  tx: AppRowTransaction,
  command: PreparedPointCommitDependencyCommandV1,
): Promise<void> {
  if (command.relationDependencies.length === 0) return;
  await validateExpectedActiveRelationSelectionForPointCommit(
    tx,
    command.authorityPins.scopeId,
    command.relationDependencies,
  );
}

export async function validateExpectedActiveRelationSelectionForPointCommit(
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  expected: ReadonlyArray<RecoveredApplicationRelationActiveSelection>,
): Promise<void> {
  const settled = await runPointCommitInTransactionEffect(
    readCoherentApplicationActiveHeadForShareInTransactionEffect(
      tx,
      scopeId,
    ),
  );
  const active = projectPointCommitTransactionResult(settled.pipe(
    Result.mapError((failure) => failure.reason === "resourceFailure"
      ? new PointCommitSqlFailureMarkerV1(
          "validateActiveRelationSelection",
          failure.cause ?? failure,
        )
      : corruption("activeApplicationHeadInvalid")),
  ));
  if (
    active === null ||
    active.head.readinessKind !== "relation" ||
    expected.some((dependency) =>
      dependency.activationSequence !== active.head.activationSequence ||
      dependency.activeHeadSha256Hex !==
        encodeBytesToLowercaseHex(active.head.headSha256)
    )
  ) {
    throw stale("activeRelationSelectionChanged");
  }
}

export async function validateActiveApplicationSchemaForPointCommit(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  preparedApplicationRelations: PreparedPointCommitApplicationRelations | null,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LocatedPreparedPointCommitApplicationRelations | null> {
  if (command.authorityPins.executionAuthorityGeneration !== "application_v1") {
    return preparedApplicationRelations?.definitions === null ||
        preparedApplicationRelations === null
      ? null
      : Object.freeze({
          port: preparedApplicationRelations.port,
          definitions: preparedApplicationRelations.definitions,
        });
  }
  const contractQuery = tx.select({
    readinessContractVersion:
      fxSystemApplicationActiveHeads.readinessContractVersion,
  }).from(fxSystemApplicationActiveHeads).where(eq(
    fxSystemApplicationActiveHeads.scopeId,
    command.authorityPins.scopeId,
  )).limit(2).for("share");
  const contractRows = await sqlCall(
    "validateActiveApplicationSchema",
    () => contractQuery,
  );
  const readinessContractVersion =
    contractRows[0]?.readinessContractVersion;
  if (contractRows.length !== 1 ||
    (readinessContractVersion !== 1 && readinessContractVersion !== 2 && readinessContractVersion !== 3)) {
    throw corruption("activeApplicationHeadInvalid");
  }
  if (
    (readinessContractVersion === 2 || readinessContractVersion === 3) &&
    command.rowIntents.some(row => !command.participantMaterialDocumentIds.has(row.documentId)) &&
    preparedApplicationRelations === null
  ) {
    throw new ApplicationRelationCommitUnavailableError({
      reason: "compositionMissing",
    });
  }
  if (
    (readinessContractVersion === 2 || readinessContractVersion === 3) &&
    command.rowIntents.some(row => !command.participantMaterialDocumentIds.has(row.documentId)) &&
    preparedApplicationRelations?.definitions === null
  ) {
    throw new ApplicationRelationCommitUnavailableError({
      reason: "bindingUnavailable",
    });
  }
  const applicationRelations = preparedApplicationRelations?.definitions ??
    null;
  const query = readinessContractVersion === 1
    ? tx.select({
        deploymentId: fxSystemApplicationReadinessV1.deploymentId,
        schemaVersionId: fxSystemApplicationReadinessV1.schemaVersionId,
        applicationSchemaSha256:
          fxSystemApplicationReadinessV1.applicationSchemaSha256,
        schemaManifestSha256:
          fxSystemApplicationReadinessV1.schemaManifestSha256,
        boundPublicationSha256: sql<Uint8Array | null>`null`,
      }).from(fxSystemApplicationActiveHeads).innerJoin(
        fxSystemApplicationReadinessV1,
        and(
          eq(fxSystemApplicationReadinessV1.scopeId,
            fxSystemApplicationActiveHeads.scopeId),
          eq(fxSystemApplicationReadinessV1.revisionId,
            fxSystemApplicationActiveHeads.revisionId),
          eq(fxSystemApplicationReadinessV1.readinessSha256,
            fxSystemApplicationActiveHeads.readinessSha256),
        ),
      ).where(and(
        eq(fxSystemApplicationActiveHeads.scopeId,
          command.authorityPins.scopeId),
        eq(fxSystemApplicationActiveHeads.readinessContractVersion, 1),
      )).limit(2).for("share")
    : tx.select({
        deploymentId: fxSystemApplicationReadiness.deploymentId,
        schemaVersionId: fxSystemApplicationReadiness.schemaVersionId,
        applicationSchemaSha256:
          fxSystemApplicationReadiness.applicationSchemaSha256,
        schemaManifestSha256:
          fxSystemApplicationReadiness.schemaManifestSha256,
        boundPublicationSha256:
          fxSystemApplicationReadiness.boundPublicationSha256,
      }).from(fxSystemApplicationActiveHeads).innerJoin(
        fxSystemApplicationReadiness,
        and(
          eq(fxSystemApplicationReadiness.scopeId,
            fxSystemApplicationActiveHeads.scopeId),
          eq(fxSystemApplicationReadiness.revisionId,
            fxSystemApplicationActiveHeads.revisionId),
          eq(fxSystemApplicationReadiness.readinessSha256,
            fxSystemApplicationActiveHeads.readinessSha256),
          eq(fxSystemApplicationReadiness.relationSetReadinessSha256,
            fxSystemApplicationActiveHeads.relationSetReadinessSha256),
          eq(fxSystemApplicationReadiness.relationCount,
            fxSystemApplicationActiveHeads.relationCount),
        ),
      ).where(and(
        eq(fxSystemApplicationActiveHeads.scopeId,
          command.authorityPins.scopeId),
        inArray(fxSystemApplicationActiveHeads.readinessContractVersion, [2, 3]),
      )).limit(2).for("share");
  observeDrizzleQuery("validateActiveApplicationSchema", query, options);
  const rows = await sqlCall(
    "validateActiveApplicationSchema",
    () => query,
  );
  projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("activeApplicationHeadInvalid"));
    }
    const row = rows[0];
    if (
      row === undefined ||
      row.deploymentId !== command.authorityPins.deploymentId
    ) {
      return yield* Result.fail(corruption("activeApplicationHeadInvalid"));
    }
    const activeSchemaVersionId = yield* decodePointCommitSchemaVersionIdResult(
      row.schemaVersionId,
    ).pipe(
      Result.mapError(() => corruption("activeApplicationHeadInvalid")),
    );
    if (activeSchemaVersionId !== command.authorityPins.schemaVersionId) {
      return yield* Result.fail(stale("activeSchemaChanged"));
    }
    if (
      applicationRelations !== null &&
      (
        !isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) ||
        !isUint8ArrayWithByteLength(row.schemaManifestSha256, 32) ||
        encodeBytesToLowercaseHex(row.applicationSchemaSha256) !==
          applicationRelations.applicationSchemaSha256 ||
        encodeBytesToLowercaseHex(row.schemaManifestSha256) !==
          applicationRelations.schemaManifestSha256 ||
        (
          (readinessContractVersion === 2 || readinessContractVersion === 3) &&
          (
            !isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) ||
            encodeBytesToLowercaseHex(row.boundPublicationSha256) !==
              applicationRelations.boundPublicationSha256
          )
        )
      )
    ) {
      return yield* Result.fail(corruption("relationBindingInvalid"));
    }
  }));
  return preparedApplicationRelations !== null &&
      preparedApplicationRelations.definitions !== null
    ? Object.freeze({
        port: preparedApplicationRelations.port,
        definitions: preparedApplicationRelations.definitions,
      })
    : null;
}

export function preparedApplicationRelationsForFiniteCommit(
  prepared: PreparedPointCommitApplicationRelations | null,
): LocatedPreparedPointCommitApplicationRelations | null {
  return prepared?.definitions == null ? null : Object.freeze({ port: prepared.port, definitions: prepared.definitions });
}

export const requireFinitePointCommitReservation = Effect.fnUntraced(function* (
  command: Pick<PreparedPointCommitTransactionCommandV1, "authorityPins" | "finiteMetadataReservationSha256Hex">,
  lease: typeof fxSystemSnapshotLeases.$inferSelect,
) {
  const reservation = yield* readStoredFiniteMetadataReservation(lease).pipe(Effect.mapError(error =>
    error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("lockLease", error.cause ?? error) : corruption("leaseInvalid")));
  const pins = command.authorityPins;
  if (lease.finiteMetadataReservationSha256 === null ||
    encodeBytesToLowercaseHex(lease.finiteMetadataReservationSha256) !== command.finiteMetadataReservationSha256Hex ||
    reservation.deploymentId !== pins.deploymentId || reservation.scopeId !== pins.scopeId || reservation.sessionId !== pins.sessionId ||
    reservation.attemptFence !== pins.attemptFence || reservation.storageGeneration !== pins.storageGeneration ||
    reservation.storageGenerationFence !== pins.storageGenerationFence || reservation.schemaVersionId !== pins.schemaVersionId ||
    reservation.snapshotToken.scopeId !== pins.snapshotToken.scopeId || reservation.snapshotToken.epoch !== pins.snapshotToken.epoch ||
    reservation.snapshotToken.commitSeq !== pins.snapshotToken.commitSeq)
    return yield* Effect.fail(corruption("leaseInvalid"));
  return reservation;
}, work => observeExecution("PointCommit.requireFiniteReservation", work));

function selectPointCommitSessionRows(tx: AppRowTransaction, command: PreparedPointCommitAuthorityCommandV1) {
  return tx
    .select({
      scopeUuid: fxSystemTransactionSessions.scopeUuid,
      sessionId: fxSystemTransactionSessions.sessionId,
      storageGeneration: fxSystemTransactionSessions.storageGeneration,
      storageGenerationFence:
        fxSystemTransactionSessions.storageGenerationFence,
      executionAuthorityGeneration:
        fxSystemTransactionSessions.executionAuthorityGeneration,
      applicationExecutionAuthoritySha256:
        fxSystemTransactionSessions.applicationExecutionAuthoritySha256,
      packageId: fxSystemTransactionSessions.packageId,
      artifactRuntime: fxSystemTransactionSessions.artifactRuntime,
      artifactId: fxSystemTransactionSessions.artifactId,
      sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
      executionModule: fxSystemTransactionSessions.executionModule,
      functionPath: fxSystemTransactionSessions.functionPath,
      functionKind: fxSystemTransactionSessions.functionKind,
      schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
      policyVersion: fxSystemTransactionSessions.policyVersion,
      identityAccessPolicySha256:
        fxSystemTransactionSessions.identityAccessPolicySha256,
      validatedArgsValueCodecVersion:
        fxSystemTransactionSessions.validatedArgsValueCodecVersion,
      validatedArgsCanonicalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})
      `,
      validatedArgsSha256: fxSystemTransactionSessions.validatedArgsSha256,
      authorizationGrantId:
        fxSystemTransactionSessions.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        fxSystemTransactionSessions.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionSessions.authorizationGrantCanonicalBytes})
      `,
      authorizationGrantSha256:
        fxSystemTransactionSessions.authorizationGrantSha256,
      authorizationRevocationEpoch:
        fxSystemTransactionSessions.authorizationRevocationEpoch,
      authorizationGrantExpiresAt:
        fxSystemTransactionSessions.authorizationGrantExpiresAt,
      requestKey: fxSystemTransactionSessions.requestKey,
      requestSha256: fxSystemTransactionSessions.requestSha256,
      lifecycle: fxSystemTransactionSessions.lifecycle,
      attemptFence: fxSystemTransactionSessions.attemptFence,
      protocolVersion: fxSystemTransactionSessions.protocolVersion,
      hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
      createdAt: fxSystemTransactionSessions.createdAt,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    })
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(
        fxSystemTransactionSessions.scopeUuid,
        pointCommitCommandScopeUuid(command),
      ),
      eq(
        fxSystemTransactionSessions.sessionId,
        command.authorityPins.sessionId,
      ),
    ))
    .limit(2)
    ;
}

type PointCommitSelectedSessionRow = Awaited<ReturnType<typeof selectPointCommitSessionRows>>[number];

export function validatePointCommitSessionRowsResult(rows: readonly PointCommitSelectedSessionRow[],
  command: PreparedPointCommitAuthorityCommandV1, mode: PointCommitSessionLockModeV1) {
  return Result.gen(function* () {
    if (rows.length === 0) return yield* Result.fail(stale("attemptMissing"));
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("sessionDuplicate"));
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(corruption("sessionDuplicate"));
    }
    const expectedAttemptFence = command.authorityPins.attemptFence;
    const replacementAttemptFence = expectedAttemptFence <
        MAX_TRANSACTION_ATTEMPT_FENCE
      ? TransactionAttemptFenceSchema.make(expectedAttemptFence + 1n)
      : null;
    const isReplacement = mode === "replaceAttempt" ||
      mode === "replaceRunningRelationConflict";
    const observesReplacement = isReplacement &&
      replacementAttemptFence !== null &&
      row.attemptFence === replacementAttemptFence;
    if (row.attemptFence !== expectedAttemptFence && !observesReplacement) {
      return yield* Result.fail(stale("attemptReplaced"));
    }
    if (isReplacement) {
      const sourceLifecycle = mode === "replaceAttempt"
        ? "finishing"
        : "running";
      if (
        (observesReplacement && row.lifecycle !== "running") ||
        (!observesReplacement && row.lifecycle !== sourceLifecycle)
      ) {
        return yield* Result.fail(stale("lifecycleChanged"));
      }
    } else if (mode === "resolveFinite") {
      if (row.lifecycle !== "running" && row.lifecycle !== "retrying" && row.lifecycle !== "aborted" && row.lifecycle !== "expired")
        return yield* Result.fail(stale("lifecycleChanged"));
    } else if (mode === "recoverRunningRelationConflict" || mode === "publishFinite") {
      if (row.lifecycle !== "running") {
        return yield* Result.fail(stale("lifecycleChanged"));
      }
    } else if (mode === "enterFinishing") {
      if (row.lifecycle !== "running" && row.lifecycle !== "finishing") {
        return yield* Result.fail(stale("lifecycleChanged"));
      }
    } else if (row.lifecycle !== "finishing") {
      if (mode === "publish" && row.lifecycle === "committed") {
        return yield* Result.fail(corruption("committedOutcomeMissing"));
      }
      return yield* Result.fail(stale("lifecycleChanged"));
    }
    const expected = command.session;
    const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
      row.authorizationGrantExpiresAt,
    );
    const hardExpiresAtMilliseconds = finiteDateMilliseconds(row.hardExpiresAt);
    const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
    const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
    if (
      row.scopeUuid !== pointCommitCommandScopeUuid(command) ||
      row.sessionId !== command.authorityPins.sessionId ||
      row.storageGeneration !== expected.storageGeneration ||
      row.storageGenerationFence !== expected.storageGenerationFence ||
      !storedExecutionAuthorityMatchesPointCommit(
        row,
        command.authorityPins,
        expected,
      ) ||
      row.functionPath !== expected.functionPath ||
      row.functionKind !== expected.functionKind ||
      row.schemaVersionId !== expected.schemaVersionId ||
      row.policyVersion !== expected.policyVersion ||
      !bytesEqual(
        row.identityAccessPolicySha256,
        expected.identityAccessPolicySha256,
      ) ||
      row.validatedArgsValueCodecVersion !==
        expected.validatedArgsValueCodecVersion ||
      row.validatedArgsCanonicalByteLength !==
        (mode === "resolveFinite" && (row.lifecycle === "aborted" || row.lifecycle === "expired") ? null : expected.validatedArgsCanonicalByteLength) ||
      !bytesEqual(row.validatedArgsSha256, expected.validatedArgsSha256) ||
      row.authorizationGrantId !== expected.authorizationGrantId ||
      row.authorizationGrantValueCodecVersion !==
        expected.authorizationGrantValueCodecVersion ||
      row.authorizationGrantCanonicalByteLength !==
        (mode === "resolveFinite" && (row.lifecycle === "aborted" || row.lifecycle === "expired") ? null : expected.authorizationGrantCanonicalByteLength) ||
      !bytesEqual(
        row.authorizationGrantSha256,
        expected.authorizationGrantSha256,
      ) ||
      row.authorizationRevocationEpoch !==
        expected.authorizationRevocationEpoch ||
      row.requestKey !== expected.requestKey ||
      !bytesEqual(row.requestSha256, expected.requestSha256) ||
      row.protocolVersion !== expected.protocolVersion ||
      authorizationGrantExpiresAtMilliseconds === undefined ||
      hardExpiresAtMilliseconds === undefined ||
      createdAtMilliseconds === undefined ||
      updatedAtMilliseconds === undefined ||
      authorizationGrantExpiresAtMilliseconds !==
        expected.authorizationGrantExpiresAtMilliseconds ||
      hardExpiresAtMilliseconds !== expected.hardExpiresAtMilliseconds ||
      createdAtMilliseconds !== expected.createdAtMilliseconds ||
      (
        isReplacement && observesReplacement
          ? updatedAtMilliseconds < expected.updatedAtMilliseconds
          : mode === "enterFinishing"
          ? row.lifecycle === "running"
            ? updatedAtMilliseconds !== expected.updatedAtMilliseconds
            : updatedAtMilliseconds < expected.updatedAtMilliseconds
          : mode === "resolveFinite" && (row.lifecycle === "aborted" || row.lifecycle === "expired")
          ? updatedAtMilliseconds < expected.updatedAtMilliseconds
          : updatedAtMilliseconds !== expected.updatedAtMilliseconds
      )
    ) {
      return yield* Result.fail(corruption("sessionInvalid"));
    }
    if (row.lifecycle !== "running" && row.lifecycle !== "finishing" && !(mode === "resolveFinite" &&
      (row.lifecycle === "retrying" || row.lifecycle === "aborted" || row.lifecycle === "expired"))) {
      return yield* Result.fail(corruption("sessionInvalid"));
    }
    return Object.freeze({
      lifecycle: row.lifecycle,
      attemptFence: observesReplacement
        ? replacementAttemptFence
        : expectedAttemptFence,
      authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
      updatedAtMilliseconds,
    });
  });
}

export async function lockPointCommitSession(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  mode: PointCommitSessionLockModeV1,
): Promise<LockedPointCommitSessionV1> {
  const query = selectPointCommitSessionRows(tx, command).for("update");
  observeDrizzleQuery("lockSession", query, options);
  const rows = await sqlCall("lockSession", () => query);
  const accepted = projectPointCommitTransactionResult(validatePointCommitSessionRowsResult(rows, command, mode));
  // The Promise rollback adapter maps this terminal lifecycle refusal to its
  // existing typed stale-authority channel.
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - the native Drizzle callback rejects the typed terminal lifecycle refusal so the transaction rolls back
  if (accepted.lifecycle !== "running" && accepted.lifecycle !== "finishing") throw stale("lifecycleChanged");
  return { ...accepted, lifecycle: accepted.lifecycle };
}

function storedExecutionAuthorityMatchesPointCommit(
  row: Readonly<{
    readonly executionAuthorityGeneration: string;
    readonly packageId: string | null;
    readonly artifactRuntime: string | null;
    readonly artifactId: string | null;
    readonly sourcePackageHash: string | null;
    readonly executionModule: string | null;
    readonly applicationExecutionAuthoritySha256: Uint8Array | null;
  }>,
  pins: PointCommitAuthorityPinsV1,
  session: PointCommitSessionScalarsV1,
): boolean {
  if (
    row.executionAuthorityGeneration !== pins.executionAuthorityGeneration ||
    session.executionAuthorityGeneration !== pins.executionAuthorityGeneration
  ) return false;
  if (
    pins.executionAuthorityGeneration === "legacy_dynamic_worker_v1" &&
    session.executionAuthorityGeneration === "legacy_dynamic_worker_v1"
  ) {
    return row.packageId === pins.packageId && pins.packageId === session.packageId &&
      row.artifactRuntime === pins.artifactRuntime &&
      pins.artifactRuntime === session.artifactRuntime &&
      row.artifactId === pins.artifactId && pins.artifactId === session.artifactId &&
      row.sourcePackageHash === pins.sourcePackageHash &&
      pins.sourcePackageHash === session.sourcePackageHash &&
      row.executionModule === pins.executionModule &&
      pins.executionModule === session.executionModule &&
      row.applicationExecutionAuthoritySha256 === null;
  }
  if (
    pins.executionAuthorityGeneration === "application_v1" &&
    session.executionAuthorityGeneration === "application_v1"
  ) {
    return row.packageId === null && row.artifactRuntime === null &&
      row.artifactId === null && row.sourcePackageHash === null &&
      row.executionModule === null &&
      row.applicationExecutionAuthoritySha256 !== null &&
      bytesEqual(
        row.applicationExecutionAuthoritySha256,
        pins.applicationExecutionAuthoritySha256,
      ) && bytesEqual(
        pins.applicationExecutionAuthoritySha256,
        session.applicationExecutionAuthoritySha256,
      );
  }
  return false;
}

export async function lockPointCommitLease(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedPointCommitLeaseV1> {
  const query = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(
        fxSystemSnapshotLeases.scopeUuid,
        pointCommitCommandScopeUuid(command),
      ),
      eq(
        fxSystemSnapshotLeases.sessionId,
        command.authorityPins.sessionId,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockLease", query, options);
  const rows = await sqlCall("lockLease", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length === 0) return yield* Result.fail(stale("leaseMissing"));
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("leaseDuplicate"));
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(corruption("leaseDuplicate"));
    }
    if (row.attemptFence !== command.authorityPins.attemptFence) {
      return yield* Result.fail(stale("leaseReplaced"));
    }
    const expectedEpochUuid = yield* projectScopeEpochUuidV1Result(
      command.authorityPins.snapshotToken.epoch,
    ).pipe(Result.mapError(() => corruption("leaseInvalid")));
    const snapshotEpochUuid = yield* decodePointCommitScopeEpochUuidResult(
      row.snapshotEpochUuid,
    ).pipe(Result.mapError(() => corruption("leaseInvalid")));
    const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
      row.leaseExpiresAt,
    );
    if (
      row.scopeUuid !== pointCommitCommandScopeUuid(command) ||
      row.sessionId !== command.authorityPins.sessionId ||
      snapshotEpochUuid !== expectedEpochUuid.epochUuid ||
      row.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
      leaseExpiresAtMilliseconds === undefined ||
      ("sealIdentity" in command &&
        leaseExpiresAtMilliseconds !==
          command.sealIdentity.leaseExpiresAtMilliseconds) ||
      leaseExpiresAtMilliseconds > command.session.hardExpiresAtMilliseconds
    ) {
      return yield* Result.fail(corruption("leaseInvalid"));
    }
    return Object.freeze({
      expiresAtMilliseconds: leaseExpiresAtMilliseconds,
      row,
    });
  }));
}

export async function lockPointCommitJournalRoot(
  tx: AppRowTransaction,
  command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<"durableOperations" | "finiteRoot"> {
  const query = tx
    .select({
      scopeUuid: fxSystemTransactionJournals.scopeUuid,
      sessionId: fxSystemTransactionJournals.sessionId,
      attemptFence: fxSystemTransactionJournals.attemptFence,
      executionProfile: fxSystemTransactionJournals.executionProfile,
      state: fxSystemTransactionJournals.state,
      lastSyscallSequence:
        fxSystemTransactionJournals.lastSyscallSequence,
      creationTimeSeed: fxSystemTransactionJournals.creationTimeSeed,
      nextCreationTime: fxSystemTransactionJournals.nextCreationTime,
      readDocuments: fxSystemTransactionJournals.readDocuments,
      readSemanticBytes: fxSystemTransactionJournals.readSemanticBytes,
      pointDependencyCount:
        fxSystemTransactionJournals.pointDependencyCount,
      indexedQuerySyscalls:
        fxSystemTransactionJournals.indexedQuerySyscalls,
      indexRangeDependencyCount:
        fxSystemTransactionJournals.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        fxSystemTransactionJournals.indexRangeDependencyEvidenceBytes,
      relationReadSyscalls:
        fxSystemTransactionJournals.relationReadSyscalls,
      relationDependencyCount:
        fxSystemTransactionJournals.relationDependencyCount,
      relationBaseOccurrences:
        fxSystemTransactionJournals.relationBaseOccurrences,
      writeOperations: fxSystemTransactionJournals.writeOperations,
      writeSemanticBytes: fxSystemTransactionJournals.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        fxSystemTransactionJournals.materialWriteEventEvidenceBytes,
      receiptEvidenceBytes: fxSystemTransactionJournals.receiptEvidenceBytes,
      participantWorkBytes: fxSystemTransactionJournals.participantWorkBytes,
      participantWorkCalls: fxSystemTransactionJournals.participantWorkCalls,
      failureDimension: fxSystemTransactionJournals.failureDimension,
      sealedJournalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionJournals.sealedJournalBytes})
      `,
      sealedJournalSha256:
        fxSystemTransactionJournals.sealedJournalSha256,
      sealedResultValueCodecVersion:
        fxSystemTransactionJournals.sealedResultValueCodecVersion,
      sealedResultSemanticBytes:
        fxSystemTransactionJournals.sealedResultSemanticBytes,
      sealedResultByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionJournals.sealedResultBytes})
      `,
      sealedResultSha256:
        fxSystemTransactionJournals.sealedResultSha256,
      sealedAt: fxSystemTransactionJournals.sealedAt,
      createdAt: fxSystemTransactionJournals.createdAt,
      updatedAt: fxSystemTransactionJournals.updatedAt,
    })
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(
        fxSystemTransactionJournals.scopeUuid,
        command.sealIdentity.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournals.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournals.attemptFence,
        command.authorityPins.attemptFence,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockJournalRoot", query, options);
  const rows = await sqlCall("lockJournalRoot", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length !== 1) {
      return yield* Result.fail(
        corruption("journalRootMissingOrDuplicate"),
      );
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(
        corruption("journalRootMissingOrDuplicate"),
      );
    }
    const expected = command.sealIdentity;
    const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
    const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
    const sealedAtMilliseconds = finiteDateMilliseconds(row.sealedAt);
    if (
      row.scopeUuid !== expected.scopeUuid ||
      row.sessionId !== command.authorityPins.sessionId ||
      row.attemptFence !== command.authorityPins.attemptFence ||
      row.state !== "sealed" ||
      row.failureDimension !== null ||
      row.sealedJournalByteLength === null ||
      row.sealedJournalSha256 === null ||
      row.sealedResultValueCodecVersion === null ||
      row.sealedResultSemanticBytes === null ||
      row.sealedResultByteLength === null ||
      row.sealedResultSha256 === null ||
      row.sealedAt === null ||
      row.lastSyscallSequence !== expected.finalSyscallSequence ||
      row.creationTimeSeed !== expected.creationTimeSeed ||
      row.nextCreationTime !== expected.nextCreationTime ||
      row.readDocuments !== expected.readDocuments ||
      row.readSemanticBytes !== expected.readSemanticBytes ||
      row.pointDependencyCount !== expected.pointDependencyCount ||
      row.indexedQuerySyscalls !== expected.indexedQuerySyscalls ||
      row.indexRangeDependencyCount !==
        expected.indexRangeDependencyCount ||
      row.indexRangeDependencyEvidenceBytes !==
        expected.indexRangeDependencyEvidenceBytes ||
      row.relationReadSyscalls !== expected.relationReadSyscalls ||
      row.relationDependencyCount !== expected.relationDependencyCount ||
      row.relationBaseOccurrences !== expected.relationBaseOccurrences ||
      row.writeOperations !== expected.writeOperations ||
      row.writeSemanticBytes !== expected.writeSemanticBytes ||
      row.materialWriteEventEvidenceBytes !==
        expected.materialWriteEventEvidenceBytes ||
      row.receiptEvidenceBytes !== expected.receiptEvidenceBytes ||
      row.participantWorkBytes !== expected.participantWorkBytes ||
      row.participantWorkCalls !== expected.participantWorkCalls ||
      row.sealedJournalByteLength !== expected.journalByteLength ||
      !bytesEqual(row.sealedJournalSha256, expected.journalSha256) ||
      row.sealedResultValueCodecVersion !== expected.resultValueCodecVersion ||
      row.sealedResultSemanticBytes !== expected.resultSemanticBytes ||
      row.sealedResultByteLength !== expected.resultByteLength ||
      !bytesEqual(row.sealedResultSha256, expected.resultSha256) ||
      createdAtMilliseconds === undefined ||
      updatedAtMilliseconds === undefined ||
      sealedAtMilliseconds === undefined ||
      createdAtMilliseconds !== expected.rootCreatedAtMilliseconds ||
      updatedAtMilliseconds !== expected.rootUpdatedAtMilliseconds ||
      sealedAtMilliseconds !== expected.sealedAtMilliseconds
    ) {
      return yield* Result.fail(corruption("journalRootInvalid"));
    }
    return row.executionProfile;
  }));
}

export function requireAttemptIsLiveResult(
  session: LockedPointCommitSessionV1,
  lease: Pick<LockedPointCommitLeaseV1, "expiresAtMilliseconds">,
  databaseNowMilliseconds: number,
): Result.Result<void, PointCommitStaleAuthorityV1Error> {
  if (
    session.authorizationGrantExpiresAtMilliseconds <=
      databaseNowMilliseconds ||
    session.hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    lease.expiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    return Result.fail(stale("expired"));
  }
  return Result.succeed(undefined);
}

/** Cold replacement authenticates the sealed contract before inspecting lease
 * presence. Its exact journal also owns conflict reproduction below. */
export async function readSealedPointCommitJournal(
  tx: AppRowTransaction, command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<SessionJournal> {
  const query = tx.select({ sealedJournalBytes: fxSystemTransactionJournals.sealedJournalBytes })
    .from(fxSystemTransactionJournals).where(and(
      eq(fxSystemTransactionJournals.scopeUuid, command.sealIdentity.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, command.authorityPins.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, command.authorityPins.attemptFence),
    )).limit(2);
  observeDrizzleQuery("lockJournalRoot", query, options);
  const rows = await sqlCall("lockJournalRoot", () => query);
  const bytes = rows[0]?.sealedJournalBytes;
  if (rows.length !== 1 || !isUint8ArrayWithByteLength(bytes, command.sealIdentity.journalByteLength))
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - corrupt sealed journal rows refuse before replacement through the typed Promise rollback adapter
    throw corruption("occEvidenceInvalid");
  const sealed = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    decodeCanonicalSessionJournalEffect({ canonicalBytes: bytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(command.sealIdentity.journalSha256) })
      .pipe(Effect.mapError(() => corruption("occEvidenceInvalid")))));
  return sealed.journal;
}

export function preliminaryAuthorityFailure(
  command: PreparedPointCommitAuthorityCommandV1,
  preliminary: TrustedScopeAuthority,
): PointCommitStaleAuthorityV1Error | null {
  const pins = command.authorityPins;
  if (
    preliminary.deploymentId !== pins.deploymentId ||
    preliminary.scopeId !== pins.scopeId
  ) {
    return stale("scopeChanged");
  }
  if (
    preliminary.storageGeneration !== pins.storageGeneration ||
    preliminary.storageGenerationFence !== pins.storageGenerationFence
  ) {
    return stale("generationChanged");
  }
  if (preliminary.epoch !== pins.snapshotToken.epoch) {
    return stale("epochChanged");
  }
  return null;
}
