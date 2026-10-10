import { fxSystemApplicationFunctionsV1 } from "../../database/schema";
import {
  applyFiniteMetadataActivationProjection,
  inspectFiniteMetadataProjection,
  mergeFiniteMetadataProjections,
} from "../../execution/finiteMetadataDependencies";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import {
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import { prepareLogicalStorageMetadataProjection } from "../../storage/catalog/logicalStorageReadiness";
import { AppRowReadPersistenceError, type AppRowTransaction } from "../../storage/documents/appRows";
import {
  loadRelatedPublishedPhysicalRequirementSnapshotV1,
  type ReadRelatedPublishedPhysicalRequirements,
} from "../../storage/indexes/indexBuildReconciliation";
import { readIndexCoverageContextInTransactionEffect } from "../../storage/indexes/indexBuildStates";
import { replaceActiveIndexMaintenanceInTransactionEffect } from "../../storage/indexes/indexMaintenance";
import { IndexMaintenanceError, UniqueMaintenanceError } from "../../storage/indexes/indexMaintenanceModel";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  type ReadUniqueMaintenanceRequirements,
  replaceActiveUniqueMaintenanceInTransactionEffect,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import {
  applicationActivationFrame,
  applicationActivationRequestFrame,
  applicationActiveHeadFrame,
} from "../applicationActivationFrames";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../applicationActivationSchema";
import type { ApplicationWriteOwnershipError } from "../ownership/Model";
import { ApplicationWriteOwnershipHistoryBudget } from "../ownership/Policy";
import { fxSystemApplicationWriteOwnership } from "../ownership/Schema";
import {
  readApplicationActivationUniqueRequirements,
  validateApplicationReadinessForActivationInTransaction,
} from "../readiness/acceptance";
import type {
  ApplicationReadinessActivationBasis,
  ApplicationReadinessResult,
  PreparedApplicationReadinessActivation,
} from "../readiness/contracts";
import {
  type ApplicationActivationCatalogLease,
  type ApplicationRelationReadinessActivationBasis,
  type ApplicationRelationReadinessFoldRepository,
  type ApplicationRelationReadinessFoldResult,
  type PreparedApplicationRelationReadinessActivation,
  readApplicationActivationRelatedPhysicalRequirements,
  readApplicationRelationActivationUniqueRequirements,
  readApplicationRelationOwnershipInTransaction,
  validateApplicationRelationReadinessForActivationInTransaction,
} from "../relations/applicationRelationReadinessFold";
import { fxSystemApplicationFunctions } from "../relations/applicationRelationSchema";
import { invalidateAcceptedApplicationBindingInTransaction } from "./acceptedBinding";
import {
  activationMatchesValidated,
  activationReadinessCommitment,
  activationReceipt,
  type CanonicalActivationFrame,
  canonicalActivationRequest,
  canonicalFrame,
  decodedReadinessCommitment,
  expectedMatchesHead,
  headMatchesValidatedReadiness,
} from "./capture";
import type {
  ApplicationActivationContext,
  ApplicationRelationActivationContext,
} from "./constructionContracts";
import type { ApplicationActivationReceipt, ApplicationActiveCasToken } from "./contracts";
import {
  databaseTime,
  query,
  retryableCause,
  runFault,
  runLocatedTransaction,
} from "./databaseBoundary";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import { decodeActivation, type DecodedActivation, decodeHead } from "./headCapture";
import { MAX_SEQUENCE } from "./limits";
import { prepareApplicationExecutionMetadataProjection } from "./metadataProjection";
import { publishStandaloneBindingInTransaction } from "./readBindingPublication";
import { clockMatches } from "./selectionIdentity";
import { bytesEqualFullScan, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Effect, Encoding, Result } from "effect";

export const tryReplayStoredActivation = Effect.fn("ApplicationActivation.tryReplayStored")(
  (target: LocatedReadCommittedAttemptTargetV1, authority: TrustedScopeAuthority,
    revisionId: string, expected: ApplicationActiveCasToken | null, readinessKind?: DecodedActivation["readinessKind"]) =>
    runLocatedTransaction(target, "activate", revisionId, tx => Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, authority.scopeId);
      if (!clockMatches(authority, clock)) return yield* activationFailure("activate", "scopeAuthority", revisionId);
      if (expected?.activationSequence === MAX_SEQUENCE) return null;
      const sequence = expected === null ? 1n : expected.activationSequence + 1n;
      const rows = yield* query(tx.select().from(fxSystemApplicationActivations).where(and(
        eq(fxSystemApplicationActivations.scopeId, authority.scopeId),
        eq(fxSystemApplicationActivations.activationSequence, sequence),
        eq(fxSystemApplicationActivations.revisionId, revisionId),
      )).limit(1).for("share"), "activate", revisionId);
      const row = rows[0];
      if (row === undefined) return null;
      const decoded = yield* decodeActivation(row, "activate", revisionId);
      if (decoded.scopeId !== authority.scopeId || decoded.revisionId !== revisionId ||
        decoded.activationSequence !== sequence || decoded.previousActivationSequence !== (expected?.activationSequence ?? null) ||
        (readinessKind !== undefined && decoded.readinessKind !== readinessKind))
        return yield* activationFailure("activate", "storedState", revisionId);
      const request = yield* canonicalFrame(applicationActivationRequestFrame({
        scopeId: authority.scopeId, revisionId, readiness: decodedReadinessCommitment(decoded),
        expectedActiveHead: expected === null ? null : { activationSequence: expected.activationSequence.toString(), headSha256: expected.headSha256 },
      }), "activate", revisionId);
      if (!bytesEqualFullScan(decoded.activationRequestSha256, request.sha256))
        return yield* activationFailure("activate", "expectedHead", revisionId);
      return yield* activationReceipt("replayed", row, decoded, request.sha256);
    })),
);

