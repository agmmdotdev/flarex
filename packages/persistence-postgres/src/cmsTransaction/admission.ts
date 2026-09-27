import { chargeHostPreparation } from "../preparedHostRuntime";
import { frameworkSchemaTargetSnapshot, type FrameworkSchemaTarget } from "../frameworkSchema/target";
import { scopePhysicalLocatorsEqual } from "../scopePhysicalLocator";
import { prepareInstallationRuntime, acceptPreparedInstallation, type PreparedInstallationRuntime } from "../frameworkSchema/installation/runtime";
import type { InstallationRuntimeData } from "../frameworkSchema/installation/runtimeData";
import { bindingInstallationReference } from "../frameworkSchema/binding/model";
import { runRelationalSession, type RelationalSession } from "../relationalTransaction/session";
import { lockScopeClockForShareInTransactionEffect } from "../scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import { verifyPayloadPreferenceStorageBinding } from "../payloadPreferences/binding";
import { Effect, Option, Schema } from "effect";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
import { MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1 } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { createAppDeveloperIndexDefinitionPortV1 } from "../appDeveloperIndexCommitV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { MAX_RECONCILED_DEFINITIONS } from "../indexBuildReconciliation";
import { captureApplicationWritePolicyData, PayloadConfigurationSchema, type PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { ApplicationBindingInput, ApplicationBindingSelectionReader, AcceptedApplicationBinding } from "../applicationActivation";
import { prepareApplicationBindingSelection, readApplicationBindingPreparationInputs, withAcceptedApplicationBinding, hasApplicationBindingComposition } from "../applicationActivation";
import { type ApplicationRelationSchemaAuthority } from "../applicationRelationSchemaAuthority";
import { readAcceptedApplicationBindingProjection } from "../applicationBindingProjection";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { verifyAcceptedPayloadContentBinding } from "../frameworkSchema/binding/content";
import type { DataBindingSetFrame, DataBindingHeadToken } from "../frameworkSchema/binding/model";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority, ExactTrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { cmsError } from "./model";

declare const admissionBrand: unique symbol;
export interface CmsAdmission { readonly [admissionBrand]: true }
export interface PreparedCmsApplication {
  readonly configuration: PayloadConfiguration;
  readonly selection: ApplicationBindingInput;
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly indexDefinitions: readonly LocatedAppIndexDefinitionV1[];
}
export interface CmsAdmissionState {
  readonly binding: AcceptedApplicationBinding;
  readonly configuration: PayloadConfiguration;
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly frame: DataBindingSetFrame;
  readonly head: DataBindingHeadToken;
  readonly preferenceAvailability: InstallationRuntimeData | null;
}
export interface PreparedCmsPreferences {
  readonly target: FrameworkSchemaTarget;
  readonly installation: PreparedInstallationRuntime;
}
const admissions = new WeakMap<object, CmsAdmissionState>();
const prepared = new WeakSet<object>();
const isPayloadConfiguration = Schema.is(PayloadConfigurationSchema);
const decodeDeploymentId = Schema.decodeUnknownEffect(TransactionGrantDeploymentIdV1Schema);

function cmsClockMatches(authority: TrustedScopeAuthority, clock: ScopeClockRecord): boolean {
  return clock.scopeId === authority.scopeId && clock.storageGeneration === authority.storageGeneration &&
    clock.storageGenerationFence === authority.storageGenerationFence && clock.epoch === authority.epoch;
}

/** Host-owned immutable installation inputs, never request authority. Selection
 * releases its scope lock before the installation owner's snapshot preparation. */
export const prepareCmsPreferences = Effect.fn("CmsAdmission.preparePreferences")(function* (
  database: FlarexMetadataDatabase, session: RelationalSession,
  authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>,
  deploymentId: string, scopeId: ScopeId, target: FrameworkSchemaTarget,
) {
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId }, authority);
  if (!hasLocatedReadCommittedTargetDatabaseV1(located.target, database)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const reference = yield* runRelationalSession(session, "command", tx => Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(tx, located.authority.scopeId);
    if (!cmsClockMatches(located.authority, clock)) return yield* Effect.fail(cmsError("invalidAuthority"));
    const head = yield* readBindingHead(tx, located.authority, "none");
    if (Option.isNone(head)) return yield* Effect.fail(cmsError("bindingChanged"));
    const candidate = yield* readBindingCandidate(tx, located.authority, head.value.frame.candidateSha256);
    if (Option.isNone(candidate)) return yield* Effect.fail(cmsError("storedCorruption"));
    if (candidate.value.frame.payloadLifecycle === null) return yield* Effect.fail(cmsError("unsupportedProfile"));
    return bindingInstallationReference(candidate.value.frame.payloadLifecycle);
  }));
  const installation = yield* prepareInstallationRuntime(database, target, reference);
  return Object.freeze({ target, installation }) satisfies PreparedCmsPreferences;
});

