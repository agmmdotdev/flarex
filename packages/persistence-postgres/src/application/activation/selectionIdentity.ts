import type { prepareFiniteApplicationExecutionSchema } from "../../commit/authority/postgresLoader";
import type { PreparedPublicationDefinitions } from "../../commit/publication/definitionPreparation";
import type { PreparedFiniteMetadataProjection } from "../../execution/finiteMetadataDependencies";
import {
  type captureHostPreparationLifetime,
  registerHostPreparationDisposal,
} from "../../execution/preparation/preparedHostRuntime";
import type { ProtectedTargetMetadataEvidence } from "../../execution/preparation/preparedMetadataEpoch";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { PreparedApplicationActiveHeadStructure } from "../activeHead/contracts";
import type { StandaloneApplicationBinding } from "../applicationStandaloneBinding";
import type { ApplicationReadinessProtection, ApplicationReadinessResult } from "../readiness/contracts";
import { readApplicationReadinessTargetProtection } from "../readiness/identity";
import type {
  ApplicationRelationReadinessFoldRepository,
  ApplicationRelationReadinessFoldResult,
  PreparedApplicationRelationActiveRead,
} from "../relations/applicationRelationReadinessFold";
import type { locateApplicationRelationBindingForCommitEffect } from "../relations/binding/Repository";
import type { ApplicationStandaloneBindingContext } from "./constructionContracts";
import type {
  ApplicationActiveCasToken,
  ApplicationActiveSelection,
  ApplicationActiveSelectionBasis,
  ApplicationBindingInput,
  ApplicationBindingPreparation,
  ApplicationExecutableActiveSelection,
  ApplicationReadBindingSelectionReader,
  ApplicationRelationActiveSelectionBasis,
  ApplicationRelationActiveSelectionSnapshot,
  ApplicationStandaloneBindingSelectionReader,
  PreparedApplicationBinding,
  PreparedStandaloneApplicationBinding,
} from "./contracts";
import { activationError, type ApplicationActivationError } from "./errors";
import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

export interface LegacySelectionState {
  readonly kind: "legacy";
  readonly basis: ApplicationActiveSelectionBasis;
  readonly readinessRepository: unknown;
  readonly readiness: ApplicationReadinessResult;
  readonly lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
  readonly currentPreparation?: RetainedBindingMetadata;
  readonly finitePreparation?: Readonly<{
    sourceComposition?: PreparedFiniteMetadataProjection;
    execution: PreparedFiniteMetadataProjection;
    nativeApplication: PreparedFiniteMetadataProjection;
    schema: Effect.Success<ReturnType<typeof prepareFiniteApplicationExecutionSchema>>;
    publicationDefinitions: Readonly<{
      prepared: PreparedPublicationDefinitions;
      relations: Effect.Success<ReturnType<typeof locateApplicationRelationBindingForCommitEffect>>;
    }>;
  }>;
}

export interface RelationSelectionState {
  readonly kind: "relation";
  readonly basis: ApplicationRelationActiveSelectionBasis;
  readonly readinessRepository: ApplicationRelationReadinessFoldRepository;
  readonly readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >;
}

export type SelectionState = LegacySelectionState | RelationSelectionState;

const selectionStates = new WeakMap<ApplicationActiveSelection, SelectionState>();

const bindingHeadPreparations = new WeakMap<object, PreparedApplicationActiveHeadStructure>();

/** Source-private lookup of the original issued selection; no structural claim is made. */
export function readApplicationSelectionState(selection: ApplicationActiveSelection) {
  return selectionStates.get(selection);
}

export function readApplicationBindingHeadPreparation(binding: ApplicationBindingInput) {
  return bindingHeadPreparations.get(binding);
}

export function registerApplicationBindingHeadPreparation(token: ApplicationActiveSelection | PreparedApplicationBinding,
  prepared: PreparedApplicationActiveHeadStructure): void {
  bindingHeadPreparations.set(token, prepared);
}

/** Source readers derive protection from an actual Application readiness
 * issuer, never from copied digests or unique-build configuration. */