export const activateLegacyInTransaction = Effect.fn(
  "ApplicationActivation.activateLegacyTransaction",
)(
function* (
  tx: AppRowTransaction,
  target: LocatedReadCommittedAttemptTargetV1,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ApplicationActivationContext<unknown, unknown>["faultAfter"],
  activationPreparation: PreparedApplicationReadinessActivation,
) {
  invalidateAcceptedApplicationBindingInTransaction(tx);
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      readiness.status === "ready" ? readiness.revisionId : undefined,
    );
  }
  const validated = yield* validateApplicationReadinessForActivationInTransaction(
    readinessRepository,
    readiness,
    tx,
    clock,
    activationPreparation,
  );
  if (validated.status !== "ready") {
    return yield* activationFailure(
      "activate",
      "notReady",
      validated.revisionId,
    );
  }
  return yield* persistActivationInTransaction(
    tx,
    schemaVersionId => loadRelatedPublishedPhysicalRequirementSnapshotV1(validated.basis.physicalRequirements, schemaVersionId, target, tx),
    schemaVersionId => readApplicationActivationUniqueRequirements(readinessRepository, readiness, schemaVersionId, target, tx),
    Object.freeze({ kind: "legacy", basis: validated.basis }),
    clock,
    expected,
    faultAfter,
  );
});

export const activateRelationInTransaction = Effect.fn(
  "ApplicationActivation.activateRelationTransaction",
)(function* (
  tx: AppRowTransaction,
  target: LocatedReadCommittedAttemptTargetV1,
  authority: TrustedScopeAuthority,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ApplicationRelationActivationContext<unknown, unknown>[
    "faultAfter"
  ],
  catalogLease: ApplicationActivationCatalogLease | undefined,
  activationPreparation: PreparedApplicationRelationReadinessActivation,
) {
  invalidateAcceptedApplicationBindingInTransaction(tx);
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      readiness.revisionId,
    );
  }
  const validated = yield*
    validateApplicationRelationReadinessForActivationInTransaction(
      readinessRepository,
      readiness,
      tx,
      clock,
      catalogLease,
      activationPreparation,
    );
  if (validated.status !== "ready") {
    return yield* activationFailure(
      "activate",
      "notReady",
      validated.revisionId,
    );
  }
  return yield* persistActivationInTransaction(
    tx,
    schemaVersionId => readApplicationActivationRelatedPhysicalRequirements(readinessRepository, readiness, schemaVersionId, target, tx, catalogLease),
    schemaVersionId => readApplicationRelationActivationUniqueRequirements(readinessRepository, readiness, schemaVersionId, target, tx, catalogLease),
    Object.freeze({ kind: "relation", basis: validated.basis }),
    clock,
    expected,
    faultAfter,
    budget => readApplicationRelationOwnershipInTransaction(readinessRepository, tx, authority.scopeId, budget, catalogLease, target),
  );
});

