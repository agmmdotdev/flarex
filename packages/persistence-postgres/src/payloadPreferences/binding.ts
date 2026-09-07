import { Effect } from "effect";
import type { DataBindingSetFrame } from "../frameworkSchema/binding/model";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../frameworkSchema/installation/storedMetadataRestoration";
import { bindingError } from "../frameworkSchema/binding/errors";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { capturePrivateCanonicalValue } from "../frameworkSchema/privateCanonicalValue";
import { payloadScalarProvenance, payloadContentConfiguration, type PayloadContentProfile } from "../payloadScalar/contract";
import { capturePayloadPreferenceArtifact } from "./schema";

const errors = { invalidInput: () => bindingError("invalidInput"), hashFailure: (cause: unknown) => bindingError("resourceFailure", cause) };
export const capturePayloadPreferenceProfile = Effect.fn("PayloadPreferences.captureProfile")(function* (deploymentId: string, contentProfile: PayloadContentProfile = "payload.scalar") {
  const captured = yield* capturePayloadPreferenceArtifact(deploymentId);
  const provenance = yield* capturePrivateCanonicalValue(payloadScalarProvenance, 4096, errors);
  const config = yield* capturePrivateCanonicalValue(payloadContentConfiguration(contentProfile, provenance.sha256Hex), 4096, errors);
  return { artifact: captured.artifact, schema: captured.schema, configSha256: config.sha256Hex, provenanceSha256: provenance.sha256Hex,
    profile: { kind: "adapter", profileId: "payload-preferences-binding", contractSha256: captured.artifact.identity.artifactSha256, coverage: [] } as const };
});

/** Validates a closed storage binding only; no query/store/cleanup capability is issued. */
export const verifyPayloadPreferenceBinding = Effect.fn("PayloadPreferences.verifyBinding")(function* (
  frame: DataBindingSetFrame, availability: RestoredFrameworkSchemaAvailabilityHead,
) {
  const binding = frame.payloadLifecycle;
  const content = frame.payloadContent;
  if (binding === null || content === null || frame.commerce !== null) return yield* Effect.fail(bindingError("unsupportedProfile"));
  const count = frame.application.readiness.kind === "policy" ? frame.application.readiness.relationCount : -1;
  if (count !== 0 && count !== 1 && count !== 2) return yield* Effect.fail(bindingError("unsupportedProfile"));
  const expected = yield* capturePayloadPreferenceProfile(binding.installation.artifact.deploymentId, count === 0 ? "payload.scalar" : count === 1 ? "payload.content-relations" : "payload.content-many");
  if (content.configSha256 !== expected.configSha256 || content.provenanceSha256 !== expected.provenanceSha256 ||
    !sameBindingValue(binding.installation.artifact, { ...expected.artifact.identity }) ||
    binding.profiles.length !== 1 || binding.profiles[0] === undefined || !sameBindingValue(binding.profiles[0], expected.profile) ||
    availability.installation.plan.plan.frame.version !== 1 ||
    availability.installation.admission.admission.frame.admissionProfile !== "payload-preferences-fresh" ||
    availability.readiness.readiness.frame.residualRequirements.length !== 0) {
    return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
});
