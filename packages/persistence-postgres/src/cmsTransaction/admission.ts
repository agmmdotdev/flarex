import { frameworkMigrationTargetSnapshot, type FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import { scopePhysicalLocatorsEqual } from "../scopePhysicalLocator";
import { lockBindingInstallation } from "../frameworkSchema/binding/evidence";
import { verifyPayloadPreferenceBinding } from "../payloadPreferences/binding";
import { Effect, Option } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { ApplicationActiveSelection, ApplicationBindingSelectionReader } from "../applicationActivation";
import { claimApplicationExecutableActiveSelection, hasApplicationBindingComposition } from "../applicationActivation";
import { createApplicationRelationSchemaAuthorityPort, type ApplicationRelationSchemaAuthority } from "../applicationRelationSchemaAuthority";
import { readApplicationBindingProjectionInTransaction } from "../applicationBindingProjection";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { verifyPayloadContentBinding } from "../frameworkSchema/binding/content";
import type { DataBindingSetFrame, DataBindingHeadToken } from "../frameworkSchema/binding/model";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import type { TrustedScopeAuthority, TrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { cmsError } from "./model";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../frameworkSchema/installation/storedMetadataRestoration";
import { requireCompositeBinding, type CompositeBinding } from "../crossDomainCommand/binding";

declare const admissionBrand: unique symbol;
export interface CmsAdmission { readonly [admissionBrand]: true }
export interface PreparedCmsApplication {
  readonly selection: ApplicationActiveSelection;
  readonly schema: ApplicationRelationSchemaAuthority;
}
export interface CmsAdmissionState {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly frame: DataBindingSetFrame;
  readonly head: DataBindingHeadToken;
  readonly preferenceAvailability: RestoredFrameworkSchemaAvailabilityHead | null;
}
const admissions = new WeakMap<object, CmsAdmissionState>();
const prepared = new WeakSet<object>();

/** Control evidence is captured before opening the target data transaction. */
export const prepareCmsApplication = Effect.fn("CmsAdmission.prepare")(function* <Failure>(
  application: ApplicationBindingSelectionReader<Failure>,
  authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>,
  controlDb: FlarexMetadataDatabase,
  deploymentId: string,
) {
  if (!hasApplicationBindingComposition(application, authority)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const active = yield* application.readActive();
  const selection = yield* Effect.fromResult(claimApplicationExecutableActiveSelection(active.selection));
  if (selection.kind !== "relation" || selection.basis.deploymentId !== deploymentId ||
    selection.basis.writeOwnership === null || selection.basis.relationCount > 2) {
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  }
  const manifest = selection.basis.manifest;
  if (manifest.version !== 3 || selection.basis.relationCount !==
    ({ "payload.scalar": 0, "payload.content-relations": 1, "payload.content-many": 2, "payload.content-joins": 2 }[manifest.schema.writePolicies.configuration.profile])) {
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  }
  const schema = yield* createApplicationRelationSchemaAuthorityPort(controlDb).resolve({
    deploymentId,
    applicationManifestSha256: encodeBytesToLowercaseHex(selection.basis.manifestSha256),
    manifest: selection.basis.manifest,
  });
  const value: PreparedCmsApplication = Object.freeze({ selection: active.selection, schema });
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
  preferenceTarget?: FrameworkMigrationTarget,
  composite?: CompositeBinding,
) {
  if (!prepared.has(application) || clock.scopeId !== authority.scopeId ||
    clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence ||
    clock.epoch !== authority.epoch) return yield* Effect.fail(cmsError("invalidAuthority"));
  const projection = yield* readApplicationBindingProjectionInTransaction(application.selection, tx, clock);
  const head = yield* readBindingHead(tx, authority, false);
  if (Option.isNone(head)) return yield* Effect.fail(cmsError("bindingChanged"));
  const candidate = yield* readBindingCandidate(tx, authority, head.value.frame.candidateSha256);
  if (Option.isNone(candidate)) return yield* Effect.fail(cmsError("storedCorruption"));
  const frame = candidate.value.frame;
  if (!sameBindingValue(projection, frame.application)) return yield* Effect.fail(cmsError("bindingChanged"));
  if (frame.payloadContent === null || (frame.payloadLifecycle !== null && preferenceTarget === undefined) ||
    (frame.payloadLifecycle === null && preferenceTarget !== undefined) || (frame.commerce !== null && composite === undefined) ||
    projection.readiness.kind !== "policy" || projection.readiness.relationCount > 2) {
    return yield* Effect.fail(cmsError("unsupportedProfile"));
  }
  if (composite !== undefined) {
    if (frame.payloadLifecycle !== null || projection.readiness.relationCount !== 0) return yield* Effect.fail(cmsError("unsupportedProfile"));
    yield* requireCompositeBinding(composite, tx, clock, frame, { sequence: head.value.frame.sequence, sha256: head.value.sha256 })
      .pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  }
  const schema = application.schema;
  if (schema.schemaVersionId !== projection.schemaVersionId || schema.applicationSchemaSha256 !== projection.applicationSchemaSha256 ||
    schema.schemaManifestSha256 !== projection.schemaManifestSha256 ||
    schema.manifestSchemaBindingSha256 !== projection.readiness.manifestSchemaBindingSha256 ||
    schema.boundPublicationSha256 !== projection.readiness.boundPublicationSha256 ||
    schema.writePolicy?.writePolicySetSha256 !== projection.readiness.writePolicySetSha256) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  yield* verifyPayloadContentBinding(tx, frame, application.selection);
  let preferenceAvailability: RestoredFrameworkSchemaAvailabilityHead | null = null;
  if (preferenceTarget !== undefined && frame.payloadLifecycle !== null) {
    const snapshot = frameworkMigrationTargetSnapshot(preferenceTarget);
    if (snapshot === undefined || snapshot.namespace.frame.deploymentId !== authority.deploymentId ||
      !scopePhysicalLocatorsEqual(snapshot.physicalLocator, authority.physicalLocator)) return yield* Effect.fail(cmsError("invalidAuthority"));
    const availability = yield* lockBindingInstallation(tx, frame.payloadLifecycle, snapshot);
    yield* verifyPayloadPreferenceBinding(frame, availability);
    preferenceAvailability = availability;
  }
  // SAFETY: authority resides exclusively in this live, transaction-bound registry.
  const token = Object.freeze({}) as CmsAdmission;
  admissions.set(token, Object.freeze({ tx, authority, clock, schema, frame, preferenceAvailability,
    head: Object.freeze({ sequence: head.value.frame.sequence, sha256: head.value.sha256 }) }));
  return yield* Effect.suspend(() => work(token)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(token))));
});

export const requireCmsAdmission = Effect.fn("CmsAdmission.require")(function* (
  token: CmsAdmission,
  tx?: FlarexMetadataTransaction,
) {
  const state = admissions.get(token);
  if (state === undefined || (tx !== undefined && state.tx !== tx)) return yield* Effect.fail(cmsError("invalidAuthority"));
  return state;
});