export type ValidatedActivation =
  | Readonly<{
      readonly kind: "legacy";
      readonly basis: ApplicationReadinessActivationBasis;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly basis: ApplicationRelationReadinessActivationBasis;
    }>;

export type ActivationFault = NonNullable<
  | ApplicationActivationContext<unknown, unknown>["faultAfter"]
  | ApplicationRelationActivationContext<unknown, unknown>["faultAfter"]
>;

export const replayCanonicalActivationRequestInTransaction = Effect.fn(
  "ApplicationActivation.replayCanonicalRequest",
)(function* (
  tx: AppRowTransaction,
  validated: ValidatedActivation,
  request: CanonicalActivationFrame,
): Effect.fn.Return<
  ApplicationActivationReceipt | null,
  ApplicationActivationError
> {
  const basis = validated.basis;
  const replayRows = yield* query(
    tx.select().from(fxSystemApplicationActivations).where(and(
      eq(
        fxSystemApplicationActivations.scopeId,
        basis.authority.scopeId,
      ),
      eq(
        fxSystemApplicationActivations.activationRequestSha256,
        request.sha256,
      ),
    )).limit(1).for("share"),
    "activate",
    basis.revisionId,
  );
  const replay = replayRows[0];
  if (replay === undefined) return null;
  const decoded = yield* decodeActivation(replay, "activate", basis.revisionId);
  if (!activationMatchesValidated(decoded, validated) ||
    !bytesEqualFullScan(decoded.activationRequestSha256, request.sha256)) {
    return yield* activationFailure(
      "activate",
      "storedState",
      basis.revisionId,
    );
  }
  return yield* activationReceipt("replayed", replay, decoded, request.sha256);
});

