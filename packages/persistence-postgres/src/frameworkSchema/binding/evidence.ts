import type { ApplicationActiveSelection } from "../../applicationActivation";
import { verifyPayloadPreferenceBinding } from "../../payloadPreferences/binding";
import { Effect, Option } from "effect";
import { withAdditiveMigrationGraphLimits } from "../../migrationCoordination/additiveLimits";
import type { FlarexMetadataTransaction } from "../../metadataTransaction";
import type { FlarexMetadataDatabase } from "../../deployments";
import type {
  FrameworkMigrationTarget,
  FrameworkMigrationTargetSnapshot,
} from "../../migrationCoordination/targetSession";
import { readFrameworkSchemaInstallationByIdentityInTransactionEffect } from "../installation/installationRepository";
import { lockFrameworkSchemaAvailabilityHeadInTransactionEffect } from "../installation/availabilityHeadRepository";
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
  const installed =
    yield* readFrameworkSchemaInstallationByIdentityInTransactionEffect(
      tx,
      identity,
    );
  if (Option.isNone(installed))
    return yield* Effect.fail(bindingError("missingDependency"));
  const availability =
    yield* lockFrameworkSchemaAvailabilityHeadInTransactionEffect(
      tx,
      installed.value,
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
}, withAdditiveMigrationGraphLimits);

export const verifyBindingLanes = Effect.fn("DataBindingEvidence.verifyLanes")(
  function* (
    tx: FlarexMetadataTransaction,
    frame: DataBindingSetFrame,
    database: FlarexMetadataDatabase,
    target: FrameworkMigrationTarget,
    snapshot: FrameworkMigrationTargetSnapshot,
    profiles: DataBindingTestProfiles | undefined,
    selection: ApplicationActiveSelection,
  ) {
    yield* verifyPayloadContentBinding(tx, frame, selection);
    const verified: VerifiedBindingLane[] = [];
    for (const { slot, binding } of physicalBindings(frame)) {
      const availability = yield* lockBindingInstallation(
        tx,
        binding,
        snapshot,
      );
      if (slot === "payloadLifecycle") yield* verifyPayloadPreferenceBinding(frame, availability);
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
