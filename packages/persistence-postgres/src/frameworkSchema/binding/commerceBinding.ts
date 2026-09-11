import { Effect } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../../commerceTransaction/profile";
import { verifyCommerceInstallation } from "../../commerceTransaction/binding";
import { installationRuntimeData } from "../installation/runtimeData";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../installation/storedMetadataRestoration";
import { sameBindingValue } from "./canonical";
import { capturePrivateJsonData } from "../../privateJsonData";
import { compareBindingCoverage, isCommerceBinding } from "./commerceBindingSchema";
import { bindingError } from "./errors";
import { MAX_BINDING_BYTES, MAX_COMMERCE_BINDINGS } from "./model";

/** Membership is not a grant union. Cross-table effects must remain inside one profile. */
export const validateCommerceProfileSet = Effect.fn("CommerceBinding.validateProfileSet")(function* (
  descriptors: readonly CommerceProfileState[],
) {
  const first = descriptors[0];
  if (first === undefined || descriptors.length > MAX_COMMERCE_BINDINGS ||
    new Set(descriptors.map(value => value.profileId)).size !== descriptors.length ||
    descriptors.some(value => !sameBindingValue({ ...value.artifact.identity }, { ...first.artifact.identity }) ||
      value.layout.canonicalJson !== first.layout.canonicalJson)) {
    return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
  if (descriptors.length === 1) return;
  const owners = new Map<string, string>();
  for (const descriptor of descriptors) {
    if (!descriptor.localOnly || descriptor.initialization !== null) return yield* Effect.fail(bindingError("unsupportedProfile"));
    for (const table of descriptor.tables) {
      if (owners.has(table.tableId)) return yield* Effect.fail(bindingError("unsupportedProfile"));
      owners.set(table.tableId, descriptor.profileId);
    }
  }
  // Physical relationships resolve to these authenticated application-table FKs.
  // Scope-authority FKs have a separate kind and do not cross profile authority.
  for (const key of first.layout.frame.foreignKeys) {
    if (key.kind !== "foreignKey") continue;
    const source = owners.get(key.sourceTable.tableId);
    const target = owners.get(key.targetTable.tableId);
    if (source !== target && (source !== undefined || target !== undefined)) {
      return yield* Effect.fail(bindingError("unsupportedProfile"));
    }
  }
});

/** Trusted value construction only. Preparation/activation revalidate authoritative evidence. */
export const makeCommerceBinding = Effect.fn("CommerceBinding.make")(function* (
  availability: RestoredFrameworkSchemaAvailabilityHead,
  profiles: readonly CommerceProfile[],
) {
  const members = [...profiles];
  if (members.length === 0 || members.length > MAX_COMMERCE_BINDINGS) return yield* Effect.fail(bindingError("unsupportedProfile"));
  // Canonical frames are already owned/frozen. Capture the outer references before yielding.
  const runtime = installationRuntimeData(availability);
  const reference = {
    installation: availability.installation.installation.frame.identity,
    installationReceiptSha256: availability.installation.installation.sha256,
    readinessSha256: availability.readiness.readiness.sha256,
    availabilitySequence: availability.head.frame.availabilitySequence,
    availabilityHistorySha256: availability.history.history.sha256,
    status: availability.head.frame.status,
  };
  const descriptors: CommerceProfileState[] = [];
  for (const profile of members) {
    const descriptor = yield* requireCommerceProfile(profile).pipe(Effect.mapError(cause => bindingError("unsupportedProfile", cause)));
    if (reference.status !== "ready") return yield* Effect.fail(bindingError("unavailableInstallation"));
    yield* verifyCommerceInstallation(profile, { ...reference, status: "ready" }, runtime)
      .pipe(Effect.mapError(cause => bindingError("unsupportedProfile", cause)));
    descriptors.push(descriptor);
  }
  yield* validateCommerceProfileSet(descriptors);
  const coverage = [];
  for (const requirement of runtime.readiness.residualRequirements) {
    const physical = runtime.readiness.validatedPhysicalCapabilities.find(value => sameBindingValue(value.identity, requirement.capability));
    if (physical === undefined) return yield* Effect.fail(bindingError("unsupportedProfile"));
    coverage.push({ requirement, physical });
  }
  const captured = yield* Effect.fromResult(capturePrivateJsonData({ ...reference, coverage: coverage.toSorted(compareBindingCoverage),
    profiles: descriptors.map(({ profileId, contractSha256 }) => ({ profileId, contractSha256 }))
      .toSorted((a, b) => compareUtf16Strings(a.profileId, b.profileId)) }, MAX_BINDING_BYTES, () => bindingError("invalidInput")));
  if (!isCommerceBinding(captured.value)) return yield* Effect.fail(bindingError("invalidInput"));
  return captured.value;
});
