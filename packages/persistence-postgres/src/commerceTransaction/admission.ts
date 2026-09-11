import { Effect, Option } from "effect";
import type { ApplicationBindingInput } from "../applicationActivation";
import { readApplicationBindingProjectionInTransaction } from "../applicationBindingProjection";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { lockBindingInstallation } from "../frameworkSchema/binding/evidence";
import { installationRuntimeData } from "../frameworkSchema/installation/runtimeData";
import { acceptPreparedInstallation, type PreparedInstallationRuntime } from "../frameworkSchema/installation/runtime";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import type { InstallationBindingReference, DataBindingHeadToken } from "../frameworkSchema/binding/model";
import { commerceBindings, bindingInstallationReference } from "../frameworkSchema/binding/model";
import { frameworkMigrationTargetSnapshot, type FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import { scopePhysicalLocatorsEqual } from "../scopePhysicalLocator";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";
import type { CommerceProfile } from "./profile";
import { verifyCommerceBinding, verifyCommerceInstallation } from "./binding";
import { commerceError } from "./model";

declare const admissionBrand: unique symbol;
export interface CommerceAdmission { readonly [admissionBrand]: true }
interface AdmissionState {
  readonly tx: FlarexMetadataTransaction;
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
  readonly reference: InstallationBindingReference;
  readonly descriptor: Effect.Success<ReturnType<typeof verifyCommerceInstallation>>;
  readonly head: DataBindingHeadToken | null;
  readonly bootstrap: boolean;
}
const admissions = new WeakMap<object, AdmissionState>();

export const withCommerceAdmission = Effect.fn("CommerceAdmission.withTransaction")(function* <Value, Failure, Requirements>(
  profile: CommerceProfile, target: FrameworkMigrationTarget, reference: InstallationBindingReference,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  clock: ScopeClockRecord, bootstrap: boolean, prepared: PreparedInstallationRuntime | undefined,
  work: (admission: CommerceAdmission) => Effect.Effect<Value, Failure, Requirements>,
) {
  const snapshot = frameworkMigrationTargetSnapshot(target);
  if (snapshot === undefined || snapshot.namespace.frame.deploymentId !== authority.deploymentId ||
    !scopePhysicalLocatorsEqual(snapshot.physicalLocator, authority.physicalLocator) ||
    clock.scopeId !== authority.scopeId || clock.epoch !== authority.epoch ||
    clock.storageGeneration !== authority.storageGeneration || clock.storageGenerationFence !== authority.storageGenerationFence) {
    return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  // Standalone cross-domain composition retains its cold reader. A prepared host
  // explicitly supplies its own token; failed fresh comparison never falls back.
  const availability = prepared === undefined
    ? installationRuntimeData(yield* lockBindingInstallation(tx, reference, snapshot))
    : yield* acceptPreparedInstallation(prepared, target, reference, tx);
  const descriptor = yield* verifyCommerceInstallation(profile, reference, availability);
  const application = yield* readApplicationBindingProjectionInTransaction(selection, tx, clock);
  let head: DataBindingHeadToken | null = null;
  if (!bootstrap) {
    const current = yield* readBindingHead(tx, authority, false);
    if (Option.isNone(current)) return yield* Effect.fail(commerceError("bindingChanged"));
    const candidate = yield* readBindingCandidate(tx, authority, current.value.frame.candidateSha256);
    if (Option.isNone(candidate)) return yield* Effect.fail(commerceError("storedCorruption"));
    const binding = commerceBindings(candidate.value.frame).find(value => value.installation.installationSha256 === reference.installation.installationSha256);
    if (binding === undefined || !sameBindingValue(candidate.value.frame.application, application)) return yield* Effect.fail(commerceError("bindingChanged"));
    const selected = bindingInstallationReference(binding);
    if (!sameBindingValue(reference, selected)) return yield* Effect.fail(commerceError("bindingChanged"));
    yield* verifyCommerceBinding(tx, authority.scopeId, profile, binding, availability);
    head = Object.freeze({ sequence: current.value.frame.sequence, sha256: current.value.sha256 });
  }
  // SAFETY: the registry alone grants authority and revokes it with the physical transaction.
  const token = Object.freeze({}) as CommerceAdmission;
  admissions.set(token, Object.freeze({ tx, authority, clock, reference, descriptor, head, bootstrap }));
  return yield* Effect.suspend(() => work(token)).pipe(Effect.ensuring(Effect.sync(() => admissions.delete(token))));
});

export const requireCommerceAdmission = Effect.fn("CommerceAdmission.require")(function* (admission: CommerceAdmission) {
  const state = admissions.get(admission);
  if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  return state;
});