export function readApplicationBindingTargetProtection(input: ApplicationBindingInput) {
  const standalone = standaloneBindingPreparations.get(input);
  if (standalone !== undefined) return standalone.lifetime.checkOpen().pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", standalone.frame.revisionId, false, cause)),
    Result.map(() => ({ protection: standalone.protection, lifetime: standalone.lifetime, readinessProtection: undefined })));
  // SAFETY: nominal registry membership, not this lookup assertion, authenticates the selection.
  const state = legacyBindingPreparations.get(input) ?? selectionStates.get(input as ApplicationActiveSelection);
  if (state === undefined) {
    const prepared = bindingPreparations.get(input);
    if (prepared === undefined) return Result.fail(activationError("validateSelection", "invalidComposition"));
    return (prepared.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
      Result.mapError(cause => activationError("validateSelection", "invalidComposition", prepared.revisionId, false, cause)),
      Result.map(() => Object.freeze({ protection: undefined, lifetime: prepared.lifetime,
        readinessProtection: prepared.currentPreparation })));
  }
  if (state.kind !== "legacy") return Result.succeed(Object.freeze({ protection: undefined, lifetime: undefined, readinessProtection: undefined }));
  const protection = readApplicationReadinessTargetProtection(state.readinessRepository, state.readiness);
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", state.basis.revisionId, false, cause)),
    Result.map(() => Object.freeze({ protection, lifetime: state.lifetime, readinessProtection: state.currentPreparation })));
}

export interface StandaloneBindingState {
  readonly authority: TrustedScopeAuthority;
  readonly frame: StandaloneApplicationBinding;
  readonly protection: ProtectedTargetMetadataEvidence;
  readonly lifetime: NonNullable<LegacySelectionState["lifetime"]>;
}

const standaloneBindingPreparations = new WeakMap<object, StandaloneBindingState>();

const standaloneSelectionReaderStates = new WeakMap<object, ApplicationStandaloneBindingContext>();

export function readStandaloneApplicationBindingSelectionReaderState(reader: ApplicationReadBindingSelectionReader<unknown>) {
  return standaloneSelectionReaderStates.get(reader);
}

export function registerStandaloneApplicationBindingSelectionReader(reader: ApplicationStandaloneBindingSelectionReader,
  captured: ApplicationStandaloneBindingContext): void {
  standaloneSelectionReaderStates.set(reader, captured);
}

export function closeStandaloneApplicationBindingSelectionReaderIdentity(reader: ApplicationStandaloneBindingSelectionReader): void {
  standaloneSelectionReaderStates.delete(reader);
}

export function readStandaloneApplicationBindingPreparation(binding: ApplicationBindingInput) {
  return standaloneBindingPreparations.get(binding);
}

export function registerStandaloneApplicationBindingPreparation(token: PreparedStandaloneApplicationBinding,
  state: StandaloneBindingState): void {
  standaloneBindingPreparations.set(token, state);
}

export function closeStandaloneApplicationBindingPreparation(token: PreparedStandaloneApplicationBinding): void {
  standaloneBindingPreparations.delete(token);
}

export function isPreparedStandaloneApplicationBinding(input: ApplicationBindingInput): input is PreparedStandaloneApplicationBinding {
  return standaloneBindingPreparations.has(input);
}

export function readPreparedStandaloneApplicationBinding(input: PreparedStandaloneApplicationBinding) {
  const state = standaloneBindingPreparations.get(input);
  if (state === undefined) return Result.fail(activationError("validateSelection", "invalidComposition"));
  return state.lifetime.checkOpen().pipe(
    Result.mapError(cause => activationError("validateSelection", "invalidComposition", state.frame.revisionId, false, cause)),
    Result.map(() => ({ authority: { ...state.authority, physicalLocator: { ...state.authority.physicalLocator } },
      frame: structuredClone(state.frame), protection: state.protection })));
}

const legacyBindingPreparations = new WeakMap<object, LegacySelectionState>();

export function readLegacyApplicationBindingPreparation(binding: ApplicationBindingInput) {
  return legacyBindingPreparations.get(binding);
}

export function registerLegacyApplicationBindingPreparation(token: PreparedApplicationBinding, state: LegacySelectionState): void {
  legacyBindingPreparations.set(token, state);
}

export function closeLegacyApplicationBindingPreparation(token: PreparedApplicationBinding): void {
  legacyBindingPreparations.delete(token);
  bindingHeadPreparations.delete(token);
}

const bindingPreparations = new WeakMap<object, Readonly<{
  authority: TrustedScopeAuthority; revisionId: string; readiness: PreparedApplicationRelationActiveRead;
  lifetime: LegacySelectionState["lifetime"];
  currentPreparation?: RetainedBindingMetadata;
}>>();

