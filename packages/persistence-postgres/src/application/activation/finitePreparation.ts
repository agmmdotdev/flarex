import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../../commit/authority/postgresLoader";
import { observeExecution } from "../../execution/diagnostics/operation";
import type { FiniteEntryObservation } from "../../execution/finiteEntryObservation";
import {
  type OriginalFiniteExecutionEntry,
  readOriginalFiniteExecutionAuthority,
} from "../../execution/journal/finiteEntry";
import {
  acquireProtectedMetadataInstallationAdmission,
  authenticateProtectedReadinessMetadataPair,
} from "../../execution/preparation/preparedMetadataEpoch";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../scope/scopeAuthorityResolution";
import { lockScopeClockForSnapshotReadInTransactionEffect, type ScopeClockRecord } from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { CheckedApplicationActiveHead } from "../activeHead/contracts";
import { releaseCheckedApplicationActiveHead } from "../activeHead/identity";
import {
  readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect,
} from "../applicationActiveHeadRead";
import { deriveFiniteApplicationReadiness } from "../readiness/preparation";
import { withValidatedApplicationBindingBasisInTransaction } from "./bindingAcceptance";
import { installBindingHeadPreparation, lendApplicationBindingPreparationInputs, makeCompositeBindingPreparationReader,
  type makeActivePreparationReader } from "./bindingPreparation";
import type { ApplicationActivationContext, ApplicationRelationActivationContext } from "./constructionContracts";
import type {
  AcceptedApplicationBinding,
  ApplicationActivationRepository,
  ApplicationActiveSelection,
  ApplicationRelationActivationRepository,
  ApplicationExecutableActiveSelection,
  ApplicationBindingInput,
  CurrentApplicationFiniteEntry,
  PreparedFiniteActiveApplication,
} from "./contracts";
import { authenticateCurrentApplicationFiniteEntry } from "./currentEntryIdentity";
import { runLocatedTransaction } from "./databaseBoundary";
import { headMatchesValidatedReadiness } from "./capture";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import {
  issueFiniteActiveApplicationPreparation,
  readFiniteActiveApplicationPreparationState,
} from "./finiteIdentity";
import { prepareFiniteApplicationMetadataProjections, prepareCompositeFiniteApplicationMetadataProjections } from "./metadataProjection";
import { captureHostPreparationLifetime, chargeHostPreparation } from "../../execution/preparation/preparedHostRuntime";
import { readApplicationReadinessControlDatabase } from "../readiness/identity";
import { lendResolvedApplicationRelationManifestBinding } from "../relations/applicationRelationSchemaAuthority";
import { acceptPreparedApplicationRelationActiveRead,
  hasPreparedApplicationRelationReadRepository } from "../relations/applicationRelationReadinessFold";
import { getSchemaVersionArtifactWithOriginalByIdEffect } from "../../storage/catalog/schemaVersionArtifacts";
import { closeInstallationAdmission } from "../../installation/installationLifecycle";
import { MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 } from "../../commit/authority/model";
import {
  attachFiniteApplicationSelectionPreparation,
  attachRelationFiniteLifetime,
  clockMatches,
  copyRelationSelectionBasis,
  issueLegacyActiveSelection,
  issueRelationActiveSelection,
  readApplicationBindingHeadPreparation,
  readApplicationBindingTargetProtection,
  readLegacyApplicationBindingPreparation,
  readRelationApplicationBindingPreparation,
  sameTrustedAuthority,
  readOriginalCurrentApplicationGenerationProtection,
} from "./selectionIdentity";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Cause, Effect, Result } from "effect";

