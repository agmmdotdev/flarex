import type { ApplicationActiveSelection } from "../../applicationActivation";
import { verifyPayloadPreferenceBinding, type PayloadContentProfiles } from "../../payloadPreferences/binding";
import { Effect, Option } from "effect";
import { withAdditiveMigrationGraphLimits } from "../../migrationCoordination/additiveLimits";
import { withFrameworkMigrationPlanVerification } from "../../migrationCoordination/planVerificationScope";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type { FlarexMetadataDatabase } from "../../deployments";
import type {
  FrameworkMigrationTarget,
  FrameworkMigrationTargetSnapshot,
} from "../../migrationCoordination/targetSession";
import { lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect } from "../installation/availabilityHeadRepository";
import { sameBindingValue } from "./canonical";
import { bindingError } from "./errors";
import {
  physicalBindings,
  type DataBindingSetFrame,
  type InstallationBindingReference,
} from "./model";
import {
  validateBindingProfiles,
  type DataBindingTestProfiles,
} from "./profiles";
import type { VerifiedBindingLane } from "./repository";
import { scopePhysicalLocatorsEqual } from "../../scopePhysicalLocator";
import { verifyPayloadContentBinding } from "./content";
import { verifyCommerceBinding } from "../../commerceTransaction/binding";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../../commerceTransaction/profile";
import { MAX_COMMERCE_BINDINGS } from "./model";
import { installationRuntimeData } from "../installation/runtimeData";
import { validateCommerceProfileSet } from "./commerceBinding";

type CommerceBindingProfiles = readonly Readonly<{ profile: CommerceProfile; descriptor: CommerceProfileState }>[];
export const captureCommerceBindingProfiles = Effect.fn("DataBindingEvidence.captureCommerceProfiles")(function* (
  profiles: readonly CommerceProfile[],
) {
  const captured = [...profiles];
  if (captured.length > MAX_COMMERCE_BINDINGS) return yield* Effect.fail(bindingError("unsupportedProfile"));
  const values = [];
  const identities = new Set<string>();
  for (const profile of captured) {
    const descriptor = yield* requireCommerceProfile(profile).pipe(Effect.mapError(cause => bindingError("unsupportedProfile", cause)));
    const identity = `${descriptor.artifact.identity.artifactSha256}/${descriptor.contractSha256}`;
    if (identities.has(identity)) return yield* Effect.fail(bindingError("unsupportedProfile"));
    identities.add(identity);
    values.push(Object.freeze({ profile, descriptor }));
  }
  return Object.freeze(values);
});

export const lockBindingInstallation = Effect.fn(
  "DataBindingEvidence.lockInstallation",
)(function* (
  tx: FlarexMetadataTransaction,
  binding: InstallationBindingReference,
  target: FrameworkMigrationTargetSnapshot,
) {
  const identity = binding.installation;
  if (
    !sameBindingValue(identity.targetNamespace, target.namespace.frame) ||
    !scopePhysicalLocatorsEqual(
      identity.physicalLocator,
      target.physicalLocator,
    )
  )
    return yield* Effect.fail(bindingError("placementMismatch"));
  const availability =
    yield* lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect(
      tx,
      identity,
    );
  if (Option.isNone(availability))
    return yield* Effect.fail(bindingError("missingDependency"));
  const value = availability.value;
  if (
    value.head.frame.status !== "ready" ||
    value.head.frame.availabilitySequence !== binding.availabilitySequence ||
    value.head.frame.historySha256 !== binding.availabilityHistorySha256 ||
    value.readiness.readiness.sha256 !== binding.readinessSha256 ||
    value.installation.installation.sha256 !== binding.installationReceiptSha256
  ) {
    return yield* Effect.fail(bindingError("unavailableInstallation"));
  }
  return value;
}, withAdditiveMigrationGraphLimits, withFrameworkMigrationPlanVerification);

export const verifyBindingLanes = Effect.fn("DataBindingEvidence.verifyLanes")(
  function* (
    tx: FlarexMetadataTransaction,
    frame: DataBindingSetFrame,
    database: FlarexMetadataDatabase,
    target: FrameworkMigrationTarget,
    snapshot: FrameworkMigrationTargetSnapshot,
    profiles: DataBindingTestProfiles | undefined,
    selection: ApplicationActiveSelection,
    payloadProfiles: PayloadContentProfiles | undefined,
    commerceProfiles: CommerceBindingProfiles = [],
  ) {
    yield* verifyPayloadContentBinding(tx, frame, selection);
    const verified: VerifiedBindingLane[] = [];
    for (const { slot, binding } of physicalBindings(frame)) {
      const availability = yield* lockBindingInstallation(
        tx,
        binding,
        snapshot,
      );
      if (slot === "payloadLifecycle") yield* verifyPayloadPreferenceBinding(frame, availability, payloadProfiles);
      else if (availability.installation.admission.admission.frame.admissionProfile === "registered-commerce-fresh") {
        const selected = [];
        for (const member of binding.profiles) {
          const loaded = commerceProfiles.find(value =>
            sameBindingValue({ ...value.descriptor.artifact.identity }, binding.installation.artifact) &&
            value.descriptor.profileId === member.profileId && value.descriptor.contractSha256 === member.contractSha256);
          if (loaded === undefined) return yield* Effect.fail(bindingError("unsupportedProfile"));
          selected.push(loaded);
        }
        yield* validateCommerceProfileSet(selected.map(value => value.descriptor));
        for (const member of selected) {
          yield* verifyCommerceBinding(tx, frame.application.scopeId, member.profile, binding, installationRuntimeData(availability))
            .pipe(Effect.mapError(cause => bindingError("unsupportedProfile", cause)));
        }
      }
      else yield* validateBindingProfiles(
        profiles,
        database,
        target,
        binding,
        availability,
      );
      verified.push(Object.freeze({ slot, availability }));
    }
    return Object.freeze(verified);
  },
);