export function readRelationApplicationBindingPreparation(binding: ApplicationBindingInput) {
  return bindingPreparations.get(binding);
}

export function registerRelationApplicationBindingPreparation(token: ApplicationBindingPreparation,
  state: NonNullable<ReturnType<typeof readRelationApplicationBindingPreparation>>): void {
  bindingPreparations.set(token, state);
}

export function closeRelationApplicationBindingPreparation(token: ApplicationBindingPreparation): void {
  bindingPreparations.delete(token);
}

export function attachCurrentApplicationBindingMetadata(binding: ApplicationBindingInput, retained: RetainedBindingMetadata) {
  const legacy = legacyBindingPreparations.get(binding);
  const relation = bindingPreparations.get(binding);
  if (legacy !== undefined) legacyBindingPreparations.set(binding, Object.freeze({ ...legacy, currentPreparation: retained }));
  else if (relation !== undefined) bindingPreparations.set(binding, Object.freeze({ ...relation, currentPreparation: retained }));
  else return Result.fail(activationError("read", "invalidComposition"));
  return Result.succeed(undefined);
}

export function attachFiniteApplicationSelectionPreparation(selection: ApplicationActiveSelection,
  projections: NonNullable<LegacySelectionState["finitePreparation"]>, currentPreparation?: RetainedBindingMetadata) {
  const selected = selectionStates.get(selection);
  if (selected?.kind !== "legacy") return Result.fail(activationError("read", "invalidComposition"));
  selectionStates.set(selection, Object.freeze({ ...selected, finitePreparation: projections,
    ...(currentPreparation === undefined ? {} : { currentPreparation }) }));
  return Result.succeed(undefined);
}

/** Attach only during the original bounded construction. A changed retained
 * graph never replaces its source pairing or restores a disposed generation. */
export function attachFiniteApplicationSourceComposition(selection: ApplicationActiveSelection,
  sourceComposition: PreparedFiniteMetadataProjection) {
  const selected = selectionStates.get(selection);
  if (selected?.kind !== "legacy" || selected.finitePreparation === undefined ||
    selected.finitePreparation.sourceComposition !== undefined)
    return Result.fail(activationError("read", "invalidComposition"));
  selectionStates.set(selection, Object.freeze({ ...selected,
    finitePreparation: Object.freeze({ ...selected.finitePreparation, sourceComposition }) }));
  return Result.succeed(undefined);
}

export function readFiniteApplicationSourceComposition(selection: ApplicationBindingInput) {
  // SAFETY: the issuer lookup authenticates the opaque Application selection.
  const selected = selectionStates.get(selection as ApplicationActiveSelection);
  return readApplicationBindingTargetProtection(selection).pipe(Result.map(() =>
    selected?.kind === "legacy" ? selected.finitePreparation?.sourceComposition : undefined));
}

export interface RetainedBindingMetadata {
  readonly slot: object;
  readonly key: string;
  readonly target: ProtectedTargetMetadataEvidence;
  readonly control: ProtectedTargetMetadataEvidence;
  readonly constructionOpen: boolean;
}

/** Only the original generation constructor borrows these paired anchors.
 * Its complete before/after probe brackets all cold reads; ordinary callbacks
 * must authenticate retained evidence against their fresh transaction instead. */
export function readOriginalCurrentApplicationGenerationProtection(binding: ApplicationBindingInput):
  Result.Result<ApplicationReadinessProtection | undefined, ApplicationActivationError> {
  const state = legacyBindingPreparations.get(binding) ?? bindingPreparations.get(binding);
  if (state === undefined) return Result.fail(activationError("read", "invalidComposition"));
  return (state.lifetime?.checkOpen() ?? Result.succeed(undefined)).pipe(
    Result.mapError(cause => activationError("read", "invalidComposition", undefined, false, cause)),
    Result.flatMap(() => {
      const original = state.currentPreparation;
      if (original === undefined) return Result.succeed(undefined);
      return original.constructionOpen
        ? Result.succeed(Object.freeze({ target: original.target, control: original.control }))
        : Result.fail(activationError("read", "invalidComposition"));
    }),
  );
}

export function isApplicationBindingPreparation(input: ApplicationBindingInput): input is ApplicationBindingPreparation {
  return bindingPreparations.has(input);
}

