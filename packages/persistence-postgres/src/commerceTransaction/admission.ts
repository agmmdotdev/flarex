import { Effect, Option } from "effect";
import type { ApplicationBindingInput } from "../applicationActivation";
import { isApplicationBindingPreparation, withAcceptedApplicationBinding, type AcceptedApplicationBinding } from "../applicationActivation";
import { readApplicationBindingProjectionInTransaction } from "../applicationBindingProjection";
import { readAcceptedApplicationBindingProjection, type ApplicationBindingReference } from "../applicationBindingProjection";
import { readBindingCandidate, readBindingHead } from "../frameworkSchema/binding/repository";
import { lockBindingInstallation } from "../frameworkSchema/binding/evidence";
import { installationRuntimeData } from "../frameworkSchema/installation/runtimeData";
import { acceptPreparedInstallation, type PreparedInstallationRuntime } from "../frameworkSchema/installation/runtime";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { validateCommerceProfileSet } from "../frameworkSchema/binding/commerceBinding";
import type { InstallationBindingReference, DataBindingHeadToken } from "../frameworkSchema/binding/model";
import { commerceBindings, bindingInstallationReference } from "../frameworkSchema/binding/model";
import { frameworkSchemaTargetSnapshot, type FrameworkSchemaTarget } from "../frameworkSchema/target";
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
  profile: CommerceProfile, target: FrameworkSchemaTarget, reference: InstallationBindingReference,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  clock: ScopeClockRecord, bootstrap: boolean, prepared: PreparedInstallationRuntime | undefined,
  work: (admission: CommerceAdmission, binding?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
) {
  return yield* withCommerceInstallationAdmissions([profile], target, reference, selection, tx, authority, clock, bootstrap, prepared,
    (admitted, binding): Effect.Effect<Value, Failure | ReturnType<typeof commerceError>, Requirements> => {
      const admission = admitted[0];
      return admission === undefined ? Effect.fail(commerceError("invalidAuthority")) : work(admission, binding);
    });
});

/** Several confined profiles may borrow one physical installation. This is an
 * owner-local transaction scope, not an exported physical authority token. */
export const withCommerceInstallationAdmissions = Effect.fn("CommerceAdmission.withInstallation")(function* <Value, Failure, Requirements>(
  profiles: readonly CommerceProfile[], target: FrameworkSchemaTarget, reference: InstallationBindingReference,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  clock: ScopeClockRecord, bootstrap: boolean, prepared: PreparedInstallationRuntime | undefined,
  work: (admissions: readonly CommerceAdmission[], binding?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
) {
  const snapshot = frameworkSchemaTargetSnapshot(target);
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
  if (profiles.length === 0) return yield* Effect.fail(commerceError("invalidAuthority"));
  const descriptors = yield* Effect.forEach(profiles, profile => verifyCommerceInstallation(profile, reference, availability));
  yield* validateCommerceProfileSet(descriptors);
  const admit = Effect.fn("CommerceAdmission.admitBinding")(function* (application: ApplicationBindingReference, accepted?: AcceptedApplicationBinding) {
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
      for (const profile of profiles) yield* verifyCommerceBinding(tx, authority.scopeId, profile, binding, availability);
      head = Object.freeze({ sequence: current.value.frame.sequence, sha256: current.value.sha256 });
    }
    const tokens = descriptors.map(descriptor => {
      // SAFETY: the registry alone grants authority and revokes it with the physical transaction.
      const token = Object.freeze({}) as CommerceAdmission;
      admissions.set(token, Object.freeze({ tx, authority, clock, reference, descriptor, head, bootstrap }));
      return token;
    });
    return yield* Effect.suspend(() => work(tokens, accepted)).pipe(Effect.ensuring(Effect.sync(() => {
      for (const token of tokens) admissions.delete(token);
    })));
  });
  // Keep installation locks before Application acceptance. Standalone selections
  // retain their existing independent validation contract.
  if (isApplicationBindingPreparation(selection)) return yield* withAcceptedApplicationBinding(selection, tx, clock,
    accepted => readAcceptedApplicationBindingProjection(accepted, tx, clock).pipe(Effect.flatMap(application => admit(application, accepted))));
  return yield* readApplicationBindingProjectionInTransaction(selection, tx, clock).pipe(Effect.flatMap(application => admit(application)));
});

export const requireCommerceAdmission = Effect.fn("CommerceAdmission.require")(function* (admission: CommerceAdmission) {
  const state = admissions.get(admission);
  if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  return state;
});
