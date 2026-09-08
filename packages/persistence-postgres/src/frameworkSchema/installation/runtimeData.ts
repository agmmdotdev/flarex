import type { FrameworkSchemaReadinessFrame } from "./model";
import type { RestoredFrameworkSchemaAvailabilityHead } from "./storedMetadataRestoration";

/** Pure validated values, never repository restoration or transaction authority. */
export interface InstallationRuntimeData {
  readonly admissionProfile: string;
  readonly physicalLayoutCanonicalJson: string;
  readonly readiness: FrameworkSchemaReadinessFrame;
}

export function installationRuntimeData(value: RestoredFrameworkSchemaAvailabilityHead): InstallationRuntimeData {
  // These canonical frames are already owned and recursively frozen by capture.
  // Retaining a frame does not retain the restored graph or its WeakMap authority.
  return Object.freeze({
    admissionProfile: value.installation.admission.admission.frame.admissionProfile,
    physicalLayoutCanonicalJson: value.installation.plan.plan.physicalLayout.canonicalJson,
    readiness: value.readiness.readiness.frame,
  });
}