export const withPreparedFiniteActiveApplicationOwned = Effect.fnUntraced(function* <Value, Failure, Requirements>(prepared: PreparedFiniteActiveApplication, tx: AppRowTransaction,
  clock: ScopeClockRecord,
  work: (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: ApplicationExecutableActiveSelection["basis"] }>,
    binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  finiteEntry: FiniteEntryObservation | undefined, currentEntry: CurrentApplicationFiniteEntry | undefined,
  phase: "initial" | "replacement") {
  const state = readFiniteActiveApplicationPreparationState(prepared);
  if (state === undefined) return yield* activationFailure("validateSelection", "invalidComposition");
  yield* Effect.fromResult((state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", undefined, false, cause))));
  let checked: CheckedApplicationActiveHead | undefined;
  if (phase === "initial" && (state.originalGenerationBinding !== undefined || currentEntry !== undefined)) {
    return yield* Effect.gen(function* () {
    if (state.originalGenerationBinding === undefined || currentEntry === undefined || finiteEntry === undefined)
      return yield* activationFailure("validateSelection", "invalidComposition");
    const entry = yield* Effect.fromResult(authenticateCurrentApplicationFiniteEntry(currentEntry,
      state.originalGenerationBinding));
    const original = readLegacyApplicationBindingPreparation(state.originalGenerationBinding);
    const relation = readRelationApplicationBindingPreparation(state.originalGenerationBinding);
    const authority = original?.basis.authority ?? relation?.authority;
    if (authority === undefined || !clockMatches(authority, clock))
      return yield* activationFailure("validateSelection", "scopeAuthority");
    const retained = original?.currentPreparation ?? relation?.currentPreparation;
    const pair = retained === undefined ? Result.succeed(undefined) :
      authenticateProtectedReadinessMetadataPair(tx, retained.target, retained.control);
    const changedEpoch = yield* Result.match(pair, {
      onSuccess: () => Effect.succeed(false),
      onFailure: failure => failure.reason === "changed" ? Effect.succeed(true) : Effect.fail(failure),
    });
    // A changed anchor cannot lend its old structure, but a refresh still
    // requires a genuine coherent native head before discarding this graph.
    const observed = yield* readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock,
      issued => { checked = issued; }, changedEpoch ? undefined : readApplicationBindingHeadPreparation(state.selection), finiteEntry);
    if (observed === null) return yield* activationFailure("validateSelection", "concurrentHead", original?.basis.revisionId ?? relation?.revisionId);
    return yield* entry.check(tx, clock, observed.checked, finiteEntry, changedEpoch).pipe(Effect.andThen(
      withValidatedApplicationBindingBasisInTransaction(state.selection, tx, clock,
        (validated, _checked, binding): Effect.Effect<Value, Failure | ApplicationActivationError, Requirements> => validated.kind !== state.kind
          ? activationFailure("validateSelection", "invalidComposition")
          : work(Object.freeze({ selection: state.selection, basis: validated.basis }), binding), observed.checked)));
    }).pipe(Effect.ensuring(Effect.sync(() => releaseCheckedApplicationActiveHead(checked))));
  }
  return yield* withValidatedApplicationBindingBasisInTransaction(state.selection, tx, clock,
    (validated, _checked, binding) => Effect.gen(function* () {
      return yield* work(Object.freeze({ selection: state.selection, basis: validated.basis }), binding);
    }), undefined, finiteEntry);
}, work => observeExecution("ApplicationActivation.withPreparedFiniteActive", work));

export function withPreparedFiniteActiveApplicationInTransaction<Value, Failure, Requirements>(
  prepared: PreparedFiniteActiveApplication, tx: AppRowTransaction, clock: ScopeClockRecord,
  work: (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: ApplicationExecutableActiveSelection["basis"] }>,
    binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  finiteEntry?: FiniteEntryObservation, currentEntry?: CurrentApplicationFiniteEntry) {
  return withPreparedFiniteActiveApplicationOwned(prepared, tx, clock, work, finiteEntry, currentEntry, "initial");
}

export const withPreparedFiniteReplacementApplicationInTransaction = Effect.fnUntraced(function* <Value, Failure, Requirements>(
  prepared: PreparedFiniteActiveApplication, tx: AppRowTransaction, clock: ScopeClockRecord,
  original: OriginalFiniteExecutionEntry, issuer: StoredCommitAuthorityEvidenceLoaderPortsV1,
  work: (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: ApplicationExecutableActiveSelection["basis"] }>,
    binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>) {
  const certificate = readOriginalFiniteExecutionAuthority(original, issuer);
  if (certificate === undefined || certificate.context.anchor.scopeId !== clock.scopeId)
    return yield* activationFailure("validateSelection", "invalidComposition");
  return yield* withPreparedFiniteActiveApplicationOwned(prepared, tx, clock, work, undefined, undefined, "replacement");
});

export function withPreparedRecoveredFiniteApplicationInTransaction<Value, Failure, Requirements>(
  prepared: PreparedFiniteActiveApplication, tx: AppRowTransaction, clock: ScopeClockRecord,
  work: (accepted: Readonly<{ selection: ApplicationActiveSelection; basis: ApplicationExecutableActiveSelection["basis"] }>,
    binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>) {
  return withPreparedFiniteActiveApplicationOwned(prepared, tx, clock, work, undefined, undefined, "replacement");
}

export function makeFiniteActivePreparationReader<SchemaFailure, ColdFailure>(repository: ApplicationActivationRepository<SchemaFailure, ColdFailure>, captured: ApplicationActivationContext<SchemaFailure, ColdFailure>, prepare: ReturnType<typeof makeActivePreparationReader>) {
  return Effect.fn("ApplicationActivation.prepareFiniteActiveOwned")(function* (originalGenerationBinding?: ApplicationBindingInput) {
    const original = originalGenerationBinding === undefined ? undefined : readLegacyApplicationBindingPreparation(originalGenerationBinding);
    if (originalGenerationBinding !== undefined && (original === undefined || original.readinessRepository !== captured.readiness))
      return yield* activationFailure("read", "invalidComposition");
    const originalGenerationProtection = originalGenerationBinding === undefined ? undefined :
      yield* Effect.fromResult(readOriginalCurrentApplicationGenerationProtection(originalGenerationBinding));
    const prepared = original === undefined ? yield* prepare("retained", false, "finiteEntry") :
      yield* deriveFiniteApplicationReadiness(captured.readiness, original.readiness, originalGenerationProtection).pipe(
        Effect.map(derived => Object.freeze({ kind: "legacy" as const, basis: original.basis,
          readinessRepository: captured.readiness, readiness: derived.readiness, schema: derived.schema,
          originalControl: derived.originalControl, lifetime: original.lifetime })));
    if (prepared.kind !== "legacy") return yield* activationFailure("read", "activeMissing");
    if (original !== undefined && (prepared.basis.deploymentId !== original.basis.deploymentId ||
      prepared.basis.authority.scopeId !== original.basis.authority.scopeId ||
      prepared.basis.schemaVersionId !== original.basis.schemaVersionId ||
      prepared.basis.activationSequence !== original.basis.activationSequence ||
      !bytesEqualFullScan(prepared.basis.headSha256, original.basis.headSha256)))
      return yield* activationFailure("read", "concurrentHead");
    const active = yield* issueLegacyActiveSelection({ expectedActiveHead: {
      activationSequence: prepared.basis.activationSequence, headSha256: encodeBytesToLowercaseHex(prepared.basis.headSha256),
    }, basis: prepared.basis }, captured.readiness, prepared.readiness, prepared.lifetime);
    installBindingHeadPreparation(active.selection, prepared);
    const projections = yield* prepareFiniteApplicationMetadataProjections(active.selection, prepared).pipe(Effect.mapError(cause => activationError("read", "storedState", prepared.basis.revisionId, false, cause)));
    yield* Effect.fromResult(attachFiniteApplicationSelectionPreparation(active.selection, projections, original?.currentPreparation));
    return yield* issueFiniteActiveApplicationPreparation(Object.freeze({ kind: "legacy", repository, selection: active.selection,
      schema: prepared.schema, originalControl: prepared.originalControl, lifetime: prepared.lifetime,
      originalGenerationBinding }));
  });
}

/** Bounded composite profile. Genuine V3 readiness and schema evidence remain
 * with their existing issuers; nonempty Application relations stay gated. */
export function makeCompositeFiniteActivePreparationReader<SchemaFailure, ColdFailure>(
  repository: ApplicationRelationActivationRepository<SchemaFailure, ColdFailure>,
  captured: ApplicationRelationActivationContext<SchemaFailure, ColdFailure>,
  prepare: ReturnType<typeof makeActivePreparationReader>,
) {
  return Effect.fn("ApplicationActivation.prepareCompositeFinite")(function* (originalGenerationBinding?: ApplicationBindingInput) {
    const lifetime = yield* captureHostPreparationLifetime();
    if (lifetime === undefined) return yield* activationFailure("read", "invalidComposition");
    const database = yield* Effect.fromResult(readApplicationReadinessControlDatabase(captured.readiness));
    const bindingPreparation = originalGenerationBinding ?? (yield* makeCompositeBindingPreparationReader(captured, prepare)("retained"));
    const borrowed = readRelationApplicationBindingPreparation(bindingPreparation);
    if (borrowed === undefined || borrowed.lifetime?.checkOpen !== lifetime.checkOpen ||
      !hasPreparedApplicationRelationReadRepository(borrowed.readiness, captured.relationReadiness))
      return yield* activationFailure("read", "invalidComposition");
    yield* Effect.fromResult(readApplicationBindingTargetProtection(bindingPreparation));
    const originalGenerationProtection = yield* Effect.fromResult(readOriginalCurrentApplicationGenerationProtection(bindingPreparation));
    const inputs = yield* lendApplicationBindingPreparationInputs(bindingPreparation, database);
    if (inputs.manifest.version !== 3 || inputs.manifest.schema.relations.length !== 0 ||
      inputs.schema.relations.length !== 0 || inputs.schema.edgeDefinitions.length !== 0)
      return yield* activationFailure("read", "invalidComposition");
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(captured, captured.authority);
    if (!sameTrustedAuthority(borrowed.authority, located.authority))
      return yield* activationFailure("read", "concurrentHead");
    // Cold construction restores the exact original readiness through its
    // genuine issuer. It retains no checked head or transaction. The current
    // generation's before/after observations bracket this full canonical proof;
    // retained epoch shortcuts belong only to fresh admitted entry transactions.
    const restored = yield* runLocatedTransaction(located.target, "read", borrowed.revisionId, tx => Effect.gen(function* () {
      if (originalGenerationProtection !== undefined) yield* acquireProtectedMetadataInstallationAdmission(
        originalGenerationProtection.target.token, originalGenerationProtection.target.database, tx).pipe(
          Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
            error => activationError("read", "resourceFailure", borrowed.revisionId, false, error)))));
      const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, borrowed.authority.scopeId);
      if (!clockMatches(borrowed.authority, clock)) return yield* activationFailure("read", "scopeAuthority", borrowed.revisionId);
      return yield* acceptPreparedApplicationRelationActiveRead(borrowed.readiness, tx, clock, undefined, "finitePreparation");
    }).pipe(Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx)))));
    if (!headMatchesValidatedReadiness(borrowed.head, { kind: "relation", basis: restored.basis }) ||
      !sameTrustedAuthority(borrowed.authority, restored.basis.authority) ||
      restored.basis.schemaVersionId !== inputs.schema.schemaVersionId ||
      encodeBytesToLowercaseHex(restored.basis.manifestSha256) !== inputs.schema.applicationManifestSha256)
      return yield* activationFailure("read", "concurrentHead", borrowed.revisionId);
    const basis = copyRelationSelectionBasis({ ...restored.basis, activationSequence: borrowed.head.activationSequence,
      activationSha256: borrowed.head.activationSha256, headSha256: borrowed.head.headSha256 });
    const active = yield* issueRelationActiveSelection({ expectedActiveHead: { activationSequence: basis.activationSequence,
      headSha256: encodeBytesToLowercaseHex(basis.headSha256) }, basis }, captured.relationReadiness, restored.readiness);
    yield* Effect.fromResult(attachRelationFiniteLifetime(active.selection, lifetime));
    const binding = yield* lendResolvedApplicationRelationManifestBinding(inputs.schema, database, {
      deploymentId: captured.deploymentId, applicationManifestSha256: inputs.schema.applicationManifestSha256 });
    const original = yield* getSchemaVersionArtifactWithOriginalByIdEffect(database, captured.deploymentId,
      inputs.schema.schemaVersionId, MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1);
    if (original === null || original.original.payload === null ||
      encodeBytesToLowercaseHex(original.artifact.manifestSha256) !== inputs.schema.schemaManifestSha256)
      return yield* activationFailure("read", "storedState");
    const projections = yield* prepareCompositeFiniteApplicationMetadataProjections(active.selection, basis,
      database, original.original, inputs, binding.relationBinding);
    yield* Effect.fromResult(attachFiniteApplicationSelectionPreparation(active.selection, projections, borrowed.currentPreparation));
    const payload = { basis: { ...basis, physicalRequirements: { ...basis.physicalRequirements },
      writeOwnership: basis.writeOwnership === null ? null : { ...basis.writeOwnership } }, schema: inputs.schema,
      original: { sizes: { ...original.original.sizes, createdAt: original.original.sizes.createdAt.getTime() },
        payload: { ...original.original.payload, createdAt: original.original.payload.createdAt.getTime() } },
      binding: { manifestBinding: { ...binding.manifestBinding }, relationBinding: { ...binding.relationBinding,
        schemaArtifact: { ...binding.relationBinding.schemaArtifact, createdAt: binding.relationBinding.schemaArtifact.createdAt.getTime() } } } };
    for (const [stage, data] of Object.entries(payload)) yield* chargeHostPreparation(data).pipe(
          Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, { stage, cause })));
    return yield* issueFiniteActiveApplicationPreparation(Object.freeze({ kind: "relation", repository,
      selection: active.selection, schema: inputs.schema, database, artifact: original.original, binding,
      lifetime, originalGenerationBinding }));
  });
}