export function isPreparedApplicationBinding(input: ApplicationBindingInput): input is PreparedApplicationBinding {
  return legacyBindingPreparations.has(input);
}

export function claimApplicationActiveSelection(
  selection: unknown,
): Result.Result<ApplicationActiveSelectionBasis, ApplicationActivationError> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  }
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered brand.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state?.kind !== "legacy"
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copySelectionBasis(state.basis));
}

export function claimApplicationRelationActiveSelection(
  selection: unknown,
): Result.Result<
  ApplicationRelationActiveSelectionSnapshot,
  ApplicationActivationError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  // SAFETY: the typeof guard proves a non-null object; WeakMap membership is
  // the actual nominal proof and structural copies are not registered.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state?.kind !== "relation"
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copyRelationSelectionSnapshot(state.basis));
}

/**
 * Claims the nominal active selection accepted by the function runtime while
 * preserving which immutable publication contract owns its evidence.
 */
export function claimApplicationExecutableActiveSelection(
  selection: unknown,
): Result.Result<
  ApplicationExecutableActiveSelection,
  ApplicationActivationError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  // SAFETY: the object guard permits the WeakMap lookup. Membership, rather
  // than structural shape, is the authority for both supported selections.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  if (state === undefined) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  return state.kind === "legacy"
    ? Result.succeed(Object.freeze({
        kind: "legacy" as const,
        basis: copySelectionBasis(state.basis),
      }))
    : Result.succeed(Object.freeze({
        kind: "relation" as const,
        basis: copyRelationSelectionBasis(state.basis),
      }));
}

export function applicationRelationActiveSelectionMatchesSnapshot(
  basis: ApplicationRelationActiveSelectionBasis,
  snapshot: ApplicationRelationActiveSelectionSnapshot,
): boolean {
  return sameTrustedAuthority(basis.authority, snapshot.authority) &&
    basis.deploymentId === snapshot.deploymentId &&
    basis.revisionId === snapshot.revisionId &&
    basis.schemaVersionId === snapshot.schemaVersionId &&
    basis.relationFrontierCommitSeq === snapshot.relationFrontierCommitSeq &&
    basis.relationCount === snapshot.relationCount &&
    basis.activationSequence === snapshot.activationSequence &&
    bytesEqualFullScan(basis.readinessSha256, snapshot.readinessSha256) &&
    bytesEqualFullScan(
      basis.relationSetReadinessSha256,
      snapshot.relationSetReadinessSha256,
    ) &&
    bytesEqualFullScan(basis.activationSha256, snapshot.activationSha256) &&
    bytesEqualFullScan(basis.headSha256, snapshot.headSha256);
}

export function claimApplicationRelationActiveSelectionForReadiness(
  readiness: ApplicationRelationReadinessFoldRepository,
  selection: unknown,
): Result.Result<
  ApplicationRelationActiveSelectionBasis,
  ApplicationActivationError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(
      activationError("validateSelection", "invalidComposition"),
    );
  }
  // SAFETY: the object guard permits the WeakMap lookup. Exact repository
  // identity prevents a selection from authorizing an adjacent composition.
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state?.kind !== "relation" ||
      state.readinessRepository !== readiness
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copyRelationSelectionBasis(state.basis));
}

export const issueLegacyActiveSelection = Effect.fn("ApplicationActivation.issueLegacyActiveSelection")(function* (state: Readonly<{
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationActiveSelectionBasis;
}>, readinessRepository: unknown, readiness: ApplicationReadinessResult,
  lifetime: LegacySelectionState["lifetime"]) {
  // SAFETY: the selection is an inert identity token; all authority remains
  // in the module-local WeakMap keyed by this object identity.
  const selection = Object.freeze({}) as ApplicationActiveSelection;
  selectionStates.set(selection, Object.freeze({
    kind: "legacy",
    basis: copySelectionBasis(state.basis),
    readinessRepository,
    readiness,
    lifetime,
  }));
  yield* registerHostPreparationDisposal(() => {
    selectionStates.delete(selection);
    bindingHeadPreparations.delete(selection);
  }).pipe(Effect.mapError(cause => activationError("read", "resourceFailure", state.basis.revisionId, false, cause)));
  return Object.freeze({
    selection,
    expectedActiveHead: copyCasToken(state.expectedActiveHead),
    basis: copySelectionBasis(state.basis),
  });
});

