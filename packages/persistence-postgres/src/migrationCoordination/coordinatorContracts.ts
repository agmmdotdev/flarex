/**
 * Coordinator inputs, outcomes and failures. These remain source-private and are
 * re-exported by the existing coordinator entry point.
 */
import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import { Data } from "effect";
import type { FrameworkSchemaArtifactError } from "../frameworkSchema/artifact/errors";
import type { FrameworkSchemaArtifactIdentity } from "../frameworkSchema/artifact/model";
import type { FrameworkSchemaArtifactRepository } from "../frameworkSchema/artifact/repository";
import type { FrameworkSchemaInstallationValueError } from "../frameworkSchema/installation/errors";
import type {
  RestoredFrameworkSchemaAvailabilityHead,
  RestoredFrameworkSchemaReadiness,
} from "../frameworkSchema/installation/storedMetadataRestoration";
import type { RelationalSchemaError } from "../relationalSchema/errors";
import type { RelationalPhysicalValueError } from "../relationalSchema/physical/errors";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationBaseInstallation } from "./model";
import type { RelationalStructuralRunnerError } from "./relationalStructuralRunner";
import type { FrameworkMigrationRepositoryError } from "./repositoryErrors";
import type { RestoredFrameworkMigrationCollisionHead } from "./storedEventRestoration";
import type {
  RestoredFrameworkMigrationCollisionDomain,
  RestoredFrameworkMigrationPlanAdmission,
  RestoredFrameworkMigrationStepReceipt,
  RestoredFreshRelationalMigrationPlan,
} from "./storedRestoration";
import type {
  FrameworkMigrationSessionFailure,
  FrameworkMigrationTarget,
  FrameworkMigrationTargetCompositionError,
} from "./targetSession";
import type { FrameworkMigrationClaim } from "./coordinatorClaim";

export class FrameworkMigrationCoordinatorError extends Data.TaggedError(
  "FrameworkMigrationCoordinatorError",
)<{
  readonly operation:
    | "prepare"
    | "claim"
    | "step"
    | "recover"
    | "finalize";
  readonly reason:
    | "invalidInput"
    | "artifactMissing"
    | "planConflict"
    | "staleFence"
    | "leaseLost"
    | "dependencyMissing"
    | "decisionUncertain"
    | "storedCorruption"
    | "resourceFailure";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type FrameworkMigrationCoordinatorFailure =
  | FrameworkMigrationCoordinatorError
  | FrameworkSchemaArtifactError
  | FrameworkMigrationValueError
  | RelationalPhysicalValueError
  | FrameworkMigrationRepositoryError
  | FrameworkSchemaInstallationValueError
  | RelationalSchemaError
  | RelationalStructuralRunnerError
  | FrameworkMigrationTargetCompositionError
  | FrameworkMigrationSessionFailure;

export interface RunFreshFrameworkMigrationCoordinatorInput {
  readonly commerceProfile?: import("../commerceTransaction/profile").CommerceInstallationProfile;
  readonly artifactRepository: FrameworkSchemaArtifactRepository;
  readonly artifactIdentity: FrameworkSchemaArtifactIdentity;
  readonly target: FrameworkMigrationTarget;
  readonly attemptId: string;
  readonly leaseOwnerId: string;
  readonly leaseDurationMilliseconds: number;
  readonly lockTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
  readonly maximumStepsPerRun?: number;
  readonly runTimeoutMilliseconds?: number;
}

export interface RunAdditiveFrameworkMigrationCoordinatorInput extends RunFreshFrameworkMigrationCoordinatorInput {
  readonly baseInstallation: FrameworkMigrationBaseInstallation;
}

export interface FrameworkMigrationReadyResult {
  readonly kind: "ready";
  readonly replayed: boolean;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly availability: RestoredFrameworkSchemaAvailabilityHead;
}

export interface FrameworkMigrationPendingResult {
  readonly kind: "pending";
  readonly claim: FrameworkMigrationClaim;
  readonly completedStepCount: number;
  readonly requiredStepCount: number;
}

export interface FrameworkMigrationBusyResult {
  readonly kind: "busy";
  readonly attemptId: string;
  readonly leaseOwnerId: string;
  readonly leaseExpiresAt: CanonicalIsoInstant;
}

export interface FrameworkMigrationNotReadyResult {
  readonly kind: "not_ready";
  readonly reason: "structureMismatch";
}

export type FreshFrameworkMigrationCoordinatorResult =
  | FrameworkMigrationReadyResult
  | FrameworkMigrationPendingResult
  | FrameworkMigrationBusyResult
  | FrameworkMigrationNotReadyResult;

export interface PreparedCoordinatorGraph {
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly head: RestoredFrameworkMigrationCollisionHead;
}

export const STRUCTURE_MISMATCH_RESULT = Object.freeze({
  kind: "not_ready",
  reason: "structureMismatch",
} satisfies FrameworkMigrationNotReadyResult);

export type ExecuteNextFrameworkMigrationStepResult =
  | Readonly<{
      readonly kind: "step";
      readonly receipt: RestoredFrameworkMigrationStepReceipt;
      readonly completedStepCount: number;
      readonly requiredStepCount: number;
    }>
  | Readonly<{
      readonly kind: "complete";
      readonly completedStepCount: number;
      readonly requiredStepCount: number;
    }>
  | FrameworkMigrationNotReadyResult;

export function coordinatorError(
  operation: FrameworkMigrationCoordinatorError["operation"],
  reason: FrameworkMigrationCoordinatorError["reason"],
  message: string,
  cause?: unknown,
): FrameworkMigrationCoordinatorError {
  return new FrameworkMigrationCoordinatorError({
    operation,
    reason,
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function corruption(
  operation: FrameworkMigrationCoordinatorError["operation"],
  message: string,
): FrameworkMigrationCoordinatorError {
  return coordinatorError(operation, "storedCorruption", message);
}
