import { Data, Effect, Result, Scope } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "./deployments";
import { makeApplicationActivationRepository, makeApplicationStandaloneBindingSelectionReader,
  closeApplicationStandaloneBindingSelectionReader } from "./applicationActivation";
import { makeApplicationReadinessRepository, type ApplicationActivationTargetProfile,
  type ApplicationReadinessColdMaterializationPort, type ApplicationReadinessContext } from "./applicationReadiness";
import { makeApplicationSchemaAuthorityPublisher } from "./applicationSchemaAuthority";
import { createApplicationTaskCatalogSnapshotPort } from "./tasks/applicationTaskBindings";
import { createApplicationRelationBuildPort } from "./relations/applicationRelationBuild";
import { createApplicationRelationCommitPort } from "./relations/applicationRelationCommit";
import { createApplicationRelationReadPort } from "./relations/applicationRelationRead";
import { makeApplicationRelationReadinessFoldRepository } from "./relations/applicationRelationReadinessFold";
import { createApplicationRelationReadinessPort } from "./relations/readiness";
import { createApplicationRelationSchemaAuthorityPort } from "./relations/applicationRelationSchemaAuthority";
import { createApplicationRelationServingInspector } from "./relations/applicationRelationServing";
import { createApplicationRelationTaskCatalogSnapshotPort } from "./relations/applicationRelationTaskBindings";
import { createAppSchemaCandidateReadinessPort, createAppSchemaCandidateValidationPort,
  createAppSchemaCandidateWriteGuardPort } from "../storage/catalog/appSchemaCandidateValidation";
import { createAppUniqueConstraintDefinitionPortV1 } from "../storage/unique/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from "../storage/unique/appUniqueConstraintSetBuildV1";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../storage/indexes/appDeveloperIndexCommitV1";
import { createPhysicalDefinitionLifecyclePort } from "../installation/physicalDefinitionLifecycle";
import {
  createPointCommitPublisherPortV1,
} from "../commit/point/construction";
import { makeInstallationProtectedScopeAuthorityControlReader } from "../scope/scopeAuthorityControlRead";
import type { LocatedScopeClockReader, TrustedScopeAuthorityResolutionPorts, ExactTrustedScopeAuthorityResolutionPorts } from "../scope/scopeAuthorityResolution";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "../execution/transactionSessionActivation";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import { scopePhysicalLocatorsEqual } from "../scope/scopePhysicalLocator";
import { hasLocatedReadCommittedTargetDatabaseV1, isLocatedReadCommittedAttemptTargetV1, type LocatedReadCommittedAttemptTargetV1 } from "../execution/transactionSessionAttemptKernel";
import { hasRelationalSessionDatabase, readRelationalSessionCoLocatedInstallation, type RelationalSession } from "../database/relationalTransaction/session";
import { getCoLocatedReadInstallationReferencesResult } from "../installation/installationLifecycle";

type ApplicationServingProtection = NonNullable<ApplicationReadinessContext<unknown, unknown>["protectedMetadata"]>;
export interface ApplicationServingTopology {
  readonly controlDatabase: FlarexMetadataDatabase;
  readonly database: FlarexMetadataDatabase;
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
}
export interface ApplicationServingConstruction<ColdFailure> extends ApplicationServingTopology {
  readonly activation: ApplicationActivationTargetProfile;
  readonly cold: ApplicationReadinessColdMaterializationPort<ColdFailure>;
  readonly protectedMetadata?: ApplicationServingProtection;
  /** A distinct concrete lower target is retained only by explicit raw proof roots. */
  readonly scopeSessionTarget?: LocatedScopeClockReader;
}

function constructApplicationAuthority(input: ApplicationServingTopology) {
  const control = makeInstallationProtectedScopeAuthorityControlReader(input.controlDatabase);
  return Object.freeze({ ...control, scopeClockTargets: makeServingTargetResolver(input.target) });
}
/** A serving instance is bound to one concrete lower target, never a directory. */
function makeServingTargetResolver<Target extends LocatedScopeClockReader>(target: Target) {
  const physicalLocator = Object.freeze({ ...target.physicalLocator });
  return Object.freeze({ resolve: (locator: ScopePhysicalLocator): Promise<Target> =>
    scopePhysicalLocatorsEqual(locator, physicalLocator) ? Promise.resolve(target) : Promise.reject(invalidComposition()) });
}
const constructedServingOwners = new WeakSet<object>();

