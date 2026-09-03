import { Effect } from "effect";

import {
  isRestoredFrameworkSchemaInstallation,
  isRestoredFrameworkSchemaReadiness,
  type RestoredFrameworkSchemaInstallation,
  type RestoredFrameworkSchemaReadiness,
} from "../frameworkSchema/installation/storedMetadataRestoration";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
  storedDateMatchesCanonicalInstant,
  type StoredCanonicalMetadataColumns,
} from "../frameworkSchema/privateStoredMetadataValue";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
  isStoredFrameworkMigrationEventFrame,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import { FrameworkMigrationValueError } from "./errors";
import type {
  FrameworkMigrationCollisionHeadSha256,
  FrameworkMigrationEventSha256,
} from "./identity";
import {
  FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationCollisionHeadFrame,
  type FrameworkMigrationEventFrame,
} from "./model";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationAttemptTerminal,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationPlanAdmission,
  isRestoredFrameworkMigrationStepReceipt,
  isRestoredFreshRelationalMigrationPlan,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationAttemptTerminal,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationPlanAdmission,
  type RestoredFrameworkMigrationStepReceipt,
  type RestoredFreshRelationalMigrationPlan,
} from "./storedRestoration";
import { isStoredFrameworkMigrationCollisionHeadFrame } from
  "./storedValidation";

type StoredCanonicalRow = StoredCanonicalMetadataColumns;

export interface StoredFrameworkMigrationEventRow extends StoredCanonicalRow {
  readonly eventStorageId: unknown;
  readonly collisionStorageId: unknown;
  readonly eventSequence: unknown;
  readonly eventSha256: unknown;
  readonly previousEventStorageId: unknown;
  readonly previousEventSequence: unknown;
  readonly previousEventSha256: unknown;
  readonly eventKind: unknown;
  readonly subjectSha256: unknown;
  readonly leaseAttemptId: unknown;
  readonly leaseAttemptFence: unknown;
  readonly leaseOwnerId: unknown;
  readonly leaseExpiresAt: unknown;
}

export type RestoredFrameworkMigrationEventSubject =
  | Readonly<{
      readonly kind: "planAdmitted";
      readonly admission: RestoredFrameworkMigrationPlanAdmission;
    }>
  | Readonly<{
      readonly kind: "attemptStarted" | "leaseRenewed";
      readonly attempt: RestoredFrameworkMigrationAttemptStart;
    }>
  | Readonly<{
      readonly kind: "stepCompleted";
      readonly receipt: RestoredFrameworkMigrationStepReceipt;
    }>
  | Readonly<{
      readonly kind: "attemptTerminated";
      readonly terminal: RestoredFrameworkMigrationAttemptTerminal;
    }>
  | Readonly<{
      readonly kind: "installationPublished";
      readonly installation: RestoredFrameworkSchemaInstallation;
    }>
  | Readonly<{
      readonly kind: "readinessPublished";
      readonly readiness: RestoredFrameworkSchemaReadiness;
    }>;

export interface RestoredFrameworkMigrationEvent {
  readonly storageId: bigint;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly event: CapturedFrameworkMigrationValue<
    FrameworkMigrationEventFrame,
    FrameworkMigrationEventSha256
  >;
}

export interface StoredFrameworkMigrationCollisionHeadRow
  extends StoredCanonicalRow {
  readonly collisionStorageId: unknown;
  readonly currentPlanStorageId: unknown;
  readonly currentPlanSha256: unknown;
  readonly currentAdmissionStorageId: unknown;
  readonly currentAdmissionSha256: unknown;
  readonly headRevision: unknown;
  readonly attemptFence: unknown;
  readonly currentAttemptStorageId: unknown;
  readonly currentAttemptId: unknown;
  readonly currentAttemptFence: unknown;
  readonly currentLeaseOwnerId: unknown;
  readonly currentLeaseExpiresAt: unknown;
  readonly lastEventStorageId: unknown;
  readonly lastEventSequence: unknown;
  readonly lastEventSha256: unknown;
  readonly collisionHeadSha256: unknown;
}

