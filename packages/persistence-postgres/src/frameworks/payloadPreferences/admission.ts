import { Effect, Option } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { frameworkSchemaTargetSnapshot, type FrameworkSchemaTarget } from "../../installation/frameworkSchema/target";
import { prepareInstallationRuntime, acceptPreparedInstallation, type PreparedInstallationRuntime } from "../../installation/frameworkSchema/installation/runtime";
import { bindingInstallationReference, type DataBindingSetFrame } from "../../installation/frameworkSchema/binding/model";
import { readBindingHead, readBindingCandidate } from "../../installation/frameworkSchema/binding/repository";
import { runRelationalSession, type RelationalSession } from "../../database/relationalTransaction/session";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { lockScopeClockForShareInTransactionEffect } from "../../scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect, type TrustedScopeAuthority, type ExactTrustedScopeAuthorityResolutionPorts } from "../../scope/scopeAuthorityResolution";
import { hasLocatedReadCommittedTargetDatabaseV1, type LocatedReadCommittedAttemptTargetV1 } from "../../database/locatedTransactionIdentity";
import { scopePhysicalLocatorsEqual } from "../../scope/scopePhysicalLocator";
import { verifyPayloadPreferenceStorageBinding } from "./binding";
import { cmsError } from "../cmsTransaction/model";
export interface PreparedCmsPreferences {
  readonly target: FrameworkSchemaTarget;
  readonly installation: PreparedInstallationRuntime;
}
export const acceptCmsPreferences = Effect.fn("CmsAdmission.acceptPreferences")(function* (
  preferences: PreparedCmsPreferences | undefined, frame: DataBindingSetFrame,
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
) {
  if (frame.payloadLifecycle === null) {
    if (preferences !== undefined) return yield* Effect.fail(cmsError("bindingChanged"));
    return null;
  }
  if (preferences === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
  const snapshot = frameworkSchemaTargetSnapshot(preferences.target);
  if (snapshot === undefined || snapshot.namespace.frame.deploymentId !== authority.deploymentId ||
    !scopePhysicalLocatorsEqual(snapshot.physicalLocator, authority.physicalLocator)) return yield* Effect.fail(cmsError("invalidAuthority"));
  const availability = yield* acceptPreparedInstallation(preferences.installation, preferences.target,
    bindingInstallationReference(frame.payloadLifecycle), tx);
  yield* verifyPayloadPreferenceStorageBinding(frame, availability);
  return availability;
});

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
    if ((clock.scopeId !== located.authority.scopeId || clock.storageGeneration !== located.authority.storageGeneration || clock.storageGenerationFence !== located.authority.storageGenerationFence || clock.epoch !== located.authority.epoch)) return yield* Effect.fail(cmsError("invalidAuthority"));
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
