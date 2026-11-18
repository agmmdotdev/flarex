import { Effect, Option } from "effect";
import type {
  ApplicationBindingInput,
} from "../../application/activation/contracts";
import {
  isApplicationBindingPreparation,
} from "../../application/activation/selectionIdentity";
import {
  withAcceptedApplicationBinding,
} from "../../application/activation/bindingAcceptance";
import {
  type AcceptedApplicationBinding,
  type ApplicationBindingObservation,
} from "../../application/activation/contracts";
import {
  withApplicationBindingEvidenceInTransaction,
} from "../../application/applicationBindingProjection";
import {
  readAcceptedApplicationBindingProjection,
  type ApplicationBindingReference,
} from "../../application/applicationBindingProjection";
import {
  readBindingCandidate,
  readBindingHead,
  readRetainedBindingActivation,
} from "../../installation/frameworkSchema/binding/repository";
import {
  verifyBindingApplicationReference,
} from "../../installation/frameworkSchema/binding/logicalSchema";
import { lockBindingInstallation } from "../../installation/frameworkSchema/binding/evidence";
import { installationRuntimeData } from "../../installation/frameworkSchema/installation/runtimeData";
import {
  acceptPreparedInstallation,
  type PreparedInstallationRuntime,
} from "../../installation/frameworkSchema/installation/runtime";
import { sameBindingValue } from "../../installation/frameworkSchema/binding/canonical";
import { validateCommerceProfileSet } from "../../installation/frameworkSchema/binding/commerceBinding";
import type {
  InstallationBindingReference,
  DataBindingHeadToken,
} from "../../installation/frameworkSchema/binding/model";
import {
  commerceBindings,
  bindingInstallationReference,
} from "../../installation/frameworkSchema/binding/model";
import {
  frameworkSchemaTargetSnapshot,
  type FrameworkSchemaTarget,
} from "../../installation/frameworkSchema/target";
import { scopePhysicalLocatorsEqual } from "../../scope/scopePhysicalLocator";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import {
  lockScopeClockForOrdinaryWriteInTransactionEffect,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
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
type PublicationEntry = Readonly<{ kind: "entering" }> | Readonly<{ kind: "entered"; clock: ScopeClockRecord }>;
const publicationEntries = new WeakMap<CommerceAdmission, PublicationEntry>();

export const withCommerceAdmission = Effect.fn("CommerceAdmission.withTransaction")(function* <Value, Failure, Requirements>(
  profile: CommerceProfile, target: FrameworkSchemaTarget, reference: InstallationBindingReference,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  clock: ScopeClockRecord, bootstrap: boolean, prepared: PreparedInstallationRuntime | undefined,
  work: (admission: CommerceAdmission, binding?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  observation?: ApplicationBindingObservation,
) {
  return yield* withCommerceInstallationAdmissions([profile], target, reference, selection, tx, authority, clock, bootstrap, prepared,
    (admitted, binding): Effect.Effect<Value, Failure | ReturnType<typeof commerceError>, Requirements> => {
      const admission = admitted[0];
      return admission === undefined ? Effect.fail(commerceError("invalidAuthority")) : work(admission, binding);
    }, observation);
});

/** Several confined profiles may borrow one physical installation. This is an
 * owner-local transaction scope, not an exported physical authority token. */
export const withCommerceInstallationAdmissions = Effect.fn("CommerceAdmission.withInstallation")(function* <Value, Failure, Requirements>(
  profiles: readonly CommerceProfile[], target: FrameworkSchemaTarget, reference: InstallationBindingReference,
  selection: ApplicationBindingInput, tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  clock: ScopeClockRecord, bootstrap: boolean, prepared: PreparedInstallationRuntime | undefined,
  work: (admissions: readonly CommerceAdmission[], binding?: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  observation?: ApplicationBindingObservation,
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
      // A snapshot may predate a binding transition that finished before the
      // scope lock. Lock the head to refuse stale membership at admission.
      const current = yield* readBindingHead(tx, authority, "share");
      if (Option.isNone(current)) return yield* Effect.fail(commerceError("bindingChanged"));
      const candidate = yield* readBindingCandidate(tx, authority, current.value.frame.candidateSha256);
      if (Option.isNone(candidate)) return yield* Effect.fail(commerceError("storedCorruption"));
      const binding = commerceBindings(candidate.value.frame).find(value => value.installation.installationSha256 === reference.installation.installationSha256);
      if (binding === undefined) return yield* Effect.fail(commerceError("bindingChanged"));
      const activation = yield* readRetainedBindingActivation(tx, authority, {
        sequence: current.value.frame.sequence, sha256: current.value.frame.activationSha256,
        candidateSha256: candidate.value.sha256, headSha256: current.value.sha256,
      }).pipe(Effect.mapError(cause => commerceError(
        cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause)));
      if (Option.isNone(activation)) return yield* Effect.fail(commerceError("storedCorruption"));
      yield* Effect.fromResult(verifyBindingApplicationReference(candidate.value.frame.application, application,
        { kind: "activated", activation: activation.value }))
        .pipe(Effect.mapError(cause => commerceError("bindingChanged", cause)));
      const selected = bindingInstallationReference(binding);
      if (!sameBindingValue(reference, selected)) return yield* Effect.fail(commerceError("bindingChanged"));
      for (const profile of profiles) yield* verifyCommerceBinding(tx, authority.scopeId, profile, binding, availability);
      head = Object.freeze({ sequence: current.value.frame.sequence, sha256: current.value.sha256 });
    }
    const tokens = Object.freeze(descriptors.map(descriptor => {
      // SAFETY: the registry alone grants authority and revokes it with the physical transaction.
      const token = Object.freeze({}) as CommerceAdmission;
      admissions.set(token, Object.freeze({ tx, authority, clock, reference, descriptor, head, bootstrap }));
      return token;
    }));
    return yield* Effect.suspend(() => work(tokens, accepted)).pipe(Effect.ensuring(Effect.sync(() => {
      for (const token of tokens) {
        publicationEntries.delete(token);
        admissions.delete(token);
      }
    })));
  });
  // Keep installation locks before Application acceptance. Standalone selections
  // retain their existing independent validation contract.
  if (isApplicationBindingPreparation(selection)) return yield* withAcceptedApplicationBinding(selection, tx, clock,
    accepted => readAcceptedApplicationBindingProjection(accepted, tx, clock).pipe(Effect.flatMap(application => admit(application, accepted))), observation);
  return yield* withApplicationBindingEvidenceInTransaction(selection, tx, clock,
    (evidence, accepted) => admit(evidence.projection, accepted), observation);
});