/** Host-owned revision preparation, never a live admission verdict. Control
 * evidence is captured before opening any request's target data transaction. */
export const prepareCmsApplication = Effect.fn("CmsAdmission.prepare")(function* <Failure>(
  application: ApplicationBindingSelectionReader<Failure>,
  authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>,
  controlDb: FlarexMetadataDatabase,
  deploymentId: string, selectedScopeId: ScopeId,
) {
  if (!hasApplicationBindingComposition(application, authority)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const selection = yield* prepareApplicationBindingSelection(application);
  const { schema, manifest, scopeId } = yield* readApplicationBindingPreparationInputs(selection, controlDb);
  if (scopeId !== selectedScopeId) return yield* Effect.fail(cmsError("invalidAuthority"));
  if (schema.deploymentId !== deploymentId || schema.writePolicy === null || schema.relations.length > 2) {
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  }
  if (manifest.version !== 3 || schema.relations.length !==
    ({ "payload.scalar": 0, "payload.content-relations": 1, "payload.content-many": 2, "payload.content-joins": 2 }[manifest.schema.writePolicies.configuration.profile])) {
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  }
  const configuration = yield* Effect.fromResult(captureApplicationWritePolicyData(manifest.schema.writePolicies.configuration));
  if (!isPayloadConfiguration(configuration)) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* chargeHostPreparation(configuration).pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId));
  const deployment = yield* decodeDeploymentId(schema.deploymentId);
  // Retained schema selection uses the closed-set bound. The separate command
  // materializer applies its mutation budget to actual row/key transitions.
  const uniqueDefinitions = yield* createAppUniqueConstraintDefinitionPortV1(controlDb).locate({
    deploymentId: deployment, scopeId: scope.scopeId, schemaVersionId: schema.schemaVersionId,
    tableIds: schema.writePolicy.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId),
    maximumDefinitions: MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
  });
  if (uniqueDefinitions === null) return yield* Effect.fail(cmsError("invalidAuthority"));
  // Date is metadata here; account its value without admitting class instances
  // into the prepared-host payload contract.
  yield* chargeHostPreparation(uniqueDefinitions.map(definition => ({ ...definition, createdAt: definition.createdAt.getTime() })))
    .pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  const indexDefinitions = yield* createAppDeveloperIndexDefinitionPortV1(controlDb).locate({
    deploymentId: deployment, scopeId: scope.scopeId, schemaVersionId: schema.schemaVersionId,
    tableIds: schema.writePolicy.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId),
    maximumDefinitions: MAX_RECONCILED_DEFINITIONS,
  });
  if (indexDefinitions === null) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* chargeHostPreparation(indexDefinitions.map(definition => ({ ...definition, createdAt: definition.createdAt.getTime() })))
    .pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  const value: PreparedCmsApplication = Object.freeze({ selection, schema, configuration, uniqueDefinitions, indexDefinitions });
  prepared.add(value);
  return value;
});

