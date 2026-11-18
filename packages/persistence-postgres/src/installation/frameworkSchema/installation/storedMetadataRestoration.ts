import { Brand, Effect } from "effect";

import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredPositiveInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
  type StoredCanonicalMetadataColumns,
} from "../privateStoredMetadataValue";
import type {
  FrameworkSchemaAvailabilityHeadSha256,
  FrameworkSchemaAvailabilityHistorySha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaReadinessSha256,
} from "../../migrationCoordination/identity";
import {
  isRestoredFrameworkMigrationAttemptTerminal,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationPlanAdmission,
  isRestoredFreshRelationalMigrationPlan,
  type RestoredFrameworkMigrationAttemptTerminal,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationPlanAdmission,
  type RestoredFreshRelationalMigrationPlan,
} from "../../migrationCoordination/storedRestoration";
import {
  MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
  verifyStoredFrameworkSchemaInstallationValue,
} from "./canonical";
import {
  FrameworkSchemaInstallationValueError,
  type FrameworkSchemaInstallationValueError as InstallationValueError,
} from "./errors";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
  FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
  FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
  FRAMEWORK_SCHEMA_READINESS_FORMAT,
  FRAMEWORK_SCHEMA_READINESS_VERSION,
  type CapturedFrameworkSchemaInstallationValue,
  type FrameworkSchemaAvailabilityHead,
  type FrameworkSchemaAvailabilityHistoryFrame,
  type FrameworkSchemaInstallationFrame,
  type FrameworkSchemaReadinessFrame,
} from "./model";
import {
  restoreStoredFrameworkSchemaAvailabilityHead as restoreVerifiedAvailabilityHead,
  restoreStoredFrameworkSchemaAvailabilityHistory as restoreVerifiedAvailabilityHistory,
  restoreStoredFrameworkSchemaInstallation as restoreVerifiedInstallation,
  restoreStoredFrameworkSchemaReadiness as restoreVerifiedReadiness,
} from "./storedRestoration";
import {
  isStoredFrameworkSchemaAvailabilityHeadFrame,
  isStoredFrameworkSchemaAvailabilityHistoryFrame,
  isStoredFrameworkSchemaInstallationFrame,
  isStoredFrameworkSchemaReadinessFrame,
} from "./storedValidation";

type StoredCanonicalRow = StoredCanonicalMetadataColumns;

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

export interface StoredFrameworkSchemaInstallationRow
  extends StoredCanonicalRow {
  readonly installationStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly planStorageId: unknown;
  readonly migrationPlanSha256: unknown;
  readonly admissionStorageId: unknown;
  readonly admissionSha256: unknown;
  readonly terminalStorageId: unknown;
  readonly terminalOutcomeKind: unknown;
  readonly terminalSha256: unknown;
  readonly installationSha256: unknown;
  readonly installationReceiptSha256: unknown;
  readonly installedStructureSha256: unknown;
}

export interface RestoredFrameworkSchemaInstallation {
  readonly storageId: bigint;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly terminal: RestoredFrameworkMigrationAttemptTerminal;
  readonly installation: Installation;
}

export interface StoredFrameworkSchemaReadinessRow extends StoredCanonicalRow {
  readonly readinessStorageId: unknown;
  readonly installationStorageId: unknown;
  readonly installationSha256: unknown;
  readonly installationReceiptSha256: unknown;
  readonly readinessSha256: unknown;
  readonly validationSha256: unknown;
  readonly validatedStructureSha256: unknown;
}

export interface RestoredFrameworkSchemaReadiness {
  readonly storageId: bigint;
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: Readiness;
}

export interface StoredFrameworkSchemaAvailabilityHistoryRow
  extends StoredCanonicalRow {
  readonly availabilityHistoryStorageId: unknown;
  readonly installationStorageId: unknown;
  readonly readinessStorageId: unknown;
  readonly readinessSha256: unknown;
  readonly availabilitySequence: unknown;
  readonly status: unknown;
  readonly reasonSha256: unknown;
  readonly historySha256: unknown;
  readonly previousHistoryStorageId: unknown;
  readonly previousAvailabilitySequence: unknown;
  readonly previousHistorySha256: unknown;
  readonly previousStatus: unknown;
}

export interface RestoredFrameworkSchemaAvailabilityHistory {
  readonly storageId: bigint;
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly history: AvailabilityHistory;
}

