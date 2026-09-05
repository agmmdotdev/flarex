import { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import { isExactPrivateValueRecord } from "../privateStoredValueShape";
import type { FlarexMetadataDatabase } from "../../deployments";
import type { FrameworkMigrationTarget } from "../../migrationCoordination/targetSession";
import { hasFrameworkMigrationTargetDatabase } from "../../migrationCoordination/targetSession";
import {
  captureBindingValue,
  isBindingProfileReference,
  sameBindingValue,
} from "./canonical";
import { bindingError } from "./errors";
import type { BindingProfileReference, PhysicalDataBinding } from "./model";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../installation/storedMetadataRestoration";

declare const profileRegistryBrand: unique symbol;
export interface DataBindingTestProfiles {
  readonly [profileRegistryBrand]: true;
}
interface ProfileState {
  readonly database: FlarexMetadataDatabase;
  readonly target: FrameworkMigrationTarget;
  readonly profiles: readonly BindingProfileReference[];
}
const registries = new WeakMap<object, ProfileState>();

/** Source-private fixture composition. No production profile issuer or package export exists. */
export const makeDataBindingTestProfiles = Effect.fn(
  "DataBindingProfiles.makeTestComposition",
)(function* (
  database: FlarexMetadataDatabase,
  target: FrameworkMigrationTarget,
  inputs: readonly unknown[],
) {
  if (
    !hasFrameworkMigrationTargetDatabase(target, database) ||
    inputs.length > 3
  )
    return yield* Effect.fail(bindingError("invalidAuthority"));
  const profiles: BindingProfileReference[] = [];
  for (const input of inputs) {
    // Profiles are not persisted frames; the envelope makes their canonical contract explicit.
    const captured = yield* captureBindingValue(
      {
        format: "flarex.data-binding-test-profile",
        version: 1,
        profile: input,
      },
      isTestProfileFrame,
    );
    profiles.push(captured.frame.profile);
  }
  // SAFETY: this inert token has authority only through the private registry below.
  const token = Object.freeze({}) as DataBindingTestProfiles;
  registries.set(
    token,
    Object.freeze({ database, target, profiles: Object.freeze(profiles) }),
  );
  return token;
});
function isTestProfileFrame(input: unknown): input is Readonly<{
  format: "flarex.data-binding-test-profile";
  version: 1;
  profile: BindingProfileReference;
}> &
  JsonObject {
  return (
    isExactPrivateValueRecord(input, ["format", "version", "profile"]) &&
    input.format === "flarex.data-binding-test-profile" &&
    input.version === 1 &&
    isBindingProfileReference(input.profile)
  );
}

export const validateBindingProfiles = Effect.fn(
  "DataBindingProfiles.validate",
)(function* (
  registry: DataBindingTestProfiles | undefined,
  database: FlarexMetadataDatabase,
  target: FrameworkMigrationTarget,
  binding: PhysicalDataBinding,
  availability: RestoredFrameworkSchemaAvailabilityHead,
) {
  const state = registry === undefined ? undefined : registries.get(registry);
  if (
    state === undefined ||
    state.database !== database ||
    state.target !== target
  )
    return yield* Effect.fail(bindingError("unsupportedProfile"));
  for (const profile of binding.profiles) {
    if (
      !state.profiles.some((registered) =>
        sameBindingValue(registered, profile),
      )
    )
      return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
  const readiness = availability.readiness.readiness.frame;
  const coverage = binding.profiles.flatMap((profile) => profile.coverage);
  for (const required of readiness.residualRequirements) {
    const physical = readiness.validatedPhysicalCapabilities.find((value) =>
      sameBindingValue(value.identity, required.capability),
    );
    if (
      physical === undefined ||
      !coverage.some(
        (value) =>
          sameBindingValue(value.requirement, required) &&
          sameBindingValue(value.physical, physical),
      )
    )
      return yield* Effect.fail(bindingError("unsupportedProfile"));
  }
  for (const item of coverage) {
    if (
      !readiness.residualRequirements.some((value) =>
        sameBindingValue(value, item.requirement),
      ) ||
      !readiness.validatedPhysicalCapabilities.some((value) =>
        sameBindingValue(value, item.physical),
      )
    ) {
      return yield* Effect.fail(bindingError("unsupportedProfile"));
    }
  }
});