export const issueRelationActiveSelection = Effect.fn("ApplicationActivation.issueRelationActiveSelection")(function* (
  state: Readonly<{
    readonly expectedActiveHead: ApplicationActiveCasToken;
    readonly basis: ApplicationRelationActiveSelectionBasis;
  }>,
  readinessRepository: ApplicationRelationReadinessFoldRepository,
  readiness: Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "ready" }
  >,
) {
  // SAFETY: the inert token is the only public carrier. The full readiness
  // basis and definition-set authority remain hidden behind its identity.
  const selection = Object.freeze({}) as ApplicationActiveSelection;
  selectionStates.set(selection, Object.freeze({
    kind: "relation",
    basis: copyRelationSelectionBasis(state.basis),
    readinessRepository,
    readiness,
  }));
  yield* registerHostPreparationDisposal(() => {
    selectionStates.delete(selection);
    bindingHeadPreparations.delete(selection);
  }).pipe(Effect.mapError(cause => activationError("read", "resourceFailure", state.basis.revisionId, false, cause)));
  return Object.freeze({
    selection,
    expectedActiveHead: copyCasToken(state.expectedActiveHead),
    basis: copyRelationSelectionSnapshot(state.basis),
  });
});

export function clockMatches(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): boolean {
  return authority.scopeId === clock.scopeId &&
    authority.storageGeneration === clock.storageGeneration &&
    authority.storageGenerationFence === clock.storageGenerationFence &&
      authority.epoch === clock.epoch;
}

export function sameTrustedAuthority(
  expected: TrustedScopeAuthority,
  actual: TrustedScopeAuthority,
): boolean {
  const left = expected.physicalLocator;
  const right = actual.physicalLocator;
  return expected.deploymentId === actual.deploymentId &&
    expected.scopeId === actual.scopeId &&
    expected.storageGeneration === actual.storageGeneration &&
    expected.storageGenerationFence === actual.storageGenerationFence &&
    expected.epoch === actual.epoch &&
    left.kind === right.kind && left.databaseKey === right.databaseKey &&
    left.schemaName === right.schemaName;
}

export function copySelectionBasis(
  basis: ApplicationActiveSelectionBasis,
): ApplicationActiveSelectionBasis {
  return Object.freeze({
    ...basis,
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256),
    manifestSha256: copyBytes(basis.manifestSha256),
    publicationSha256: copyBytes(basis.publicationSha256),
    functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
    applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
    schemaBindingSha256: copyBytes(basis.schemaBindingSha256),
    taskCatalogSha256: copyBytes(basis.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(basis.taskCatalogBindingSha256),
    readinessSha256: copyBytes(basis.readinessSha256),
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

export function copyRelationSelectionBasis(
  basis: ApplicationRelationActiveSelectionBasis,
): ApplicationRelationActiveSelectionBasis {
  return Object.freeze({
    ...basis,
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256),
    manifestSha256: copyBytes(basis.manifestSha256),
    publicationSha256: copyBytes(basis.publicationSha256),
    functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
    applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
    manifestSchemaBindingSha256:
      copyBytes(basis.manifestSchemaBindingSha256),
    boundPublicationSha256: copyBytes(basis.boundPublicationSha256),
    taskCatalogSha256: copyBytes(basis.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(basis.taskCatalogBindingSha256),
    readinessSha256: copyBytes(basis.readinessSha256),
    relationSetReadinessSha256:
      copyBytes(basis.relationSetReadinessSha256),
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

export function copyRelationSelectionSnapshot(
  basis: ApplicationRelationActiveSelectionBasis,
): ApplicationRelationActiveSelectionSnapshot {
  return Object.freeze({
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    deploymentId: basis.deploymentId,
    revisionId: basis.revisionId,
    schemaVersionId: basis.schemaVersionId,
    readinessSha256: copyBytes(basis.readinessSha256),
    relationFrontierCommitSeq: basis.relationFrontierCommitSeq,
    relationSetReadinessSha256: copyBytes(
      basis.relationSetReadinessSha256,
    ),
    relationCount: basis.relationCount,
    activationSequence: basis.activationSequence,
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

export function copyCasToken(token: ApplicationActiveCasToken): ApplicationActiveCasToken {
  return Object.freeze({ ...token });
}