export interface StoredFrameworkSchemaAvailabilityHeadRow
  extends StoredCanonicalRow {
  readonly installationStorageId: unknown;
  readonly readinessStorageId: unknown;
  readonly availabilityHistoryStorageId: unknown;
  readonly availabilitySequence: unknown;
  readonly status: unknown;
  readonly historySha256: unknown;
  readonly availabilityHeadSha256: unknown;
}

export interface RestoredFrameworkSchemaAvailabilityHead {
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly history: RestoredFrameworkSchemaAvailabilityHistory;
  readonly head: FrameworkSchemaAvailabilityHead;
}

const restoredInstallations = new WeakSet<
  RestoredFrameworkSchemaInstallation
>();
const restoredReadiness = new WeakSet<RestoredFrameworkSchemaReadiness>();
const restoredAvailabilityHistory = new WeakSet<
  RestoredFrameworkSchemaAvailabilityHistory
>();
const restoredAvailabilityHistoryAuthorities = new WeakMap<
  RestoredFrameworkSchemaAvailabilityHistory,
  Readonly<{
    readonly previous: RestoredFrameworkSchemaAvailabilityHistory | null;
  }>
>();
const restoredAvailabilityHeads = new WeakSet<
  RestoredFrameworkSchemaAvailabilityHead
>();

const brandInstallationReceiptSha256 =
  Brand.nominal<FrameworkSchemaInstallationReceiptSha256>();
const brandReadinessSha256 = Brand.nominal<FrameworkSchemaReadinessSha256>();
const brandHistorySha256 =
  Brand.nominal<FrameworkSchemaAvailabilityHistorySha256>();
const brandHeadSha256 =
  Brand.nominal<FrameworkSchemaAvailabilityHeadSha256>();

export interface RestoreStoredFrameworkSchemaInstallationMetadataInput {
  readonly row: StoredFrameworkSchemaInstallationRow;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly terminal: RestoredFrameworkMigrationAttemptTerminal;
}

