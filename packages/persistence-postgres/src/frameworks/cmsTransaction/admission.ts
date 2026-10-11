import { observeExecution } from "../../execution/diagnostics/operation";
import {
  chargeHostPreparation,
  captureHostPreparationLifetime,
  type PreparedHostPreparationLifetime,
} from "../../execution/preparation/preparedHostRuntime";
import {
  frameworkSchemaTargetSnapshot,
  type FrameworkSchemaTarget,
} from "../../installation/frameworkSchema/target";
import { scopePhysicalLocatorsEqual } from "../../scope/scopePhysicalLocator";
import {
  prepareInstallationRuntime,
  acceptPreparedInstallation,
  type PreparedInstallationRuntime,
} from "../../installation/frameworkSchema/installation/runtime";
import type { InstallationRuntimeData } from "../../installation/frameworkSchema/installation/runtimeData";
import { bindingInstallationReference } from "../../installation/frameworkSchema/binding/model";
import { runRelationalSession, type RelationalSession } from "../../database/relationalTransaction/session";
import { lockScopeClockForShareInTransactionEffect } from "../../scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../scope/scopeAuthorityResolution";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../database/locatedTransactionIdentity";
import { verifyPayloadPreferenceStorageBinding } from "../payloadPreferences/binding";
import { Effect, Option, Schema, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type {
  LocatedAppUniqueConstraintDefinitionV1,
} from "../../storage/unique/appUniqueConstraintDefinitions";
import type { LocatedAppIndexDefinitionV1 } from "../../storage/indexes/appIndexDefinitions";
import {
  captureApplicationWritePolicyData,
  PayloadConfigurationSchema,
  type PayloadConfiguration,
  type ApplicationWritePolicyError,
} from "@flarex/analysis/internal/application-write-policy";
import type {
  ApplicationBindingInput,
  AcceptedApplicationBinding,
  ApplicationBindingObservation,
} from "../../application/activation/contracts";
import {
  lendApplicationBindingPreparationInputs,
} from "../../application/activation/bindingPreparation";
import { readApplicationBindingTargetProtection } from "../../application/activation/selectionIdentity";
import {
  withAcceptedApplicationBinding,
} from "../../application/activation/bindingAcceptance";
import {
  type ApplicationRelationSchemaAuthority,
} from "../../application/relations/applicationRelationSchemaAuthority";
import { readAcceptedApplicationBindingProjection } from "../../application/applicationBindingProjection";
import {
  readBindingCandidate,
  readBindingHead,
  prepareBindingSelectedStructure,
  readPreparedBindingCandidate,
  type PreparedBindingSelectedStructure,
} from "../../installation/frameworkSchema/binding/repository";
import { sameBindingValue } from "../../installation/frameworkSchema/binding/canonical";
import { verifyAcceptedPayloadContentBinding } from "../../installation/frameworkSchema/binding/content";
import type {
  DataBindingSetFrame,
  DataBindingHeadToken,
} from "../../installation/frameworkSchema/binding/model";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type {
  TrustedScopeAuthority,
  ExactTrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import { cmsError, type CmsTransactionError } from "./model";
import { prepareLogicalWriteMechanics } from "../../storage/documents/logicalDocuments/workingSet";
import type {
  PreparedLogicalDocumentWriteMechanics,
  LogicalDocumentTable,
} from "../../storage/documents/logicalDocuments/model";
import {
  issueApplicationRevisionSyscallValidatorStateV1,
  sessionPinnedSyscallValidatorState,
  revokeApplicationRevisionSyscallValidatorStateV1,
  type ApplicationRevisionSyscallValidatorV1,
} from "../../application/revision/applicationRevisionSyscallValidatorStateV1";
import type { CatalogTableId } from "flarex-protocol/catalog";

declare const admissionBrand: unique symbol;
export interface CmsAdmission { readonly [admissionBrand]: true }
declare const cmsPreparationBrand: unique symbol;
export interface PreparedCmsApplication { readonly [cmsPreparationBrand]: true }
export interface PreparedCmsApplicationState {
  readonly lifetime: PreparedHostPreparationLifetime;
  readonly controlDb: FlarexMetadataDatabase;
  readonly scopeId: ScopeId;
  readonly configuration: PayloadConfiguration;
  readonly selection: ApplicationBindingInput;
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly indexDefinitions: readonly LocatedAppIndexDefinitionV1[];
  readonly intrinsicDefinitions: readonly LocatedAppIndexDefinitionV1[];
  readonly relations: Readonly<{ port: import("../../application/relations/applicationRelationCommit").ApplicationRelationCommitPort;
    definitions: import("../../application/relations/applicationRelationCommit").LocatedApplicationRelationDefinitionSet }>;
  readonly tables: readonly LogicalDocumentTable[];
  readonly tableIds: ReadonlySet<CatalogTableId>;
  readonly validator: ApplicationRevisionSyscallValidatorV1;
  readonly writeMechanics: PreparedLogicalDocumentWriteMechanics;
  readonly bindingStructure: PreparedBindingSelectedStructure | undefined;
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
  readonly preparation: PreparedCmsApplicationState;
}
export interface PreparedCmsPreferences {
  readonly target: FrameworkSchemaTarget;
  readonly installation: PreparedInstallationRuntime;
}
const admissions = new WeakMap<object, CmsAdmissionState>();
const prepared = new WeakMap<PreparedCmsApplication, PreparedCmsApplicationState>();
const disposeCmsPreparation = (token: PreparedCmsApplication, validator: ApplicationRevisionSyscallValidatorV1) => () => {
  prepared.delete(token);
  revokeApplicationRevisionSyscallValidatorStateV1(validator);
};
const isPayloadConfiguration = Schema.is(PayloadConfigurationSchema);

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
export type CmsApplicationPreparationError = CmsTransactionError | ApplicationWritePolicyError |
  Effect.Error<ReturnType<typeof lendApplicationBindingPreparationInputs>>;
export const prepareCmsApplicationFromBinding = Effect.fn("CmsAdmission.prepare")(function* (
  selection: ApplicationBindingInput,
  controlDb: FlarexMetadataDatabase,
  deploymentId: string, selectedScopeId: ScopeId,
): Effect.fn.Return<PreparedCmsApplication, CmsApplicationPreparationError> {
  const lifetime = yield* captureHostPreparationLifetime();
  if (lifetime === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause => cmsError("closed", cause)));
  const { schema, manifest, authority, indexes, unique, relations } = yield* lendApplicationBindingPreparationInputs(selection, controlDb);
  const scopeId = authority.scopeId;
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
  const selected = new Set(schema.writePolicy.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId));
  const uniqueDefinitions = Object.freeze(unique.filter(definition => selected.has(definition.tableId)));
  const indexDefinitions = Object.freeze(indexes.filter(definition => definition.access.kind === "developer" && selected.has(definition.access.tableId)));
  const intrinsicDefinitions = Object.freeze(indexes.filter(definition => definition.access.kind === "by_creation_time" && selected.has(definition.access.tableId)));
  const tables = Object.freeze(schema.tables.filter(table => selected.has(table.tableId)));
  const writeMechanics = yield* prepareLogicalWriteMechanics({ tables, indexes: indexDefinitions, unique: uniqueDefinitions }, cmsError);
  const validatorState = sessionPinnedSyscallValidatorState({ scopeId, schemaVersionId: schema.schemaVersionId,
    schemaManifest: schema.manifest });
  yield* chargeHostPreparation({ validatorTables: [...validatorState.tablesByName.values()],
    selectedTableIds: [...selected], indexes: indexDefinitions.map(definition => definition.indexDefinitionId),
    intrinsic: intrinsicDefinitions.map(definition => definition.indexDefinitionId),
    unique: uniqueDefinitions.map(definition => definition.uniqueConstraintDefinitionId) }).pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  const target = yield* Effect.fromResult(readApplicationBindingTargetProtection(selection)).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const protection = target.protection ?? target.readinessProtection?.target;
  // Only the original Application issuer and this same bounded generation can
  // protect immutable binding structure. Unprotected admission rereads it fully.
  if (protection !== undefined && (target.lifetime === undefined || target.lifetime.charge !== lifetime.charge ||
    target.lifetime.onDispose !== lifetime.onDispose)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const bindingStructure = protection === undefined ? undefined : yield* Effect.fromResult(
    prepareBindingSelectedStructure(authority, protection, target.lifetime)).pipe(
      Effect.mapError(cause => cmsError(cause.reason === "resourceFailure" ? "resourceFailure" : "invalidAuthority", cause)));
  const validator = yield* Effect.sync(() => issueApplicationRevisionSyscallValidatorStateV1(validatorState));
  // SAFETY: this original preparation issuer authenticates the inert identity.
  const value = Object.freeze({}) as PreparedCmsApplication;
  prepared.set(value, Object.freeze({ selection, schema, configuration, uniqueDefinitions, indexDefinitions, intrinsicDefinitions,
    controlDb, scopeId, lifetime, relations, tables, tableIds: selected, validator, writeMechanics, bindingStructure }));
  const dispose = disposeCmsPreparation(value, validator);
  const registered = lifetime.onDispose(dispose);
  if (Result.isFailure(registered)) dispose();
  yield* Effect.fromResult(registered).pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  return value;
});

/** The existing issuer lends payload only while its actual generation lives. */
export const requirePreparedCmsApplication = Effect.fnUntraced(function* (token: PreparedCmsApplication) {
  const state = prepared.get(token);
  if (state === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* Effect.fromResult(state.lifetime.checkOpen()).pipe(Effect.mapError(cause => cmsError("closed", cause)));
  return state;
}, work => observeExecution("CmsAdmission.requirePreparation", work, "caller"));

/** Called by the private host only after locking and authenticating the scope clock. */
export const withCmsAdmission = Effect.fnUntraced(function* <Value, Failure, Requirements>(
  application: PreparedCmsApplication,
  tx: FlarexMetadataTransaction,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  work: (admission: CmsAdmission) => Effect.Effect<Value, Failure, Requirements>,
  preferences?: PreparedCmsPreferences,
  observation?: ApplicationBindingObservation,
) {
  const preparation = yield* requirePreparedCmsApplication(application);
  if (!cmsClockMatches(authority, clock) || preparation.scopeId !== authority.scopeId)
    return yield* Effect.fail(cmsError("invalidAuthority"));
  return yield* withAcceptedApplicationBinding(preparation.selection, tx, clock, binding => Effect.gen(function* () {
    const projection = yield* readAcceptedApplicationBindingProjection(binding, tx, clock);
    const head = yield* readBindingHead(tx, authority, "share", preparation.bindingStructure);
    if (Option.isNone(head)) return yield* Effect.fail(cmsError("bindingChanged"));
    const candidate = yield* readPreparedBindingCandidate(tx, authority, head.value, preparation.bindingStructure);
    if (Option.isNone(candidate)) return yield* Effect.fail(cmsError("storedCorruption"));
    const frame = candidate.value.frame;
    if (!sameBindingValue(projection, frame.application)) return yield* Effect.fail(cmsError("bindingChanged"));
    if (frame.payloadContent === null || (frame.payloadLifecycle !== null && preferences === undefined) ||
      (frame.payloadLifecycle === null && preferences !== undefined) || commerceBindings(frame).length !== 0 ||
      projection.readiness.kind !== "policy" || projection.readiness.relationCount > 2) {
      return yield* Effect.fail(cmsError("unsupportedProfile"));
    }
    const schema = preparation.schema;
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
    admissions.set(token, Object.freeze({ binding, tx, authority, clock, schema, frame, preferenceAvailability,
      configuration: preparation.configuration, preparation,
      head: Object.freeze({ sequence: head.value.frame.sequence, sha256: head.value.sha256 }) }));
    return yield* Effect.suspend(() => work(token)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(token))));
  }), observation);
}, work => observeExecution("CmsAdmission.withTransaction", work, "caller"));

export const requireCmsAdmission = Effect.fnUntraced(function* (
  token: CmsAdmission,
  tx?: FlarexMetadataTransaction,
) {
  const state = admissions.get(token);
  if (state === undefined || (tx !== undefined && state.tx !== tx)) return yield* Effect.fail(cmsError("invalidAuthority"));
  return state;
}, work => observeExecution("CmsAdmission.require", work, "caller"));
import { commerceBindings } from "../../installation/frameworkSchema/binding/model";
