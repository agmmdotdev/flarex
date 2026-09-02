import { Effect } from "effect";

import {
  capturedFrameworkMigrationTerminalAdmission,
  capturedPlanForAdmission,
  isCapturedFreshRelationalMigrationPlanAuthority,
} from "../../migrationCoordination/authority";
import type {
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationPlanAdmissionSha256,
  FrameworkSchemaAvailabilityHeadSha256,
  FrameworkSchemaAvailabilityHistorySha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaReadinessSha256,
} from "../../migrationCoordination/identity";
import type {
  CapturedFrameworkMigrationValue,
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationPlanAdmissionFrame,
  FreshRelationalMigrationPlan,
} from "../../migrationCoordination/model";
import {
  capturedAuthorityForFrameworkSchemaAvailabilityHistory,
  capturedAuthorityForFrameworkSchemaInstallation,
  capturedAuthorityForFrameworkSchemaReadiness,
} from "./authority";
import {
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
  captureFrameworkSchemaInstallation,
  captureFrameworkSchemaReadiness,
} from "./canonical";
import {
  FrameworkSchemaInstallationValueError,
  type FrameworkSchemaInstallationValueError as InstallationValueError,
} from "./errors";
import type {
  CapturedFrameworkSchemaInstallationValue,
  FrameworkSchemaAvailabilityHead,
  FrameworkSchemaAvailabilityHeadFrame,
  FrameworkSchemaAvailabilityHistoryFrame,
  FrameworkSchemaInstallationFrame,
  FrameworkSchemaReadinessFrame,
} from "./model";
import {
  isStoredFrameworkSchemaAvailabilityHeadFrame,
  isStoredFrameworkSchemaAvailabilityHistoryFrame,
  isStoredFrameworkSchemaInstallationFrame,
  isStoredFrameworkSchemaReadinessFrame,
} from "./storedValidation";

type PlanAdmission = CapturedFrameworkMigrationValue<
  FrameworkMigrationPlanAdmissionFrame,
  FrameworkMigrationPlanAdmissionSha256
>;

type AttemptTerminal = CapturedFrameworkMigrationValue<
  FrameworkMigrationAttemptTerminalFrame,
  FrameworkMigrationAttemptTerminalSha256
>;

type Installation = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaInstallationFrame,
  FrameworkSchemaInstallationReceiptSha256
>;

type Readiness = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaReadinessFrame,
  FrameworkSchemaReadinessSha256
>;

type AvailabilityHistory = CapturedFrameworkSchemaInstallationValue<
  FrameworkSchemaAvailabilityHistoryFrame,
  FrameworkSchemaAvailabilityHistorySha256
>;

export interface RestoreStoredFrameworkSchemaInstallationInput {
  readonly frame: FrameworkSchemaInstallationFrame;
  readonly installationReceiptSha256:
    FrameworkSchemaInstallationReceiptSha256;
  readonly canonicalJson: string;
  readonly plan: FreshRelationalMigrationPlan;
  readonly admission: PlanAdmission;
  readonly terminal: AttemptTerminal;
}

export const restoreStoredFrameworkSchemaInstallation = Effect.fn(
  "FrameworkSchemaInstallation.restoreStored",
)(function* (
  input: RestoreStoredFrameworkSchemaInstallationInput,
): Effect.fn.Return<Installation, InstallationValueError> {
  if (
    !isStoredFrameworkSchemaInstallationFrame(input.frame) ||
    !isCapturedFreshRelationalMigrationPlanAuthority(input.plan) ||
    capturedPlanForAdmission(input.admission) !== input.plan ||
    capturedFrameworkMigrationTerminalAdmission(input.terminal) !==
      input.admission
  ) {
    return yield* corrupt();
  }
  const restored = yield* captureFrameworkSchemaInstallation({
    plan: input.plan,
    admission: input.admission,
    terminal: input.terminal,
    installedStructureSha256: input.frame.installedStructureSha256,
    installedPhysicalCapabilities:
      input.frame.installedPhysicalCapabilities,
    installedAt: input.frame.installedAt,
  }).pipe(Effect.mapError(mapStoredRestorationError));
  if (
    restored.sha256 !== input.installationReceiptSha256 ||
    restored.canonicalJson !== input.canonicalJson
  ) {
    return yield* corrupt();
  }
  return restored;
});

export interface RestoreStoredFrameworkSchemaReadinessInput {
  readonly frame: FrameworkSchemaReadinessFrame;
  readonly readinessSha256: FrameworkSchemaReadinessSha256;
  readonly canonicalJson: string;
  readonly installation: Installation;
}