export const restoreStoredFrameworkSchemaInstallationMetadata = Effect.fn(
  "FrameworkSchemaInstallation.restoreStoredMetadata",
)(function* (
  input: RestoreStoredFrameworkSchemaInstallationMetadataInput,
): Effect.fn.Return<RestoredFrameworkSchemaInstallation, InstallationValueError> {
  const { row } = input;
  const storageId = yield* storedStorageId(row.installationStorageId);
  if (
    !isRestoredFrameworkMigrationCollisionDomain(input.collision) ||
    !isRestoredFreshRelationalMigrationPlan(input.plan) ||
    !isRestoredFrameworkMigrationPlanAdmission(input.admission) ||
    !isRestoredFrameworkMigrationAttemptTerminal(input.terminal) ||
    input.plan.collision !== input.collision ||
    input.admission.collision !== input.collision ||
    input.admission.plan !== input.plan ||
    input.terminal.attempt.admission !== input.admission ||
    row.collisionStorageId !== input.collision.storageId ||
    row.planStorageId !== input.plan.storageId ||
    row.admissionStorageId !== input.admission.storageId ||
    row.terminalStorageId !== input.terminal.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeInstallationCanonical(
    row,
    row.installationReceiptSha256,
    FRAMEWORK_SCHEMA_INSTALLATION_FORMAT,
    FRAMEWORK_SCHEMA_INSTALLATION_VERSION,
    MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkSchemaInstallationValue({
    kind: "installation",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  if (
    !isStoredFrameworkSchemaInstallationFrame(frame) ||
    frame.identity.migrationPlanSha256 !== input.plan.plan.migrationPlanSha256 ||
    frame.planAdmissionSha256 !== input.admission.admission.sha256 ||
    frame.terminalAttemptSha256 !== input.terminal.terminal.sha256 ||
    row.terminalOutcomeKind !== "succeeded" ||
    input.terminal.terminal.frame.outcome.kind !== "succeeded" ||
    !(yield* shaEquals(
      row.migrationPlanSha256,
      input.plan.plan.migrationPlanSha256,
    )) ||
    !(yield* shaEquals(row.admissionSha256, input.admission.admission.sha256)) ||
    !(yield* shaEquals(row.terminalSha256, input.terminal.terminal.sha256)) ||
    !(yield* shaEquals(
      row.installationSha256,
      frame.identity.installationSha256,
    )) ||
    !(yield* shaEquals(
      row.installedStructureSha256,
      frame.installedStructureSha256,
    ))
  ) {
    return yield* corrupt();
  }
  const installation = yield* restoreVerifiedInstallation({
    frame,
    installationReceiptSha256: brandInstallationReceiptSha256(
      stored.sha256Hex,
    ),
    canonicalJson: stored.canonicalJson,
    plan: input.plan.plan,
    admission: input.admission.admission,
    terminal: input.terminal.terminal,
  });
  const restored = Object.freeze({
    storageId,
    collision: input.collision,
    plan: input.plan,
    admission: input.admission,
    terminal: input.terminal,
    installation,
  });
  restoredInstallations.add(restored);
  return restored;
});

export function isRestoredFrameworkSchemaInstallation(
  input: RestoredFrameworkSchemaInstallation,
): boolean {
  return restoredInstallations.has(input);
}

export interface RestoreStoredFrameworkSchemaReadinessMetadataInput {
  readonly row: StoredFrameworkSchemaReadinessRow;
  readonly installation: RestoredFrameworkSchemaInstallation;
}

export const restoreStoredFrameworkSchemaReadinessMetadata = Effect.fn(
  "FrameworkSchemaReadiness.restoreStoredMetadata",
)(function* (
  input: RestoreStoredFrameworkSchemaReadinessMetadataInput,
): Effect.fn.Return<RestoredFrameworkSchemaReadiness, InstallationValueError> {
  const { row } = input;
  const storageId = yield* storedStorageId(row.readinessStorageId);
  if (
    !restoredInstallations.has(input.installation) ||
    row.installationStorageId !== input.installation.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeInstallationCanonical(
    row,
    row.readinessSha256,
    FRAMEWORK_SCHEMA_READINESS_FORMAT,
    FRAMEWORK_SCHEMA_READINESS_VERSION,
    MAX_FRAMEWORK_SCHEMA_INSTALLATION_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkSchemaInstallationValue({
    kind: "readiness",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  if (
    !isStoredFrameworkSchemaReadinessFrame(frame) ||
    frame.installation.installationSha256 !==
      input.installation.installation.frame.identity.installationSha256 ||
    frame.installationReceiptSha256 !==
      input.installation.installation.sha256 ||
    !(yield* shaEquals(
      row.installationSha256,
      frame.installation.installationSha256,
    )) ||
    !(yield* shaEquals(
      row.installationReceiptSha256,
      frame.installationReceiptSha256,
    )) ||
    !(yield* shaEquals(row.validationSha256, frame.validationSha256)) ||
    !(yield* shaEquals(
      row.validatedStructureSha256,
      frame.validatedStructureSha256,
    ))
  ) {
    return yield* corrupt();
  }
  const readiness = yield* restoreVerifiedReadiness({
    frame,
    readinessSha256: brandReadinessSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
    installation: input.installation.installation,
  });
  const restored = Object.freeze({
    storageId,
    installation: input.installation,
    readiness,
  });
  restoredReadiness.add(restored);
  return restored;
});

export function isRestoredFrameworkSchemaReadiness(
  input: RestoredFrameworkSchemaReadiness,
): boolean {
  return restoredReadiness.has(input);
}

export interface RestoreStoredFrameworkSchemaAvailabilityHistoryMetadataInput {
  readonly row: StoredFrameworkSchemaAvailabilityHistoryRow;
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly previous: RestoredFrameworkSchemaAvailabilityHistory | null;
}

export const restoreStoredFrameworkSchemaAvailabilityHistoryMetadata =
  Effect.fn("FrameworkSchemaAvailabilityHistory.restoreStoredMetadata")(
    function* (
      input: RestoreStoredFrameworkSchemaAvailabilityHistoryMetadataInput,
    ): Effect.fn.Return<
      RestoredFrameworkSchemaAvailabilityHistory,
      InstallationValueError
    > {
      const { row } = input;
      const storageId = yield* storedStorageId(
        row.availabilityHistoryStorageId,
      );
      if (
        !restoredInstallations.has(input.installation) ||
        !restoredReadiness.has(input.readiness) ||
        input.readiness.installation !== input.installation ||
        row.installationStorageId !== input.installation.storageId ||
        row.readinessStorageId !== input.readiness.storageId
      ) {
        return yield* corrupt();
      }
      const stored = yield* decodeInstallationCanonical(
        row,
        row.historySha256,
        FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
        FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
        MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
      );
      const frame = yield* verifyStoredFrameworkSchemaInstallationValue({
        kind: "availabilityHistory",
        canonicalBytes: stored.canonicalBytes,
        sha256Hex: stored.sha256Hex,
      });
      const sequence = yield* Effect.fromResult(
        decodeStoredPositiveInt64TextResult(
          row.availabilitySequence,
          FrameworkSchemaInstallationValueError.storedStateCorrupt,
        ),
      );
      if (
        !isStoredFrameworkSchemaAvailabilityHistoryFrame(frame) ||
        frame.readinessSha256 !== input.readiness.readiness.sha256 ||
        sequence !== frame.availabilitySequence ||
        row.status !== frame.status ||
        !(yield* shaEquals(row.readinessSha256, frame.readinessSha256)) ||
        !(yield* nullableShaEquals(row.reasonSha256, frame.reasonSha256)) ||
        !(yield* previousHistoryProjectionMatches(row, frame, input))
      ) {
        return yield* corrupt();
      }
      const history = yield* restoreVerifiedAvailabilityHistory({
        frame,
        historySha256: brandHistorySha256(stored.sha256Hex),
        canonicalJson: stored.canonicalJson,
        readiness: input.readiness.readiness,
        previous: input.previous?.history ?? null,
      });
      const restored = Object.freeze({
        storageId,
        installation: input.installation,
        readiness: input.readiness,
        history,
      });
      restoredAvailabilityHistory.add(restored);
      restoredAvailabilityHistoryAuthorities.set(restored, Object.freeze({
        previous: input.previous,
      }));
      return restored;
    },
  );

export function isRestoredFrameworkSchemaAvailabilityHistory(
  input: RestoredFrameworkSchemaAvailabilityHistory,
): boolean {
  return restoredAvailabilityHistory.has(input);
}

/** Source-private predecessor needed to continue restored availability. */
export function restoredFrameworkSchemaAvailabilityHistoryAuthority(
  input: RestoredFrameworkSchemaAvailabilityHistory,
): Readonly<{
  readonly previous: RestoredFrameworkSchemaAvailabilityHistory | null;
}> | undefined {
  return restoredAvailabilityHistoryAuthorities.get(input);
}

export interface RestoreStoredFrameworkSchemaAvailabilityHeadMetadataInput {
  readonly row: StoredFrameworkSchemaAvailabilityHeadRow;
  readonly installation: RestoredFrameworkSchemaInstallation;
  readonly readiness: RestoredFrameworkSchemaReadiness;
  readonly history: RestoredFrameworkSchemaAvailabilityHistory;
}

export const restoreStoredFrameworkSchemaAvailabilityHeadMetadata = Effect.fn(
  "FrameworkSchemaAvailabilityHead.restoreStoredMetadata",
)(function* (
  input: RestoreStoredFrameworkSchemaAvailabilityHeadMetadataInput,
): Effect.fn.Return<
  RestoredFrameworkSchemaAvailabilityHead,
  InstallationValueError
> {
  const { row } = input;
  if (
    !restoredInstallations.has(input.installation) ||
    !restoredReadiness.has(input.readiness) ||
    !restoredAvailabilityHistory.has(input.history) ||
    input.readiness.installation !== input.installation ||
    input.history.installation !== input.installation ||
    input.history.readiness !== input.readiness ||
    row.installationStorageId !== input.installation.storageId ||
    row.readinessStorageId !== input.readiness.storageId ||
    row.availabilityHistoryStorageId !== input.history.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeInstallationCanonical(
    row,
    row.availabilityHeadSha256,
    FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
    FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
    MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  );
  const frame = yield* verifyStoredFrameworkSchemaInstallationValue({
    kind: "availabilityHead",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const sequence = yield* Effect.fromResult(
    decodeStoredPositiveInt64TextResult(
      row.availabilitySequence,
      FrameworkSchemaInstallationValueError.storedStateCorrupt,
    ),
  );
  if (
    !isStoredFrameworkSchemaAvailabilityHeadFrame(frame) ||
    frame.readinessSha256 !== input.readiness.readiness.sha256 ||
    frame.historySha256 !== input.history.history.sha256 ||
    frame.availabilitySequence !== input.history.history.frame
      .availabilitySequence ||
    frame.status !== input.history.history.frame.status ||
    sequence !== frame.availabilitySequence ||
    row.status !== frame.status ||
    !(yield* shaEquals(row.historySha256, frame.historySha256))
  ) {
    return yield* corrupt();
  }
  const head = yield* restoreVerifiedAvailabilityHead({
    frame,
    availabilityHeadSha256: brandHeadSha256(stored.sha256Hex),
    canonicalJson: stored.canonicalJson,
    readiness: input.readiness.readiness,
    history: input.history.history,
  });
  const restored = Object.freeze({
    installation: input.installation,
    readiness: input.readiness,
    history: input.history,
    head,
  });
  restoredAvailabilityHeads.add(restored);
  return restored;
});

export function isRestoredFrameworkSchemaAvailabilityHead(
  input: RestoredFrameworkSchemaAvailabilityHead,
): boolean {
  return restoredAvailabilityHeads.has(input);
}

const decodeInstallationCanonical = Effect.fn(
  "FrameworkSchemaInstallationValue.decodeStoredMetadata",
)(function* (
  row: StoredCanonicalRow,
  sha256Bytes: unknown,
  format: string,
  version: number,
  maximumCanonicalBytes: number,
): Effect.fn.Return<
  Readonly<{
    readonly sha256Hex: string;
    readonly canonicalBytes: Uint8Array;
    readonly canonicalJson: string;
  }>,
  InstallationValueError
> {
  return yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    sha256Bytes,
    { format, version, maximumCanonicalBytes },
    FrameworkSchemaInstallationValueError.storedStateCorrupt,
  ));
});

const storedStorageId = Effect.fn(
  "FrameworkSchemaInstallationValue.decodeStoredStorageId",
)(function* (
  input: unknown,
): Effect.fn.Return<bigint, InstallationValueError> {
  return yield* Effect.fromResult(decodeStoredStorageIdResult(
    input,
    FrameworkSchemaInstallationValueError.storedStateCorrupt,
  ));
});

const shaEquals = Effect.fn(
  "FrameworkSchemaInstallationValue.storedSha256Equals",
)(function* (
  input: unknown,
  expected: string,
): Effect.fn.Return<boolean, InstallationValueError> {
  const sha256 = yield* Effect.fromResult(decodeStoredSha256HexResult(
    input,
    FrameworkSchemaInstallationValueError.storedStateCorrupt,
  ));
  return sha256 === expected;
});

const nullableShaEquals = Effect.fn(
  "FrameworkSchemaInstallationValue.nullableStoredSha256Equals",
)(function* (
  input: unknown,
  expected: string | null,
): Effect.fn.Return<boolean, InstallationValueError> {
  return expected === null
    ? input === null
    : input !== null && (yield* shaEquals(input, expected));
});

const previousHistoryProjectionMatches = Effect.fn(
  "FrameworkSchemaAvailabilityHistory.verifyStoredPreviousProjection",
)(function* (
  row: StoredFrameworkSchemaAvailabilityHistoryRow,
  frame: FrameworkSchemaAvailabilityHistoryFrame,
  input: RestoreStoredFrameworkSchemaAvailabilityHistoryMetadataInput,
): Effect.fn.Return<boolean, InstallationValueError> {
  if (frame.previousAvailability === null) {
    return input.previous === null && row.previousHistoryStorageId === null &&
      row.previousAvailabilitySequence === null &&
      row.previousHistorySha256 === null && row.previousStatus === null;
  }
  if (
    input.previous === null ||
    !restoredAvailabilityHistory.has(input.previous) ||
    input.previous.installation !== input.installation ||
    input.previous.readiness !== input.readiness
  ) return false;
  return row.previousHistoryStorageId === input.previous.storageId &&
    row.previousAvailabilitySequence ===
      BigInt(input.previous.history.frame.availabilitySequence) &&
    row.previousStatus === input.previous.history.frame.status &&
    frame.previousAvailability.availabilitySequence ===
      input.previous.history.frame.availabilitySequence &&
    frame.previousAvailability.status === input.previous.history.frame.status &&
    frame.previousAvailability.historySha256 === input.previous.history.sha256 &&
    (yield* shaEquals(
      row.previousHistorySha256,
      input.previous.history.sha256,
    ));
});

function corrupt(): Effect.Effect<never, InstallationValueError> {
  return Effect.fail(
    FrameworkSchemaInstallationValueError.storedStateCorrupt(),
  );
}