/** Privileged construction creates the domain graph. It performs no installation,
 * activation, materialization or serving-readiness work. */
function constructApplicationServingBase<ColdFailure>(providedInput: ApplicationServingConstruction<ColdFailure>) {
  const input = Object.freeze({ ...providedInput, activation: Object.freeze({ ...providedInput.activation }),
    cold: Object.freeze({ ...providedInput.cold }),
    ...(providedInput.protectedMetadata === undefined ? {} : { protectedMetadata: Object.freeze({ ...providedInput.protectedMetadata }) }) });
  const authority = constructApplicationAuthority(input);
  const scopeSessionTarget = input.scopeSessionTarget ?? input.target;
  const scopeSessionTargets = scopeSessionTarget === input.target ? authority.scopeClockTargets :
    makeServingTargetResolver(scopeSessionTarget);
  const pointCommitAuthority = Object.freeze({ scopeMetadata: authority.scopeMetadata,
    provisioningReceipts: authority.provisioningReceipts, scopeSessionTargets, applicationControlDb: input.controlDatabase });
  return Object.freeze({ ...input, ...constructApplicationReadinessOwners({ controlDatabase: input.controlDatabase, authority,
    pointCommitAuthority, cold: input.cold,
    ...(input.protectedMetadata === undefined ? {} : { protectedMetadata: input.protectedMetadata }) }) });
}
export interface ApplicationReadinessConstruction<ColdFailure> {
  readonly controlDatabase: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> & ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1 & Readonly<{ applicationControlDb: FlarexMetadataDatabase }>;
  readonly cold: ApplicationReadinessColdMaterializationPort<ColdFailure>;
  readonly protectedMetadata?: ApplicationServingProtection;
}
/** Reusable lower readiness graph for named construction and restart proofs. */
export function constructApplicationReadinessOwners<ColdFailure>(providedInput: ApplicationReadinessConstruction<ColdFailure>) {
  const input = Object.freeze({ ...providedInput, cold: Object.freeze({ ...providedInput.cold }),
    ...(providedInput.protectedMetadata === undefined ? {} : { protectedMetadata: Object.freeze({ ...providedInput.protectedMetadata }) }) });
  const { authority, pointCommitAuthority } = input;
  const relationCommit = createApplicationRelationCommitPort(input.controlDatabase, pointCommitAuthority);
  const candidateValidation = createAppSchemaCandidateValidationPort({ controlDb: input.controlDatabase, authority });
  const candidateReadiness = createAppSchemaCandidateReadinessPort(candidateValidation);
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(input.controlDatabase);
  const logicalStoragePorts = Object.freeze({ controlDb: input.controlDatabase, authority });
  const uniqueConstraintEligibility = createAppUniqueConstraintSetEligibilityPortV1(logicalStoragePorts, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1(pointCommitAuthority, { uniqueConstraints, uniqueConstraintEligibility });
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort(logicalStoragePorts);
  const schema = makeApplicationSchemaAuthorityPublisher({ db: input.controlDatabase, runTransaction: run => input.controlDatabase.transaction(run) });
  const readiness = makeApplicationReadinessRepository({ ...logicalStoragePorts,
    ...(input.protectedMetadata === undefined ? {} : { protectedMetadata: input.protectedMetadata }),
    schema,
    taskCatalog: createApplicationTaskCatalogSnapshotPort(), candidateValidation: candidateReadiness,
    pointCommit, physicalDefinitionLifecycle, cold: input.cold });
  const candidateSchemaWriteGuard = createAppSchemaCandidateWriteGuardPort({ candidateValidation, pointCommitAuthority });
  const materialization = Object.freeze({ intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(input.controlDatabase),
    developerIndexes: createAppDeveloperIndexDefinitionPortV1(input.controlDatabase), uniqueConstraints,
    applicationRelations: relationCommit, candidateSchemaWriteGuard });
  return Object.freeze({ controlDatabase: input.controlDatabase, authority, pointCommitAuthority, relationCommit, candidateValidation, candidateReadiness,
    pointCommit, physicalDefinitionLifecycle, readiness, schema, candidateSchemaWriteGuard,
    uniqueConstraintEligibility, logicalStoragePorts, materialization });
}

/** The named legacy Application profile shares its authority and readiness graph
 * while retaining the full-proof V1 active-selection contract. */
export function constructApplicationLegacyServingOwners<ColdFailure>(input: ApplicationServingConstruction<ColdFailure>) {
  const base = constructApplicationServingBase(input);
  const application = makeApplicationActivationRepository({ activation: base.activation, deploymentId: base.deploymentId,
    scopeId: base.scopeId, readiness: base.readiness, authority: base.authority });
  const owners = Object.freeze({ ...base, application, relationReads: undefined });
  constructedServingOwners.add(owners);
  return owners;
}

/** Relation-aware serving extends the same authoritative base graph. */
export function constructApplicationServingOwners<ColdFailure>(input: ApplicationServingConstruction<ColdFailure>) {
  const base = constructApplicationServingBase(input);
  const { controlDatabase, authority, relationCommit, candidateReadiness, pointCommit, physicalDefinitionLifecycle } = base;
  const servingInspector = createApplicationRelationServingInspector();
  const relationBuild = createApplicationRelationBuildPort(controlDatabase, authority, relationCommit, servingInspector);
  const relations = createApplicationRelationReadinessPort(controlDatabase, authority, relationCommit, relationBuild);
  const foldContext = Object.freeze({ controlDb: controlDatabase, authority,
    schema: createApplicationRelationSchemaAuthorityPort(controlDatabase), taskCatalog: createApplicationRelationTaskCatalogSnapshotPort(),
    candidateValidation: candidateReadiness, pointCommit, physicalDefinitionLifecycle, relations });
  const fold = makeApplicationRelationReadinessFoldRepository(foldContext);
  const application = makeApplicationActivationRepository({ activation: base.activation, deploymentId: base.deploymentId,
    scopeId: base.scopeId, readiness: base.readiness, relationReadiness: fold, authority });
  const relationReads = createApplicationRelationReadPort(controlDatabase, base.pointCommitAuthority, relationCommit, fold);
  const owners = Object.freeze({ ...base, application, servingInspector, relationBuild, relations, foldContext, fold, relationReads });
  constructedServingOwners.add(owners);
  return owners;
}
export type ApplicationServingOwners<ColdFailure> = ReturnType<typeof constructApplicationServingOwners<ColdFailure>> |
  ReturnType<typeof constructApplicationLegacyServingOwners<ColdFailure>>;
export class ApplicationServingError extends Data.TaggedError("ApplicationServingError")<{
  readonly reason: "invalidComposition" | "closed";
  readonly cause?: unknown;
}> {}
const invalidComposition = (cause?: unknown) => new ApplicationServingError({ reason: "invalidComposition", ...(cause === undefined ? {} : { cause }) });
declare const servingBrand: unique symbol;
export interface ApplicationServing<ColdFailure = never> { readonly [servingBrand]: ColdFailure }
declare const readServingBrand: unique symbol;
export interface ApplicationReadServing { readonly [readServingBrand]: true }
export interface ApplicationServingInput<ColdFailure> extends ApplicationServingConstruction<ColdFailure> { readonly session: RelationalSession }
export interface ApplicationReadServingInput extends ApplicationServingTopology {
  readonly session: RelationalSession;
  readonly protectedMetadata: ApplicationServingProtection;
}

function validateTopology(input: ApplicationServingTopology & { readonly session: RelationalSession }) {
  return hasLocatedReadCommittedTargetDatabaseV1(input.target, input.database) && hasRelationalSessionDatabase(input.session, input.database)
    ? Result.succeed(undefined) : Result.fail(invalidComposition());
}
function constructApplicationReadServingOwners(input: ApplicationReadServingInput) {
  return Result.gen(function* () {
    yield* validateTopology(input);
    const installation = yield* readRelationalSessionCoLocatedInstallation(input.session, input.database).pipe(Result.mapError(invalidComposition));
    if (installation === undefined || input.protectedMetadata.database !== input.database) return yield* Result.fail(invalidComposition());
    const references = yield* getCoLocatedReadInstallationReferencesResult(installation, input.database).pipe(Result.mapError(invalidComposition));
    if (references.target.schemaName !== input.target.physicalLocator.schemaName)
      return yield* Result.fail(invalidComposition());
    const authority = constructApplicationAuthority(input);
    const application = makeApplicationStandaloneBindingSelectionReader({ deploymentId: input.deploymentId, scopeId: input.scopeId,
      authority, protectedMetadata: input.protectedMetadata });
    return Object.freeze({ ...input, authority, application, installation });
  });
}
type ReadServingOwners = ReturnType<typeof constructApplicationReadServingOwners> extends Result.Result<infer Owners, unknown> ? Owners : never;
type ServingState = ApplicationServingOwners<unknown> & Readonly<{ session: RelationalSession; scope: Scope.Scope }>;
const servingStates = new WeakMap<object, ServingState>();
const readServingStates = new WeakMap<object, ReadServingOwners & { readonly scope: Scope.Scope }>();
const closedServings = new WeakSet<object>();

/** Multiple serving instances coexist, each bound to its trusted construction Scope. */
export const makeApplicationServing = Effect.fn("ApplicationServing.make")(function* <ColdFailure>(input: ApplicationServingInput<ColdFailure>) {
  yield* Effect.fromResult(validateTopology(input));
  if (input.scopeSessionTarget !== undefined && !scopePhysicalLocatorsEqual(input.target.physicalLocator, input.scopeSessionTarget.physicalLocator))
    return yield* Effect.fail(invalidComposition());
  const owners = constructApplicationServingOwners(input);
  return yield* retainApplicationServing(owners, input.session);
});
/** Reuses a graph built by this owner, never a consumer-assembled options bag. */
export const retainApplicationServing = Effect.fn("ApplicationServing.retain")(function* <ColdFailure>(
  owners: ApplicationServingOwners<ColdFailure>, session: RelationalSession,
) {
  if (!constructedServingOwners.has(owners)) return yield* Effect.fail(invalidComposition());
  yield* Effect.fromResult(validateTopology({ ...owners, session }));
  if (owners.scopeSessionTarget !== undefined && (!isLocatedReadCommittedAttemptTargetV1(owners.scopeSessionTarget) ||
    !hasLocatedReadCommittedTargetDatabaseV1(owners.scopeSessionTarget, owners.database) ||
    !scopePhysicalLocatorsEqual(owners.target.physicalLocator, owners.scopeSessionTarget.physicalLocator)))
    return yield* Effect.fail(invalidComposition());
  const scope = yield* Effect.scope;
  // SAFETY: private issuer state carries the authentic instance and lifetime.
  const serving = Object.freeze({}) as ApplicationServing<ColdFailure>;
  servingStates.set(serving, Object.freeze({ ...owners, session, scope }));
  yield* Effect.addFinalizer(() => Effect.sync(() => { servingStates.delete(serving); closedServings.add(serving); }));
  return serving;
});
export const makeApplicationReadServing = Effect.fn("ApplicationServing.makeRead")(function* (input: ApplicationReadServingInput) {
  const owners = yield* Effect.fromResult(constructApplicationReadServingOwners(input));
  const scope = yield* Effect.scope;
  // SAFETY: only the exact read registry authenticates this capability.
  const serving = Object.freeze({}) as ApplicationReadServing;
  readServingStates.set(serving, Object.freeze({ ...owners, scope }));
  yield* Effect.addFinalizer(() => Effect.sync(() => { closeApplicationStandaloneBindingSelectionReader(owners.application);
    readServingStates.delete(serving); closedServings.add(serving); }));
  return serving;
});
export function claimApplicationServing<ColdFailure>(serving: ApplicationServing<ColdFailure>) {
  const state = servingStates.get(serving);
  if (state === undefined) return Result.fail(closedServings.has(serving) ? new ApplicationServingError({ reason: "closed" }) : invalidComposition());
  // SAFETY: the original generic issuer registered this same owners graph under the exact token.
  return Result.succeed(state as ApplicationServingOwners<ColdFailure> & Readonly<{ session: RelationalSession; scope: Scope.Scope }>);
}
export function claimApplicationReadServing(serving: ApplicationReadServing) {
  const read = readServingStates.get(serving);
  if (read !== undefined) return Result.succeed(read);
  return Result.fail(closedServings.has(serving) ? new ApplicationServingError({ reason: "closed" }) : invalidComposition());
}