export const restoreStoredFrameworkSchemaReadiness = Effect.fn(
  "FrameworkSchemaReadiness.restoreStored",
)(function* (
  input: RestoreStoredFrameworkSchemaReadinessInput,
): Effect.fn.Return<Readiness, InstallationValueError> {
  if (
    !isStoredFrameworkSchemaReadinessFrame(input.frame) ||
    capturedAuthorityForFrameworkSchemaInstallation(input.installation) ===
      undefined
  ) {
    return yield* corrupt();
  }
  const restored = yield* captureFrameworkSchemaReadiness({
    installation: input.installation,
    validationSha256: input.frame.validationSha256,
    validatedStructureSha256: input.frame.validatedStructureSha256,
    validatedPhysicalCapabilities:
      input.frame.validatedPhysicalCapabilities,
    residualRequirements: input.frame.residualRequirements,
    validatedAt: input.frame.validatedAt,
  }).pipe(Effect.mapError(mapStoredRestorationError));
  if (
    restored.sha256 !== input.readinessSha256 ||
    restored.canonicalJson !== input.canonicalJson
  ) {
    return yield* corrupt();
  }
  return restored;
});

export interface RestoreStoredFrameworkSchemaAvailabilityHistoryInput {
  readonly frame: FrameworkSchemaAvailabilityHistoryFrame;
  readonly historySha256: FrameworkSchemaAvailabilityHistorySha256;
  readonly canonicalJson: string;
  readonly readiness: Readiness;
  readonly previous: AvailabilityHistory | null;
}

export const restoreStoredFrameworkSchemaAvailabilityHistory = Effect.fn(
  "FrameworkSchemaAvailabilityHistory.restoreStored",
)(function* (
  input: RestoreStoredFrameworkSchemaAvailabilityHistoryInput,
): Effect.fn.Return<AvailabilityHistory, InstallationValueError> {
  const readinessAuthority =
    capturedAuthorityForFrameworkSchemaReadiness(input.readiness);
  const previousAuthority = input.previous === null
    ? undefined
    : capturedAuthorityForFrameworkSchemaAvailabilityHistory(input.previous);
  if (
    !isStoredFrameworkSchemaAvailabilityHistoryFrame(input.frame) ||
    readinessAuthority === undefined ||
    (input.previous !== null &&
      previousAuthority?.readiness !== input.readiness)
  ) {
    return yield* corrupt();
  }
  const restored = yield* captureFrameworkSchemaAvailabilityHistory({
    readiness: input.readiness,
    previous: input.previous,
    status: input.frame.status,
    reasonSha256: input.frame.reasonSha256,
    recordedAt: input.frame.recordedAt,
  }).pipe(Effect.mapError(mapStoredRestorationError));
  if (
    restored.sha256 !== input.historySha256 ||
    restored.canonicalJson !== input.canonicalJson
  ) {
    return yield* corrupt();
  }
  return restored;
});

export interface RestoreStoredFrameworkSchemaAvailabilityHeadInput {
  readonly frame: FrameworkSchemaAvailabilityHeadFrame;
  readonly availabilityHeadSha256: FrameworkSchemaAvailabilityHeadSha256;
  readonly canonicalJson: string;
  readonly readiness: Readiness;
  readonly history: AvailabilityHistory;
}

export const restoreStoredFrameworkSchemaAvailabilityHead = Effect.fn(
  "FrameworkSchemaAvailabilityHead.restoreStored",
)(function* (
  input: RestoreStoredFrameworkSchemaAvailabilityHeadInput,
): Effect.fn.Return<FrameworkSchemaAvailabilityHead, InstallationValueError> {
  const readinessAuthority =
    capturedAuthorityForFrameworkSchemaReadiness(input.readiness);
  const historyAuthority =
    capturedAuthorityForFrameworkSchemaAvailabilityHistory(input.history);
  if (
    !isStoredFrameworkSchemaAvailabilityHeadFrame(input.frame) ||
    readinessAuthority === undefined ||
    historyAuthority?.readiness !== input.readiness
  ) {
    return yield* corrupt();
  }
  const restored = yield* captureFrameworkSchemaAvailabilityHead(
    input.history,
  ).pipe(Effect.mapError(mapStoredRestorationError));
  if (
    restored.sha256 !== input.availabilityHeadSha256 ||
    restored.canonicalJson !== input.canonicalJson
  ) {
    return yield* corrupt();
  }
  return restored;
});

function mapStoredRestorationError(
  error: InstallationValueError,
): InstallationValueError {
  return error.reason === "resourceFailure"
    ? FrameworkSchemaInstallationValueError.resourceFailure(
      "decodeStoredValue",
      error.cause,
    )
    : FrameworkSchemaInstallationValueError.storedStateCorrupt();
}

function corrupt(): Effect.Effect<never, InstallationValueError> {
  return Effect.fail(
    FrameworkSchemaInstallationValueError.storedStateCorrupt(),
  );
}
