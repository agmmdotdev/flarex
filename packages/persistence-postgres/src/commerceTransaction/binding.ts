import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { InstallationBindingReference, CommerceBinding } from "../frameworkSchema/binding/model";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { validateReadinessCoverage } from "../frameworkSchema/binding/profiles";
import type { InstallationRuntimeData } from "../frameworkSchema/installation/runtimeData";
import { requireCommerceProfile, type CommerceProfile } from "./profile";
import { commerceError } from "./model";
import { fxSystemFrameworkInitializations } from "../frameworkSchema/installation/initializationSchema";

export const verifyCommerceInstallation = Effect.fn("CommerceBinding.verifyInstallation")(function* (
  profile: CommerceProfile, binding: InstallationBindingReference, availability: InstallationRuntimeData,
) {
  const descriptor = yield* requireCommerceProfile(profile);
  if (!sameBindingValue({ ...descriptor.artifact.identity }, binding.installation.artifact) ||
    availability.admissionProfile !== "registered-commerce-fresh" ||
    descriptor.layout.canonicalJson !== availability.physicalLayoutCanonicalJson) {
    return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  return descriptor;
});

export const verifyCommerceBinding = Effect.fn("CommerceBinding.verify")(function* (
  tx: FlarexMetadataTransaction, scopeId: string, profile: CommerceProfile,
  binding: CommerceBinding, availability: InstallationRuntimeData,
) {
  const descriptor = yield* verifyCommerceInstallation(profile, binding, availability);
  if (!binding.profiles.some(item => item.profileId === descriptor.profileId && item.contractSha256 === descriptor.contractSha256)) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  yield* validateReadinessCoverage(binding.coverage, availability.readiness);
  if (descriptor.initialization === null) return;
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId)).pipe(Effect.mapError(cause => commerceError("invalidAuthority", cause)));
  const rows = yield* runDrizzleStatementEffect(tx.select().from(fxSystemFrameworkInitializations).where(and(
    eq(fxSystemFrameworkInitializations.scopeUuid, scope.scopeUuid), eq(fxSystemFrameworkInitializations.installationSha256, binding.installation.installationSha256),
    eq(fxSystemFrameworkInitializations.stepId, descriptor.initialization.stepId),
  )).limit(2), cause => commerceError("statementFailure", cause));
  const seed = rows[0];
  if (rows.length !== 1 || seed === undefined) return yield* Effect.fail(commerceError("seedRequired"));
  if (seed.artifactSha256 !== descriptor.artifact.identity.artifactSha256 || seed.datasetSha256 !== descriptor.initialization.datasetSha256 ||
    seed.contractSha256 !== descriptor.contractSha256 || seed.rowCount !== descriptor.initialization.expectedRowCount) {
    return yield* Effect.fail(commerceError("seedMismatch"));
  }
});