export const persistActivationInTransaction = Effect.fn(
  "ApplicationActivation.persistTransaction",
)(function* (
  tx: AppRowTransaction,
  readRelatedRequirements: ReadRelatedPublishedPhysicalRequirements,
  readUniqueRequirements: ReadUniqueMaintenanceRequirements,
  validated: ValidatedActivation,
  clock: ScopeClockRecord,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ActivationFault | undefined,
  recoverOwnership?: (budget: ApplicationWriteOwnershipHistoryBudget) => Effect.Effect<unknown, ApplicationWriteOwnershipError>,
) {
  const basis = validated.basis;
  const authority = basis.authority;
  const readiness = activationReadinessCommitment(validated);
  const headRows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeads).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      authority.scopeId,
    )).limit(1).for("update"),
    "activate",
    basis.revisionId,
  );
  const headRow = headRows[0];
  const head = headRow === undefined
    ? null
    : yield* decodeHead(headRow, "activate", basis.revisionId);
  const request = yield* canonicalActivationRequest(validated, expected);
  const replay = yield* replayCanonicalActivationRequestInTransaction(
    tx,
    validated,
    request,
  );
  if (replay !== null) return replay;
  if (head !== null && headMatchesValidatedReadiness(head, validated)) {
    return yield* activationFailure("activate", "alreadyActive", basis.revisionId);
  }
  if (!expectedMatchesHead(expected, head)) {
    return yield* activationFailure("activate", "expectedHead", basis.revisionId);
  }
  const metadataProjection = yield* Effect.gen(function* () {
    const execution = yield* prepareApplicationExecutionMetadataProjection(basis);
    const unique = basis.physicalRequirements.logicalRequirements === undefined ? null :
      yield* readUniqueRequirements(basis.schemaVersionId);
    const logical = yield* prepareLogicalStorageMetadataProjection(
      { deploymentId: basis.deploymentId, schemaVersionId: basis.schemaVersionId, profile: "nativeApplication" }, basis.physicalRequirements, unique?.members ?? []);
    return yield* Effect.fromResult(mergeFiniteMetadataProjections(logical === null ? [execution] : [execution, logical]));
  }).pipe(Effect.mapError(cause => activationError("activate", "storedState", basis.revisionId, false, cause)));
  const metadataOwners = [...(inspectFiniteMetadataProjection(metadataProjection)?.owners ?? [])];
  let withdrawsPermission = false;
  if (head !== null) {
    const previousFunctions = head.readinessKind === "legacy"
      ? yield* query(tx.select({ path: fxSystemApplicationFunctionsV1.functionPath, kind: fxSystemApplicationFunctionsV1.functionKind,
        visibility: fxSystemApplicationFunctionsV1.visibility }).from(fxSystemApplicationFunctionsV1).where(and(
        eq(fxSystemApplicationFunctionsV1.scopeId, authority.scopeId), eq(fxSystemApplicationFunctionsV1.revisionId, head.revisionId))).limit(1_025), "activate", basis.revisionId)
      : yield* query(tx.select({ path: fxSystemApplicationFunctions.functionPath, kind: fxSystemApplicationFunctions.functionKind,
        visibility: fxSystemApplicationFunctions.visibility }).from(fxSystemApplicationFunctions).where(and(
        eq(fxSystemApplicationFunctions.scopeId, authority.scopeId), eq(fxSystemApplicationFunctions.revisionId, head.revisionId))).limit(1_025), "activate", basis.revisionId);
    if (previousFunctions.length > 1_024) return yield* activationFailure("activate", "storedState", basis.revisionId);
    withdrawsPermission = previousFunctions.some(previous => {
      const next = basis.manifest.functions.find(fn => fn.path === previous.path);
      return next === undefined || next.kind !== previous.kind || (previous.visibility === "public" && next.visibility !== "public");
    });
    const previousContext = yield* readIndexCoverageContextInTransactionEffect(tx, clock).pipe(
      Effect.mapError(cause => activationError("activate", "storedState", basis.revisionId, false, cause)));
    if (previousContext.active === null) return yield* activationFailure("activate", "storedState", basis.revisionId);
    const previousRequirements = yield* readRelatedRequirements(previousContext.active.schema.schemaVersionId).pipe(
      Effect.mapError(cause => activationError("activate", "storedState", basis.revisionId, false, cause)));
    if (previousRequirements === null) return yield* activationFailure("activate", "storedState", basis.revisionId);
    for (const previous of previousRequirements.logicalRequirements?.evidence.candidate.sources ?? []) {
      if (previous.owner !== "application") continue;
      const owner = { namespace: "application" as const, ownerKey: previous.key };
      if (!metadataOwners.some(member => member.namespace === owner.namespace && member.ownerKey === owner.ownerKey)) metadataOwners.push(owner);
      const next = basis.physicalRequirements.logicalRequirements?.evidence.candidate.sources.find(source => source.key === previous.key && source.owner === previous.owner);
      if (next === undefined || next.writeProfile !== previous.writeProfile) withdrawsPermission = true;
    }
  }
  if (withdrawsPermission) yield* advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, authority.scopeId).pipe(
    Effect.mapError(cause => activationError("activate", "resourceFailure", basis.revisionId, false, cause)));
  yield* applyFiniteMetadataActivationProjection(tx, authority.scopeId, metadataProjection, metadataOwners).pipe(
    Effect.mapError(cause => activationError("activate", "storedState", basis.revisionId, false, cause)));
  const previousActivationSequence = head?.activationSequence ?? null;
  if (previousActivationSequence === MAX_SEQUENCE) {
    return yield* activationFailure("activate", "storedState", basis.revisionId);
  }
  const activationSequence = previousActivationSequence === null
    ? 1n
    : previousActivationSequence + 1n;
  const ownership = validated.kind === "relation" ? validated.basis.writeOwnership : null;
  const writePolicySetSha256 = ownership === null ? null : yield* Effect.fromResult(
    Encoding.decodeHex(ownership.frame.writePolicySetSha256).pipe(Result.mapError(cause =>
      activationError("activate", "storedState", basis.revisionId, false, cause))));
  if (ownership === null) {
    const retained = yield* query(tx.select({ sequence: fxSystemApplicationWriteOwnership.activationSequence })
      .from(fxSystemApplicationWriteOwnership).where(eq(fxSystemApplicationWriteOwnership.scopeId, authority.scopeId)).limit(1),
      "activate", basis.revisionId);
    if (head?.readinessContractVersion === 3 || retained.length !== 0) {
      return yield* activationFailure("activate", "notReady", basis.revisionId);
    }
  } else if (ownership.frame.scopeId !== authority.scopeId || ownership.frame.revisionId !== basis.revisionId ||
    ownership.frame.activationSequence !== activationSequence.toString() ||
    (ownership.frame.predecessor === null ? head?.readinessContractVersion === 3 :
      head?.activationSequence.toString() !== ownership.frame.predecessor.activationSequence ||
      head.writeOwnershipSha256 !== ownership.frame.predecessor.claimsSha256)) {
    return yield* activationFailure("activate", "expectedHead", basis.revisionId);
  }
  const activatedAt = yield* databaseTime(
    tx,
    authority.scopeId,
    "activate",
    basis.revisionId,
  );
  const activation = yield* canonicalFrame(applicationActivationFrame({
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    previousActivationSequence: previousActivationSequence?.toString() ?? null,
    revisionId: basis.revisionId,
    readiness,
    activationRequestSha256: encodeBytesToLowercaseHex(request.sha256),
    activatedAt: activatedAt.toISOString(),
  }), "activate", basis.revisionId);
  yield* query(
    tx.insert(fxSystemApplicationActivations).values({
      scopeId: authority.scopeId,
      activationSequence,
      previousActivationSequence,
      revisionId: basis.revisionId,
      readinessContractVersion: readiness.contractVersion,
      writePolicySetSha256: writePolicySetSha256,
      writeOwnershipSha256: ownership?.sha256 ?? null,
      readinessSha256: copyBytes(basis.readinessSha256),
      legacyReadinessSha256: validated.kind === "legacy"
        ? copyBytes(basis.readinessSha256)
        : null,
      relationReadinessSha256: validated.kind === "relation"
        ? copyBytes(basis.readinessSha256)
        : null,
      relationSetReadinessSha256: validated.kind === "relation"
        ? copyBytes(validated.basis.relationSetReadinessSha256)
        : null,
      relationCount: validated.kind === "relation"
        ? validated.basis.relationCount
        : null,
      activationRequestSha256: copyBytes(request.sha256),
      activationSha256: copyBytes(activation.sha256),
      activationBytes: copyBytes(activation.bytes),
      activatedAt,
    }).returning({
      activationSequence: fxSystemApplicationActivations.activationSequence,
    }),
    "activate",
    basis.revisionId,
  );
  yield* runFault(faultAfter, "activationInserted", basis.revisionId);
  if (ownership !== null) {
    yield* query(tx.insert(fxSystemApplicationWriteOwnership).values({ scopeId: authority.scopeId, activationSequence,
      claimsSha256: ownership.sha256, claimsBytes: ownership.canonicalBytes }).returning({
      sequence: fxSystemApplicationWriteOwnership.activationSequence }), "activate", basis.revisionId);
  }
  const nextHead = yield* canonicalFrame(applicationActiveHeadFrame({
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    revisionId: basis.revisionId,
    readiness,
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
  }), "activate", basis.revisionId);
  yield* replaceActiveIndexMaintenanceInTransactionEffect(tx, readRelatedRequirements, clock, basis.physicalRequirements, activationSequence, activation.sha256, nextHead.sha256)
    .pipe(Effect.mapError(cause => {
      const resource = cause instanceof AppRowReadPersistenceError ||
        (cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure");
      return activationError("activate", resource ? "resourceFailure" : "storedState", basis.revisionId,
        resource && (cause instanceof IndexMaintenanceError ? (cause.retryable ?? retryableCause(cause.cause)) : retryableCause(cause.cause)), cause);
    }));
  yield* runFault(faultAfter, "indexMaintenanceWritten", basis.revisionId);
  yield* replaceActiveUniqueMaintenanceInTransactionEffect(tx, clock, readUniqueRequirements,
    basis.deploymentId, basis.schemaVersionId, activationSequence, activation.sha256, nextHead.sha256)
    .pipe(Effect.mapError(cause => {
      const resource = cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error ||
        ((cause instanceof UniqueMaintenanceError || cause instanceof IndexMaintenanceError) && cause.reason === "resourceFailure");
      return activationError("activate", resource ? "resourceFailure" : "storedState", basis.revisionId,
        resource && ((cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error || cause instanceof UniqueMaintenanceError ||
          cause instanceof IndexMaintenanceError) ? (cause.retryable ?? false) : false), cause);
    }));
  yield* runFault(faultAfter, "uniqueMaintenanceWritten", basis.revisionId);
  if (head === null) {
    const inserted = yield* query(
      tx.insert(fxSystemApplicationActiveHeads).values({
        scopeId: authority.scopeId,
        activationSequence,
        revisionId: basis.revisionId,
        readinessContractVersion: readiness.contractVersion,
        writePolicySetSha256: writePolicySetSha256,
        writeOwnershipSha256: ownership?.sha256 ?? null,
        readinessSha256: copyBytes(basis.readinessSha256),
        relationSetReadinessSha256: validated.kind === "relation"
          ? copyBytes(validated.basis.relationSetReadinessSha256)
          : null,
        relationCount: validated.kind === "relation"
          ? validated.basis.relationCount
          : null,
        activationSha256: copyBytes(activation.sha256),
        headSha256: copyBytes(nextHead.sha256),
        headBytes: copyBytes(nextHead.bytes),
        createdAt: activatedAt,
        updatedAt: activatedAt,
      }).onConflictDoNothing().returning({
        activationSequence: fxSystemApplicationActiveHeads.activationSequence,
      }),
      "activate",
      basis.revisionId,
    );
    if (inserted.length !== 1) {
      return yield* activationFailure(
        "activate",
        "concurrentHead",
        basis.revisionId,
      );
    }
  } else {
    const updated = yield* query(
      tx.update(fxSystemApplicationActiveHeads).set({
        activationSequence,
        revisionId: basis.revisionId,
        readinessContractVersion: readiness.contractVersion,
        writePolicySetSha256: writePolicySetSha256,
        writeOwnershipSha256: ownership?.sha256 ?? null,
        readinessSha256: copyBytes(basis.readinessSha256),
        relationSetReadinessSha256: validated.kind === "relation"
          ? copyBytes(validated.basis.relationSetReadinessSha256)
          : null,
        relationCount: validated.kind === "relation"
          ? validated.basis.relationCount
          : null,
        activationSha256: copyBytes(activation.sha256),
        headSha256: copyBytes(nextHead.sha256),
        headBytes: copyBytes(nextHead.bytes),
        updatedAt: activatedAt,
      }).where(and(
        eq(fxSystemApplicationActiveHeads.scopeId, authority.scopeId),
        eq(
          fxSystemApplicationActiveHeads.activationSequence,
          head.activationSequence,
        ),
        eq(fxSystemApplicationActiveHeads.headSha256, head.headSha256),
      )).returning({
        activationSequence: fxSystemApplicationActiveHeads.activationSequence,
      }),
      "activate",
      basis.revisionId,
    );
    if (updated.length !== 1) {
      return yield* activationFailure(
        "activate",
        "concurrentHead",
        basis.revisionId,
      );
    }
  }
  if (ownership !== null) {
    // A newly installed head must remain cold-readable and replayable within the
    // same aggregate limit. Failure rolls back both the claim and head writes.
    const recoveryBudget = new ApplicationWriteOwnershipHistoryBudget();
    if (recoverOwnership === undefined) return yield* activationFailure("activate", "notReady", basis.revisionId);
    yield* recoverOwnership(recoveryBudget).pipe(Effect.mapError(cause =>
      activationError("activate", "notReady", basis.revisionId, false, cause)));
  }
  yield* publishStandaloneBindingInTransaction(tx, validated, activationSequence, activation.sha256, nextHead.sha256);
  yield* runFault(faultAfter, "headWritten", basis.revisionId);
  return Object.freeze({
    status: "activated",
    disposition: "inserted",
    scopeId: authority.scopeId,
    revisionId: basis.revisionId,
    activationSequence,
    previousActivationSequence,
    readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
    activationRequestSha256: encodeBytesToLowercaseHex(request.sha256),
    expectedActiveHead: Object.freeze({
      activationSequence,
      headSha256: encodeBytesToLowercaseHex(nextHead.sha256),
    }),
    activatedAt: new Date(activatedAt.getTime()),
  } as const);
});
