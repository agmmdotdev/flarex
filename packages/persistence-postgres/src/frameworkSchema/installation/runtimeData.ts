import type { FrameworkSchemaReadinessFrame } from "./model";
import type { RestoredFrameworkSchemaAvailabilityHead } from "./storedMetadataRestoration";
import type { RelationalPhysicalLayoutFrame } from "../../relationalSchema/physical/model";

/** Pure validated values, never repository restoration or transaction authority. */
export interface InstallationRuntimeData {
  readonly admissionProfile: string;
  readonly physicalLayoutCanonicalJson: string;
  readonly physicalLayout: RelationalPhysicalLayoutFrame;
  readonly planVersion: RestoredFrameworkSchemaAvailabilityHead["installation"]["plan"]["plan"]["frame"]["version"];
  readonly readiness: FrameworkSchemaReadinessFrame;
}

export function installationRuntimeData(value: RestoredFrameworkSchemaAvailabilityHead): InstallationRuntimeData {
  // These canonical frames are already owned and recursively frozen by capture.
  // Retaining a frame does not retain the restored graph or its WeakMap authority.
  return Object.freeze({
    admissionProfile: value.installation.admission.admission.frame.admissionProfile,
    physicalLayoutCanonicalJson: value.installation.plan.plan.physicalLayout.canonicalJson,
    physicalLayout: value.installation.plan.plan.physicalLayout.frame,
    planVersion: value.installation.plan.plan.frame.version,
    readiness: value.readiness.readiness.frame,
  });
}