/** Called by the private host only after locking and authenticating the scope clock. */
export const withCmsAdmission = Effect.fn("CmsAdmission.withTransaction")(function* <Value, Failure, Requirements>(
  application: PreparedCmsApplication,
  tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  work: (admission: CmsAdmission) => Effect.Effect<Value, Failure, Requirements>,
  preferences?: PreparedCmsPreferences,
  accepted?: AcceptedApplicationBinding,
) {
  if (!prepared.has(application) || !cmsClockMatches(authority, clock)) return yield* Effect.fail(cmsError("invalidAuthority"));
  return yield* withAcceptedApplicationBinding(application.selection, tx, clock, binding => Effect.gen(function* () {
    const projection = yield* readAcceptedApplicationBindingProjection(binding, tx, clock);
    const head = yield* readBindingHead(tx, authority, "share");
    if (Option.isNone(head)) return yield* Effect.fail(cmsError("bindingChanged"));
    const candidate = yield* readBindingCandidate(tx, authority, head.value.frame.candidateSha256);
    if (Option.isNone(candidate)) return yield* Effect.fail(cmsError("storedCorruption"));
    const frame = candidate.value.frame;
    if (!sameBindingValue(projection, frame.application)) return yield* Effect.fail(cmsError("bindingChanged"));
    if (frame.payloadContent === null || (frame.payloadLifecycle !== null && preferences === undefined) ||
      (frame.payloadLifecycle === null && preferences !== undefined) || commerceBindings(frame).length !== 0 ||
      projection.readiness.kind !== "policy" || projection.readiness.relationCount > 2) {
      return yield* Effect.fail(cmsError("unsupportedProfile"));
    }
    const schema = application.schema;
    if (schema.schemaVersionId !== projection.schemaVersionId || schema.applicationSchemaSha256 !== projection.applicationSchemaSha256 ||
      schema.schemaManifestSha256 !== projection.schemaManifestSha256 ||
      schema.manifestSchemaBindingSha256 !== projection.readiness.manifestSchemaBindingSha256 ||
      schema.boundPublicationSha256 !== projection.readiness.boundPublicationSha256 ||
      schema.writePolicy?.writePolicySetSha256 !== projection.readiness.writePolicySetSha256) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    yield* verifyAcceptedPayloadContentBinding(tx, clock, frame, binding);
    let preferenceAvailability: InstallationRuntimeData | null = null;
    if (preferences !== undefined && frame.payloadLifecycle !== null) {
      const snapshot = frameworkSchemaTargetSnapshot(preferences.target);
      if (snapshot === undefined || snapshot.namespace.frame.deploymentId !== authority.deploymentId ||
        !scopePhysicalLocatorsEqual(snapshot.physicalLocator, authority.physicalLocator)) return yield* Effect.fail(cmsError("invalidAuthority"));
      const availability = yield* acceptPreparedInstallation(preferences.installation, preferences.target,
        bindingInstallationReference(frame.payloadLifecycle), tx);
      yield* verifyPayloadPreferenceStorageBinding(frame, availability);
      preferenceAvailability = availability;
    }
    // SAFETY: authority resides exclusively in this live, transaction-bound registry.
    const token = Object.freeze({}) as CmsAdmission;
    admissions.set(token, Object.freeze({ binding, tx, authority, clock, schema, frame, preferenceAvailability, configuration: application.configuration,
      head: Object.freeze({ sequence: head.value.frame.sequence, sha256: head.value.sha256 }) }));
    return yield* Effect.suspend(() => work(token)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(token))));
  }), accepted);
});

export const requireCmsAdmission = Effect.fn("CmsAdmission.require")(function* (
  token: CmsAdmission,
  tx?: FlarexMetadataTransaction,
) {
  const state = admissions.get(token);
  if (state === undefined || (tx !== undefined && state.tx !== tx)) return yield* Effect.fail(cmsError("invalidAuthority"));
  return state;
});
import { commerceBindings } from "../frameworkSchema/binding/model";