export const requireCommerceAdmission = Effect.fn("CommerceAdmission.require")(function* (admission: CommerceAdmission) {
  const state = admissions.get(admission);
  if (state === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  return state;
});

/** Trusted roots enter once, after metadata admission and before any business SQL.
 * Admission samples remain immutable because accepted binding proofs pin them. */
export const enterCommercePublication = Effect.fn("CommerceAdmission.enterPublication")(function* (
  members: readonly CommerceAdmission[],
) {
  const captured = Object.freeze([...members]);
  const first = captured[0];
  if (first === undefined || new Set(captured).size !== captured.length)
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const root = admissions.get(first);
  if (root === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const states: AdmissionState[] = [];
  // Validate and reserve without yielding, so overlapping entry cannot pass twice.
  for (const member of captured) {
    const state = admissions.get(member);
    if (state === undefined || publicationEntries.has(member) || state.tx !== root.tx || state.authority !== root.authority ||
      state.clock !== root.clock || state.bootstrap !== root.bootstrap)
      return yield* Effect.fail(commerceError("invalidAuthority"));
    states.push(state);
  }
  const pending: PublicationEntry = Object.freeze({ kind: "entering" });
  for (const member of captured) publicationEntries.set(member, pending);
  return yield* Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(root.tx, root.authority.scopeId)
      .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
    const admitted = root.clock;
    if (clock.scopeId !== admitted.scopeId || clock.epoch !== admitted.epoch ||
      clock.storageGeneration !== admitted.storageGeneration || clock.storageGenerationFence !== admitted.storageGenerationFence ||
      clock.oldestAvailableCommitSeq !== admitted.oldestAvailableCommitSeq || clock.lastCommitSeq < admitted.lastCommitSeq ||
      captured.some((member, index) => admissions.get(member) !== states[index] || publicationEntries.get(member) !== pending))
      return yield* Effect.fail(commerceError("invalidAuthority"));
    const entered: PublicationEntry = Object.freeze({ kind: "entered", clock });
    for (const member of captured) publicationEntries.set(member, entered);
    return clock;
  }).pipe(Effect.ensuring(Effect.sync(() => {
    for (const member of captured) if (publicationEntries.get(member) === pending) publicationEntries.delete(member);
  })));
});

/** An admitted read or metadata-only preparation cannot authorize business writes. */
export const requireCommercePublication = Effect.fn("CommerceAdmission.requirePublication")(function* (
  admission: CommerceAdmission,
) {
  yield* requireCommerceAdmission(admission);
  const entry = publicationEntries.get(admission);
  if (entry?.kind !== "entered") return yield* Effect.fail(commerceError("invalidAuthority"));
  return entry.clock;
});
