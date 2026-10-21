import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../../commit/authority/postgresLoader";
import { observeExecution } from "../../execution/diagnostics/operation";
import type { FiniteEntryObservation } from "../../execution/finiteEntryObservation";
import {
  type OriginalFiniteExecutionEntry,
  readOriginalFiniteExecutionAuthority,
} from "../../execution/journal/finiteEntry";
import {
  authenticateProtectedReadinessMetadataPair,
} from "../../execution/preparation/preparedMetadataEpoch";
import type { ScopeClockRecord } from "../../scope/scopeClock";
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
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import {
  issueFiniteActiveApplicationPreparation,
  readFiniteActiveApplicationPreparationState,
} from "./finiteIdentity";
import { prepareFiniteApplicationMetadataProjections, prepareCompositeFiniteApplicationMetadataProjections } from "./metadataProjection";
import { captureHostPreparationLifetime, chargeHostPreparation } from "../../execution/preparation/preparedHostRuntime";
import { readApplicationReadinessControlDatabase } from "../readiness/identity";
import { lendResolvedApplicationRelationManifestBinding } from "../relations/applicationRelationSchemaAuthority";
import { getSchemaVersionArtifactWithOriginalByIdEffect } from "../../storage/catalog/schemaVersionArtifacts";
import { MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 } from "../../commit/authority/model";
import {
  attachFiniteApplicationSelectionPreparation,
  attachRelationFiniteLifetime,
  readApplicationSelectionState,
  clockMatches,
  issueLegacyActiveSelection,
  readApplicationBindingHeadPreparation,
  readLegacyApplicationBindingPreparation,
  readOriginalCurrentApplicationGenerationProtection,
} from "./selectionIdentity";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

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
    if (original === undefined || !clockMatches(original.basis.authority, clock))
      return yield* activationFailure("validateSelection", "scopeAuthority");
    const retained = original.currentPreparation;
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
    if (observed === null) return yield* activationFailure("validateSelection", "concurrentHead", original.basis.revisionId);
    return yield* entry.check(tx, clock, observed.checked, finiteEntry, changedEpoch).pipe(Effect.andThen(
      withValidatedApplicationBindingBasisInTransaction(state.selection, tx, clock,
        (validated, _checked, binding): Effect.Effect<Value, Failure | ApplicationActivationError, Requirements> => validated.kind !== "legacy"
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
    if (originalGenerationBinding !== undefined) return yield* activationFailure("read", "invalidComposition");
    const lifetime = yield* captureHostPreparationLifetime();
    if (lifetime === undefined) return yield* activationFailure("read", "invalidComposition");
    const database = yield* Effect.fromResult(readApplicationReadinessControlDatabase(captured.readiness));
    const bindingPreparation = yield* makeCompositeBindingPreparationReader(captured, prepare)("retained");
    const inputs = yield* lendApplicationBindingPreparationInputs(bindingPreparation, database);
    if (inputs.manifest.version !== 3 || inputs.manifest.schema.relations.length !== 0 ||
      inputs.schema.relations.length !== 0 || inputs.schema.edgeDefinitions.length !== 0)
      return yield* activationFailure("read", "invalidComposition");
    const active = yield* repository.readActive();
    const selected = readApplicationSelectionState(active.selection);
    if (selected?.kind !== "relation" || selected.basis.schemaVersionId !== inputs.schema.schemaVersionId ||
      encodeBytesToLowercaseHex(selected.basis.manifestSha256) !== inputs.schema.applicationManifestSha256)
      return yield* activationFailure("read", "concurrentHead");
    yield* Effect.fromResult(attachRelationFiniteLifetime(active.selection, lifetime));
    const binding = yield* lendResolvedApplicationRelationManifestBinding(inputs.schema, database, {
      deploymentId: captured.deploymentId, applicationManifestSha256: inputs.schema.applicationManifestSha256 });
    const original = yield* getSchemaVersionArtifactWithOriginalByIdEffect(database, captured.deploymentId,
      inputs.schema.schemaVersionId, MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1);
    if (original === null || original.original.payload === null ||
      encodeBytesToLowercaseHex(original.artifact.manifestSha256) !== inputs.schema.schemaManifestSha256)
      return yield* activationFailure("read", "storedState");
    const projections = yield* prepareCompositeFiniteApplicationMetadataProjections(active.selection, selected.basis,
      database, original.original, inputs, binding.relationBinding);
    yield* Effect.fromResult(attachFiniteApplicationSelectionPreparation(active.selection, projections));
    const payload = { basis: { ...selected.basis, physicalRequirements: { ...selected.basis.physicalRequirements },
      writeOwnership: selected.basis.writeOwnership === null ? null : { ...selected.basis.writeOwnership } }, schema: inputs.schema,
      original: { sizes: { ...original.original.sizes, createdAt: original.original.sizes.createdAt.getTime() },
        payload: { ...original.original.payload, createdAt: original.original.payload.createdAt.getTime() } },
      binding: { manifestBinding: { ...binding.manifestBinding }, relationBinding: { ...binding.relationBinding,
        schemaArtifact: { ...binding.relationBinding.schemaArtifact, createdAt: binding.relationBinding.schemaArtifact.createdAt.getTime() } } } };
    for (const [stage, data] of Object.entries(payload)) yield* chargeHostPreparation(data).pipe(
          Effect.mapError(cause => activationError("read", "resourceFailure", undefined, false, { stage, cause })));
    return yield* issueFiniteActiveApplicationPreparation(Object.freeze({ kind: "relation", repository,
      selection: active.selection, schema: inputs.schema, database, artifact: original.original, binding,
      lifetime, originalGenerationBinding: undefined }));
  });
}
