import { Effect } from "effect";
import type { DataBindingSetFrame } from "../frameworkSchema/binding/model";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../frameworkSchema/installation/storedMetadataRestoration";
import { bindingError } from "../frameworkSchema/binding/errors";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { commerceBindings } from "../frameworkSchema/binding/model";
import { capturePayloadPreferenceArtifact } from "./schema";

declare const payloadContentProfilesBrand: unique symbol;
export interface PayloadContentProfiles {
  readonly [payloadContentProfilesBrand]: true;
}
interface PayloadContentIdentity {
  readonly configSha256: string;
  readonly provenanceSha256: string;
}
interface PayloadContentProfileState {
  readonly profiles: readonly Readonly<{
    relationCount: 0 | 1 | 2;
    identity: PayloadContentIdentity;
  }>[];
}
const contentProfiles = new WeakMap<object, PayloadContentProfileState>();
const sha256Pattern = /^[0-9a-f]{64}$/;

/** Trusted adapter composition. The opaque token grants binding verification only. */
export const registerPayloadContentProfiles = Effect.fn("PayloadPreferences.registerContentProfiles")(function* (
  input: readonly Readonly<{ relationCount: 0 | 1 | 2; identity: PayloadContentIdentity }>[],
) {
  const counts = [0, 1, 2].map(relationCount => input.filter(profile => profile.relationCount === relationCount).length);
  if (input.length !== 4 || counts[0] !== 1 || counts[1] !== 1 || counts[2] !== 2 ||
    input.some(profile => !sha256Pattern.test(profile.identity.configSha256) || !sha256Pattern.test(profile.identity.provenanceSha256)) ||
    new Set(input.map(profile => profile.identity.configSha256)).size !== input.length ||
    new Set(input.map(profile => profile.identity.provenanceSha256)).size !== 1) {
    return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
  // SAFETY: only this WeakMap-backed issuer creates an admitted profile token.
  const token = Object.freeze({}) as PayloadContentProfiles;
  contentProfiles.set(token, Object.freeze({ profiles: Object.freeze(input.map(profile => Object.freeze({
    relationCount: profile.relationCount,
    identity: Object.freeze({ ...profile.identity }),
  }))) }));
  return token;
});

export const capturePayloadPreferenceProfile = Effect.fn("PayloadPreferences.captureProfile")(function* (deploymentId: string) {
  const captured = yield* capturePayloadPreferenceArtifact(deploymentId);
  return { artifact: captured.artifact, schema: captured.schema,
    profile: { kind: "adapter", profileId: "payload-preferences-binding", contractSha256: captured.artifact.identity.artifactSha256, coverage: [] } as const };
});

/** Validates lifecycle storage only; no content profile or cleanup capability is issued. */
export const verifyPayloadPreferenceStorageBinding = Effect.fn("PayloadPreferences.verifyStorageBinding")(function* (
  frame: DataBindingSetFrame,
  availability: RestoredFrameworkSchemaAvailabilityHead,
) {
  const binding = frame.payloadLifecycle;
  const content = frame.payloadContent;
  if (binding === null || content === null || commerceBindings(frame).length !== 0) return yield* Effect.fail(bindingError("unsupportedProfile"));
  const expected = yield* capturePayloadPreferenceProfile(binding.installation.artifact.deploymentId);
  if (!sameBindingValue(binding.installation.artifact, { ...expected.artifact.identity }) ||
    binding.profiles.length !== 1 || binding.profiles[0] === undefined || !sameBindingValue(binding.profiles[0], expected.profile) ||
    availability.installation.plan.plan.frame.version !== 1 ||
    availability.installation.admission.admission.frame.admissionProfile !== "payload-preferences-fresh" ||
    availability.readiness.readiness.frame.residualRequirements.length !== 0) {
    return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
});

/** Binding admission additionally requires one adapter-issued closed content profile. */
export const verifyPayloadPreferenceBinding = Effect.fn("PayloadPreferences.verifyBinding")(function* (
  frame: DataBindingSetFrame,
  availability: RestoredFrameworkSchemaAvailabilityHead,
  profiles: PayloadContentProfiles | undefined,
) {
  yield* verifyPayloadPreferenceStorageBinding(frame, availability);
  const content = frame.payloadContent;
  const count = frame.application.readiness.kind === "policy" ? frame.application.readiness.relationCount : -1;
  const selected = profiles === undefined ? undefined : contentProfiles.get(profiles);
  if (content === null || (count !== 0 && count !== 1 && count !== 2) || selected === undefined ||
    !selected.profiles.some(profile => profile.relationCount === count &&
      profile.identity.configSha256 === content.configSha256 && profile.identity.provenanceSha256 === content.provenanceSha256)) {
    return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
});