export interface RestoredFrameworkMigrationCollisionHead {
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly head: CapturedFrameworkMigrationValue<
    FrameworkMigrationCollisionHeadFrame,
    FrameworkMigrationCollisionHeadSha256
  >;
}

const restoredEvents = new WeakSet<RestoredFrameworkMigrationEvent>();
const restoredEventAuthorities = new WeakMap<
  RestoredFrameworkMigrationEvent,
  Readonly<{
    readonly previous: RestoredFrameworkMigrationEvent | null;
    readonly subject: RestoredFrameworkMigrationEventSubject;
  }>
>();
const restoredCollisionHeads = new WeakSet<
  RestoredFrameworkMigrationCollisionHead
>();

export interface RestoreStoredFrameworkMigrationEventInput {
  readonly row: StoredFrameworkMigrationEventRow;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly previous: RestoredFrameworkMigrationEvent | null;
  readonly subject: RestoredFrameworkMigrationEventSubject;
}

export const restoreStoredFrameworkMigrationEvent = Effect.fn(
  "FrameworkMigrationEvent.restoreStored",
)(function* (
  input: RestoreStoredFrameworkMigrationEventInput,
): Effect.fn.Return<
  RestoredFrameworkMigrationEvent,
  FrameworkMigrationValueError
> {
  const { row } = input;
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.eventStorageId,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  if (
    !isRestoredFrameworkMigrationCollisionDomain(input.collision) ||
    row.collisionStorageId !== input.collision.storageId
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeEventCanonical(
    row,
    row.eventSha256,
    FRAMEWORK_MIGRATION_EVENT_FORMAT,
    FRAMEWORK_MIGRATION_EVENT_VERSION,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "event",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const sequence = yield* nonNegativeInt64(row.eventSequence);
  if (
    !isStoredFrameworkMigrationEventFrame(frame) ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    sequence !== frame.sequence || row.eventKind !== frame.kind ||
    input.subject.kind !== frame.kind ||
    !(yield* previousEventProjectionMatches(row, frame, input)) ||
    !(yield* eventSubjectProjectionMatches(row, frame, input))
  ) {
    return yield* corrupt();
  }
  const event = yield* captureFrameworkMigrationEvent(frame);
  if (
    event.sha256 !== stored.sha256Hex ||
    event.canonicalJson !== stored.canonicalJson
  ) {
    return yield* corrupt();
  }
  const restored = Object.freeze({
    storageId,
    collision: input.collision,
    event,
  });
  restoredEvents.add(restored);
  restoredEventAuthorities.set(restored, Object.freeze({
    previous: input.previous,
    subject: input.subject,
  }));
  return restored;
});

export function isRestoredFrameworkMigrationEvent(
  input: RestoredFrameworkMigrationEvent,
): boolean {
  return restoredEvents.has(input);
}

/** Source-private dependency authority retained for repository corroboration. */
export function restoredFrameworkMigrationEventAuthority(
  input: RestoredFrameworkMigrationEvent,
): Readonly<{
  readonly previous: RestoredFrameworkMigrationEvent | null;
  readonly subject: RestoredFrameworkMigrationEventSubject;
}> | undefined {
  return restoredEventAuthorities.get(input);
}

export interface RestoreStoredFrameworkMigrationCollisionHeadInput {
  readonly row: StoredFrameworkMigrationCollisionHeadRow;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  readonly lastEvent: RestoredFrameworkMigrationEvent | null;
}

export const restoreStoredFrameworkMigrationCollisionHead = Effect.fn(
  "FrameworkMigrationCollisionHead.restoreStored",
)(function* (
  input: RestoreStoredFrameworkMigrationCollisionHeadInput,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionHead,
  FrameworkMigrationValueError
> {
  const { row } = input;
  if (
    !isRestoredFrameworkMigrationCollisionDomain(input.collision) ||
    !isRestoredFreshRelationalMigrationPlan(input.plan) ||
    !isRestoredFrameworkMigrationPlanAdmission(input.admission) ||
    input.plan.collision !== input.collision ||
    input.admission.collision !== input.collision ||
    input.admission.plan !== input.plan ||
    row.collisionStorageId !== input.collision.storageId ||
    row.currentPlanStorageId !== input.plan.storageId ||
    row.currentAdmissionStorageId !== input.admission.storageId ||
    !(yield* shaEquals(
      row.currentPlanSha256,
      input.plan.plan.migrationPlanSha256,
    )) ||
    !(yield* shaEquals(
      row.currentAdmissionSha256,
      input.admission.admission.sha256,
    ))
  ) {
    return yield* corrupt();
  }
  const stored = yield* decodeEventCanonical(
    row,
    row.collisionHeadSha256,
    FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
    FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
  );
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "collisionHead",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  });
  const headRevision = yield* nonNegativeInt64(row.headRevision);
  const attemptFence = yield* nonNegativeInt64(row.attemptFence);
  if (
    !isStoredFrameworkMigrationCollisionHeadFrame(frame) ||
    !sameCollision(frame.collision, input.collision.coordinate) ||
    frame.currentPlan.planSha256 !== input.plan.plan.migrationPlanSha256 ||
    frame.currentPlan.admissionSha256 !== input.admission.admission.sha256 ||
    frame.headRevision !== headRevision || frame.attemptFence !== attemptFence ||
    !(yield* currentAttemptProjectionMatches(row, frame, input)) ||
    !(yield* lastEventProjectionMatches(row, frame, input))
  ) {
    return yield* corrupt();
  }
  const head = yield* captureFrameworkMigrationCollisionHead({
    admission: input.admission.admission,
    headRevision: frame.headRevision,
    attemptFence: frame.attemptFence,
    currentAttempt: frame.currentAttempt,
    lastEvent: frame.lastEvent,
    updatedAt: frame.updatedAt,
  });
  if (head.sha256 !== stored.sha256Hex || head.canonicalJson !== stored.canonicalJson) {
    return yield* corrupt();
  }
  const restored = Object.freeze({
    collision: input.collision,
    plan: input.plan,
    admission: input.admission,
    head,
  });
  restoredCollisionHeads.add(restored);
  return restored;
});

export function isRestoredFrameworkMigrationCollisionHead(
  input: RestoredFrameworkMigrationCollisionHead,
): boolean {
  return restoredCollisionHeads.has(input);
}

const previousEventProjectionMatches = Effect.fn(
  "FrameworkMigrationEvent.verifyStoredPreviousProjection",
)(function* (
  row: StoredFrameworkMigrationEventRow,
  frame: FrameworkMigrationEventFrame,
  input: RestoreStoredFrameworkMigrationEventInput,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (frame.previousEvent === null) {
    return input.previous === null && row.previousEventStorageId === null &&
      row.previousEventSequence === null && row.previousEventSha256 === null;
  }
  return input.previous !== null && restoredEvents.has(input.previous) &&
    input.previous.collision === input.collision &&
    row.previousEventStorageId === input.previous.storageId &&
    (yield* nullableNonNegativeInt64(row.previousEventSequence)) ===
      input.previous.event.frame.sequence &&
    (yield* nullableShaEquals(
      row.previousEventSha256,
      input.previous.event.sha256,
    )) &&
    frame.previousEvent.sequence === input.previous.event.frame.sequence &&
    frame.previousEvent.eventSha256 === input.previous.event.sha256 &&
    canonicalNonNegativeInt64Precedes(
      input.previous.event.frame.sequence,
      frame.sequence,
    );
});

function canonicalNonNegativeInt64Precedes(
  left: string,
  right: string,
): boolean {
  return left.length < right.length ||
    (left.length === right.length && left < right);
}

const eventSubjectProjectionMatches = Effect.fn(
  "FrameworkMigrationEvent.verifyStoredSubjectProjection",
)(function* (
  row: StoredFrameworkMigrationEventRow,
  frame: FrameworkMigrationEventFrame,
  input: RestoreStoredFrameworkMigrationEventInput,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (frame.kind === "leaseRenewed") {
    if (input.subject.kind !== "leaseRenewed") return false;
    const attempt = input.subject.attempt;
    return isRestoredFrameworkMigrationAttemptStart(attempt) &&
      attempt.collision === input.collision && row.subjectSha256 === null &&
      frame.attemptId === attempt.attempt.frame.attemptId &&
      frame.attemptFence === attempt.attempt.frame.attemptFence &&
      row.leaseAttemptId === frame.attemptId &&
      (yield* nullableNonNegativeInt64(row.leaseAttemptFence)) ===
        frame.attemptFence && row.leaseOwnerId === frame.leaseOwnerId &&
      storedDateMatchesCanonicalInstant(
        row.leaseExpiresAt,
        frame.leaseExpiresAt,
      );
  }
  if (
    row.leaseAttemptId !== null || row.leaseAttemptFence !== null ||
    row.leaseOwnerId !== null || row.leaseExpiresAt !== null
  ) return false;
  const subjectSha256 = authenticatedEventSubjectSha256(
    input.subject,
    input.collision,
  );
  return subjectSha256 !== undefined &&
    subjectSha256 === eventFrameSubjectSha256(frame) &&
    (yield* nullableShaEquals(row.subjectSha256, subjectSha256));
});

function authenticatedEventSubjectSha256(
  subject: RestoredFrameworkMigrationEventSubject,
  collision: RestoredFrameworkMigrationCollisionDomain,
): string | undefined {
  switch (subject.kind) {
    case "planAdmitted":
      return isRestoredFrameworkMigrationPlanAdmission(subject.admission) &&
          subject.admission.collision === collision
        ? subject.admission.admission.sha256
        : undefined;
    case "attemptStarted":
      return isRestoredFrameworkMigrationAttemptStart(subject.attempt) &&
          subject.attempt.collision === collision
        ? subject.attempt.attempt.sha256
        : undefined;
    case "stepCompleted":
      return isRestoredFrameworkMigrationStepReceipt(subject.receipt) &&
          subject.receipt.attempt.collision === collision
        ? subject.receipt.receipt.sha256
        : undefined;
    case "attemptTerminated":
      return isRestoredFrameworkMigrationAttemptTerminal(subject.terminal) &&
          subject.terminal.attempt.collision === collision
        ? subject.terminal.terminal.sha256
        : undefined;
    case "installationPublished":
      return isRestoredFrameworkSchemaInstallation(subject.installation) &&
          subject.installation.collision === collision
        ? subject.installation.installation.sha256
        : undefined;
    case "readinessPublished":
      return isRestoredFrameworkSchemaReadiness(subject.readiness) &&
          subject.readiness.installation.collision === collision
        ? subject.readiness.readiness.sha256
        : undefined;
    case "leaseRenewed":
      return undefined;
  }
}

function eventFrameSubjectSha256(
  frame: Exclude<FrameworkMigrationEventFrame, { readonly kind: "leaseRenewed" }>,
): string {
  switch (frame.kind) {
    case "planAdmitted":
      return frame.admissionSha256;
    case "attemptStarted":
      return frame.attemptStartSha256;
    case "stepCompleted":
      return frame.stepReceiptSha256;
    case "attemptTerminated":
      return frame.terminalSha256;
    case "installationPublished":
      return frame.installationReceiptSha256;
    case "readinessPublished":
      return frame.readinessSha256;
  }
}

const currentAttemptProjectionMatches = Effect.fn(
  "FrameworkMigrationCollisionHead.verifyStoredAttemptProjection",
)(function* (
  row: StoredFrameworkMigrationCollisionHeadRow,
  frame: FrameworkMigrationCollisionHeadFrame,
  input: RestoreStoredFrameworkMigrationCollisionHeadInput,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (frame.currentAttempt === null) {
    return input.currentAttempt === null &&
      row.currentAttemptStorageId === null && row.currentAttemptId === null &&
      row.currentAttemptFence === null && row.currentLeaseOwnerId === null &&
      row.currentLeaseExpiresAt === null;
  }
  return input.currentAttempt !== null &&
    isRestoredFrameworkMigrationAttemptStart(input.currentAttempt) &&
    input.currentAttempt.collision === input.collision &&
    input.currentAttempt.plan === input.plan &&
    input.currentAttempt.admission === input.admission &&
    row.currentAttemptStorageId === input.currentAttempt.storageId &&
    row.currentAttemptId === frame.currentAttempt.attemptId &&
    frame.currentAttempt.attemptId === input.currentAttempt.attempt.frame.attemptId &&
    frame.currentAttempt.attemptFence ===
      input.currentAttempt.attempt.frame.attemptFence &&
    (yield* nullableNonNegativeInt64(row.currentAttemptFence)) ===
      frame.currentAttempt.attemptFence &&
    row.currentLeaseOwnerId === frame.currentAttempt.leaseOwnerId &&
    storedDateMatchesCanonicalInstant(
      row.currentLeaseExpiresAt,
      frame.currentAttempt.leaseExpiresAt,
    );
});

const lastEventProjectionMatches = Effect.fn(
  "FrameworkMigrationCollisionHead.verifyStoredEventProjection",
)(function* (
  row: StoredFrameworkMigrationCollisionHeadRow,
  frame: FrameworkMigrationCollisionHeadFrame,
  input: RestoreStoredFrameworkMigrationCollisionHeadInput,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  if (frame.lastEvent === null) {
    return input.lastEvent === null && row.lastEventStorageId === null &&
      row.lastEventSequence === null && row.lastEventSha256 === null;
  }
  return input.lastEvent !== null && restoredEvents.has(input.lastEvent) &&
    input.lastEvent.collision === input.collision &&
    row.lastEventStorageId === input.lastEvent.storageId &&
    (yield* nullableNonNegativeInt64(row.lastEventSequence)) ===
      input.lastEvent.event.frame.sequence &&
    (yield* nullableShaEquals(
      row.lastEventSha256,
      input.lastEvent.event.sha256,
    )) && frame.lastEvent.sequence === input.lastEvent.event.frame.sequence &&
    frame.lastEvent.eventSha256 === input.lastEvent.event.sha256;
});

const decodeEventCanonical = Effect.fn(
  "FrameworkMigrationLedgerValue.decodeStoredMetadata",
)(function* (
  row: StoredCanonicalRow,
  sha256Bytes: unknown,
  format: string,
  version: number,
): Effect.fn.Return<
  Readonly<{
    readonly sha256Hex: string;
    readonly canonicalBytes: Uint8Array;
    readonly canonicalJson: string;
  }>,
  FrameworkMigrationValueError
> {
  return yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    sha256Bytes,
    {
      format,
      version,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
});

const nonNegativeInt64 = Effect.fn(
  "FrameworkMigrationLedgerValue.decodeStoredNonNegativeInt64",
)(function* (
  input: unknown,
): Effect.fn.Return<string, FrameworkMigrationValueError> {
  return yield* Effect.fromResult(decodeStoredNonNegativeInt64TextResult(
    input,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
});

const nullableNonNegativeInt64 = Effect.fn(
  "FrameworkMigrationLedgerValue.decodeNullableStoredNonNegativeInt64",
)(function* (
  input: unknown,
): Effect.fn.Return<string | null, FrameworkMigrationValueError> {
  return input === null ? null : yield* nonNegativeInt64(input);
});

const shaEquals = Effect.fn(
  "FrameworkMigrationLedgerValue.storedSha256Equals",
)(function* (
  input: unknown,
  expected: string,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  const sha256 = yield* Effect.fromResult(decodeStoredSha256HexResult(
    input,
    FrameworkMigrationValueError.storedStateCorrupt,
  ));
  return sha256 === expected;
});

const nullableShaEquals = Effect.fn(
  "FrameworkMigrationLedgerValue.nullableStoredSha256Equals",
)(function* (
  input: unknown,
  expected: string,
): Effect.fn.Return<boolean, FrameworkMigrationValueError> {
  return input !== null && (yield* shaEquals(input, expected));
});

function sameCollision(
  left: FrameworkMigrationEventFrame["collision"],
  right: FrameworkMigrationEventFrame["collision"],
): boolean {
  return left.targetNamespace.deploymentId ===
      right.targetNamespace.deploymentId &&
    left.targetNamespace.physicalDatabaseIdentity ===
      right.targetNamespace.physicalDatabaseIdentity &&
    left.targetNamespace.schemaName === right.targetNamespace.schemaName &&
    left.owner === right.owner && left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function corrupt(): Effect.Effect<never, FrameworkMigrationValueError> {
  return Effect.fail(FrameworkMigrationValueError.storedStateCorrupt());
}
