import { and, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  corroborateRestoredFrameworkSchemaInstallationInTransactionEffect,
  restoreStoredFrameworkSchemaInstallationReferenceByReceiptSha256InTransactionEffect,
} from "../frameworkSchema/installation/installationRepository";
import {
  corroborateRestoredFrameworkSchemaReadinessInTransactionEffect,
  restoreStoredFrameworkSchemaReadinessReferenceBySha256InTransactionEffect,
} from "../frameworkSchema/installation/readinessRepository";
import {
  isRestoredFrameworkSchemaInstallation,
  isRestoredFrameworkSchemaReadiness,
} from "../frameworkSchema/installation/storedMetadataRestoration";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationEvent,
  isStoredFrameworkMigrationEventFrame,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationEventSha256 } from "./identity";
import {
  corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect,
  operationalFrameworkMigrationLeaseExpiryDate,
  restoreStoredFrameworkMigrationAttemptStartReferenceByIdentityInTransactionEffect,
  restoreStoredFrameworkMigrationAttemptStartReferenceBySha256InTransactionEffect,
} from "./migrationAttemptRepository";
import {
  corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect,
  restoreStoredFrameworkMigrationAttemptTerminalReferenceBySha256InTransactionEffect,
} from "./migrationAttemptTerminalRepository";
import {
  corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect,
  restoreStoredFrameworkMigrationPlanAdmissionReferenceBySha256InTransactionEffect,
} from "./migrationPlanAdmissionRepository";
import {
  corroborateRestoredFrameworkMigrationStepReceiptInTransactionEffect,
  restoreStoredFrameworkMigrationStepReceiptReferenceBySha256InTransactionEffect,
} from "./migrationStepReceiptRepository";
import {
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationCollisionCoordinate,
  type FrameworkMigrationEventFrame,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import { fxSystemFrameworkMigrationEvents } from "./schema";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationAttemptTerminal,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationPlanAdmission,
  isRestoredFrameworkMigrationStepReceipt,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationCollisionDomain,
} from "./storedRestoration";
import {
  isRestoredFrameworkMigrationEvent,
  restoreStoredFrameworkMigrationEvent,
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationEvent,
  type RestoredFrameworkMigrationEventSubject,
  type StoredFrameworkMigrationEventRow,
} from "./storedEventRestoration";
import {
  readFrameworkMigrationCollisionDomainForOperationInTransactionEffect,
  readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect,
} from "./targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";

type FrameworkMigrationEvent = CapturedFrameworkMigrationValue<
  FrameworkMigrationEventFrame,
  FrameworkMigrationEventSha256
>;

type EventRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "appendEvent" | "readEvent"
>;

interface PreparedFrameworkMigrationEvent {
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly previous: RestoredFrameworkMigrationEvent | null;
  readonly subject: RestoredFrameworkMigrationEventSubject;
  readonly event: FrameworkMigrationEvent;
  readonly eventSequence: bigint;
  readonly eventSha256Bytes: Uint8Array;
  readonly subjectSha256Bytes: Uint8Array | null;
  readonly leaseExpiresAt: Date | null;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkMigrationEventDriverRow
  extends StoredFrameworkMigrationEventRow {
  readonly eventStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly eventSequence: bigint;
  readonly eventSha256: Uint8Array;
  readonly previousEventStorageId: bigint | null;
  readonly previousEventSequence: bigint | null;
  readonly previousEventSha256: Uint8Array | null;
  readonly eventKind: FrameworkMigrationEventFrame["kind"];
  readonly subjectSha256: Uint8Array | null;
  readonly leaseAttemptId: string | null;
  readonly leaseAttemptFence: bigint | null;
  readonly leaseOwnerId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_EVENT_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_EVENT_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface DecodedFrameworkMigrationEventRoot {
  readonly storageId: bigint;
  readonly collisionStorageId: bigint;
  readonly previousEventStorageId: bigint | null;
  readonly eventSha256: string;
  readonly frame: FrameworkMigrationEventFrame;
}

interface RestoredFrameworkMigrationEventOccupant {
  readonly value: RestoredFrameworkMigrationEvent;
  readonly previous: RestoredFrameworkMigrationEvent | null;
  readonly subject: RestoredFrameworkMigrationEventSubject;
}

interface FrameworkMigrationEventOccupantLookups {
  readonly readBySequence: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationEventOccupant>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByDigest: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationEventOccupant>,
    FrameworkMigrationRepositoryError
  >;
}

const UTF8 = new TextEncoder();

export const appendFrameworkMigrationEventInTransactionEffect = Effect.fn(
  "FrameworkMigrationEventRepository.append",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  previous: RestoredFrameworkMigrationEvent | null,
  subject: RestoredFrameworkMigrationEventSubject,
  event: FrameworkMigrationEvent,
): Effect.fn.Return<
  RestoredFrameworkMigrationEvent,
  FrameworkMigrationRepositoryError
> {
  const operation = "appendEvent" as const;
  const prepared = yield* prepareExpectedEvent(
    collision,
    previous,
    subject,
    event,
    operation,
  );
  const storedCollision = yield* corroborateCollision(
    transaction,
    prepared.collision,
    operation,
  );
  const storedPrevious = prepared.previous === null
    ? null
    : yield* corroborateRestoredFrameworkMigrationEventInTransactionEffect(
      transaction,
      prepared.previous,
      operation,
    );
  const storedSubject = yield* corroborateEventSubject(
    transaction,
    prepared.subject,
    operation,
  );
  if (
    (storedPrevious !== null &&
      storedPrevious.collision.storageId !== storedCollision.storageId) ||
    !eventSubjectBelongsToCollision(storedSubject, storedCollision)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }

  const lease = prepared.event.frame.kind === "leaseRenewed"
    ? Object.freeze({
      subjectSha256: null,
      leaseAttemptId: prepared.event.frame.attemptId,
      leaseAttemptFence: BigInt(prepared.event.frame.attemptFence),
      leaseOwnerId: prepared.event.frame.leaseOwnerId,
      leaseExpiresAt: prepared.leaseExpiresAt,
    })
    : Object.freeze({
      subjectSha256: prepared.subjectSha256Bytes,
      leaseAttemptId: null,
      leaseAttemptFence: null,
      leaseOwnerId: null,
      leaseExpiresAt: null,
    });
  const insertedRows = yield* runRepositoryStatement(
    operation,
    transaction.insert(fxSystemFrameworkMigrationEvents).values({
      collisionStorageId: storedCollision.storageId,
      eventSequence: prepared.eventSequence,
      eventSha256: prepared.eventSha256Bytes,
      previousEventStorageId: storedPrevious?.storageId ?? null,
      previousEventSequence: storedPrevious === null
        ? null
        : BigInt(storedPrevious.event.frame.sequence),
      previousEventSha256: storedPrevious === null
        ? null
        : yield* decodeAuthenticatedSha256(storedPrevious.event.sha256),
      eventKind: prepared.event.frame.kind,
      ...lease,
      frameFormat: prepared.event.frame.format,
      frameVersion: prepared.event.frame.version,
      canonicalByteLength: prepared.canonicalBytes.byteLength,
      canonicalBytes: prepared.canonicalBytes,
    }).onConflictDoNothing().returning({
      eventStorageId: fxSystemFrameworkMigrationEvents.eventStorageId,
    }),
  ).pipe(Effect.map(detachDriverRows));
  if (insertedRows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const inserted = insertedRows[0];
  if (inserted !== undefined) {
    yield* Effect.fromResult(decodeStoredStorageIdResult(
      inserted.eventStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ));
  }

  const resolved = yield* resolveExpectedEvent(
    transaction,
    storedCollision,
    storedPrevious,
    storedSubject,
    prepared.event,
    prepared.eventSha256Bytes,
    prepared.eventSequence,
    operation,
  );
  if (Option.isNone(resolved)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return resolved.value;
});

export const readFrameworkMigrationEventInTransactionEffect = Effect.fn(
  "FrameworkMigrationEventRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  previous: RestoredFrameworkMigrationEvent | null,
  subject: RestoredFrameworkMigrationEventSubject,
  event: FrameworkMigrationEvent,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationEvent>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readEvent" as const;
  const prepared = yield* prepareExpectedEvent(
    collision,
    previous,
    subject,
    event,
    operation,
  );
  const storedCollision = yield* corroborateCollision(
    transaction,
    prepared.collision,
    operation,
  );
  const storedPrevious = prepared.previous === null
    ? null
    : yield* corroborateRestoredFrameworkMigrationEventInTransactionEffect(
      transaction,
      prepared.previous,
      operation,
    );
  const storedSubject = yield* corroborateEventSubject(
    transaction,
    prepared.subject,
    operation,
  );
  if (
    (storedPrevious !== null &&
      storedPrevious.collision.storageId !== storedCollision.storageId) ||
    !eventSubjectBelongsToCollision(storedSubject, storedCollision)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return yield* resolveExpectedEvent(
    transaction,
    storedCollision,
    storedPrevious,
    storedSubject,
    prepared.event,
    prepared.eventSha256Bytes,
    prepared.eventSequence,
    operation,
  );
});

/** Source-private same-transaction corroboration for downstream aggregates. */
export const corroborateRestoredFrameworkMigrationEventInTransactionEffect =
  Effect.fn("FrameworkMigrationEventRepository.corroborateRestored")(
    function* (
      transaction: FlarexMetadataTransaction,
      expected: RestoredFrameworkMigrationEvent,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkMigrationEvent,
      FrameworkMigrationRepositoryError
    > {
      const authority = isRestoredFrameworkMigrationEvent(expected)
        ? restoredFrameworkMigrationEventAuthority(expected)
        : undefined;
      if (authority === undefined) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const row = yield* loadEventRootByStorageId(
        transaction,
        expected.storageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const occupant = yield* restoreEventChain(
        transaction,
        row.value,
        expected.collision,
        operation,
      );
      if (!restoredEventExactlyMatches(
        occupant,
        expected,
        authority.previous,
        authority.subject,
      )) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      return occupant.value;
    },
  );

/** Source-private restoration of an exact stored event reference. */
export const restoreStoredFrameworkMigrationEventReferenceInTransactionEffect =
  Effect.fn("FrameworkMigrationEventRepository.restoreReference")(
    function* (
      transaction: FlarexMetadataTransaction,
      preferredCollision: RestoredFrameworkMigrationCollisionDomain,
      eventStorageId: bigint,
      eventSequence: string,
      eventSha256: FrameworkMigrationEventSha256,
      operation: FrameworkMigrationRepositoryOperation,
    ): Effect.fn.Return<
      RestoredFrameworkMigrationEvent,
      FrameworkMigrationRepositoryError
    > {
      const row = yield* loadEventRootByStorageId(
        transaction,
        eventStorageId,
        operation,
      );
      if (Option.isNone(row)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const occupant = yield* restoreEventChain(
        transaction,
        row.value,
        preferredCollision,
        operation,
      );
      if (
        occupant.value.event.frame.sequence !== eventSequence ||
        occupant.value.event.sha256 !== eventSha256
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return occupant.value;
    },
  );

const prepareExpectedEvent = Effect.fn(
  "FrameworkMigrationEventRepository.prepareExpected",
)(function* (
  collision: RestoredFrameworkMigrationCollisionDomain,
  previous: RestoredFrameworkMigrationEvent | null,
  subject: RestoredFrameworkMigrationEventSubject,
  event: FrameworkMigrationEvent,
  operation: EventRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkMigrationEvent,
  FrameworkMigrationRepositoryError
> {
  if (
    !isRestoredFrameworkMigrationCollisionDomain(collision) ||
    !sameCollisionCoordinate(event.frame.collision, collision.coordinate) ||
    !eventSubjectMatchesFrame(subject, collision, event.frame) ||
    !previousMatchesFrame(previous, collision, event.frame)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const recaptured = yield* captureFrameworkMigrationEvent(event.frame).pipe(
    Effect.mapError(error => mapInputValueError(operation, error)),
  );
  if (
    recaptured.sha256 !== event.sha256 ||
    recaptured.canonicalJson !== event.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const leaseExpiresAt = recaptured.frame.kind === "leaseRenewed"
    ? operationalFrameworkMigrationLeaseExpiryDate(
      recaptured.frame.leaseExpiresAt,
    )
    : null;
  if (recaptured.frame.kind === "leaseRenewed" && leaseExpiresAt === undefined) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const subjectSha256 = eventFrameSubjectSha256(recaptured.frame);
  return Object.freeze({
    collision,
    previous,
    subject,
    event: recaptured,
    eventSequence: BigInt(recaptured.frame.sequence),
    eventSha256Bytes: yield* decodeAuthenticatedSha256(recaptured.sha256),
    subjectSha256Bytes: subjectSha256 === null
      ? null
      : yield* decodeAuthenticatedSha256(subjectSha256),
    leaseExpiresAt: leaseExpiresAt ?? null,
    canonicalBytes: UTF8.encode(recaptured.canonicalJson),
  });
});

const corroborateCollision = Effect.fn(
  "FrameworkMigrationEventRepository.corroborateCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  expected: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkMigrationCollisionDomain(expected)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const restored = yield*
    readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
      transaction,
      expected.targetNamespace,
      expected.coordinate,
      operation,
    );
  if (
    Option.isNone(restored) || restored.value.storageId !== expected.storageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return restored.value;
});

const corroborateEventSubject = Effect.fn(
  "FrameworkMigrationEventRepository.corroborateSubject",
)(function* (
  transaction: FlarexMetadataTransaction,
  subject: RestoredFrameworkMigrationEventSubject,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationEventSubject,
  FrameworkMigrationRepositoryError
> {
  switch (subject.kind) {
    case "planAdmitted":
      return Object.freeze({
        kind: subject.kind,
        admission: yield*
          corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect(
            transaction,
            subject.admission,
            operation,
          ),
      });
    case "attemptStarted":
    case "leaseRenewed":
      return Object.freeze({
        kind: subject.kind,
        attempt: yield*
          corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            subject.attempt,
            operation,
          ),
      });
    case "stepCompleted":
      return Object.freeze({
        kind: subject.kind,
        receipt: yield*
          corroborateRestoredFrameworkMigrationStepReceiptInTransactionEffect(
            transaction,
            subject.receipt,
            operation,
          ),
      });
    case "attemptTerminated":
      return Object.freeze({
        kind: subject.kind,
        terminal: yield*
          corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            subject.terminal,
            operation,
          ),
      });
    case "installationPublished":
      return Object.freeze({
        kind: subject.kind,
        installation: yield*
          corroborateRestoredFrameworkSchemaInstallationInTransactionEffect(
            transaction,
            subject.installation,
            operation,
          ),
      });
    case "readinessPublished":
      return Object.freeze({
        kind: subject.kind,
        readiness: yield*
          corroborateRestoredFrameworkSchemaReadinessInTransactionEffect(
            transaction,
            subject.readiness,
            operation,
          ),
      });
  }
});

const resolveExpectedEvent = Effect.fn(
  "FrameworkMigrationEventRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  previous: RestoredFrameworkMigrationEvent | null,
  subject: RestoredFrameworkMigrationEventSubject,
  expected: FrameworkMigrationEvent,
  eventSha256Bytes: Uint8Array,
  eventSequence: bigint,
  operation: EventRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationEvent>,
  FrameworkMigrationRepositoryError
> {
  return yield* resolveAuthenticatedFrameworkMigrationEventOccupantsEffect(
    collision,
    previous,
    subject,
    expected,
    operation,
    {
      readBySequence: () => loadEventOccupantBySequence(
        transaction,
        collision,
        eventSequence,
        operation,
        previous,
      ),
      readByDigest: () => loadEventOccupantByDigest(
        transaction,
        collision,
        eventSha256Bytes,
        operation,
        previous,
      ),
    },
  );
});

/** Source-private collision policy with a deliberately lazy digest lookup. */
export const resolveAuthenticatedFrameworkMigrationEventOccupantsEffect =
  Effect.fn("FrameworkMigrationEventRepository.resolveOccupants")(
    function* (
      collision: RestoredFrameworkMigrationCollisionDomain,
      previous: RestoredFrameworkMigrationEvent | null,
      subject: RestoredFrameworkMigrationEventSubject,
      expected: FrameworkMigrationEvent,
      operation: EventRepositoryOperation,
      lookups: FrameworkMigrationEventOccupantLookups,
    ): Effect.fn.Return<
      Option.Option<RestoredFrameworkMigrationEvent>,
      FrameworkMigrationRepositoryError
    > {
      const bySequence = yield* lookups.readBySequence();
      if (Option.isSome(bySequence)) {
        if (eventExactlyMatches(
          bySequence.value,
          collision,
          previous,
          subject,
          expected,
        )) return Option.some(bySequence.value.value);
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.immutableConflict(operation),
        );
      }

      const byDigest = yield* lookups.readByDigest();
      if (Option.isNone(byDigest)) return Option.none();
      if (eventExactlyMatches(
        byDigest.value,
        collision,
        previous,
        subject,
        expected,
      )) return Option.some(byDigest.value.value);
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    },
  );

const loadEventOccupantBySequence = Effect.fn(
  "FrameworkMigrationEventRepository.loadBySequence",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  eventSequence: bigint,
  operation: FrameworkMigrationRepositoryOperation,
  preferredPrevious?: RestoredFrameworkMigrationEvent | null,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationEventOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(eventReadSelection).from(
      fxSystemFrameworkMigrationEvents,
    ).where(and(
      eq(
        fxSystemFrameworkMigrationEvents.collisionStorageId,
        collision.storageId,
      ),
      eq(fxSystemFrameworkMigrationEvents.eventSequence, eventSequence),
    )).limit(2),
  ).pipe(Effect.map(detachDriverRows));
  if (rows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return rows[0] === undefined
    ? Option.none()
    : Option.some(yield* restoreEventChain(
      transaction,
      rows[0],
      collision,
      operation,
      preferredPrevious,
    ));
});

const loadEventOccupantByDigest = Effect.fn(
  "FrameworkMigrationEventRepository.loadByDigest",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  eventSha256: Uint8Array,
  operation: FrameworkMigrationRepositoryOperation,
  preferredPrevious?: RestoredFrameworkMigrationEvent | null,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationEventOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(eventReadSelection).from(
      fxSystemFrameworkMigrationEvents,
    ).where(eq(
      fxSystemFrameworkMigrationEvents.eventSha256,
      eventSha256,
    )).limit(2),
  ).pipe(Effect.map(detachDriverRows));
  if (rows.length > 1) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return rows[0] === undefined
    ? Option.none()
    : Option.some(yield* restoreEventChain(
      transaction,
      rows[0],
      preferredCollision,
      operation,
      preferredPrevious,
    ));
});

const restoreEventChain = Effect.fn(
  "FrameworkMigrationEventRepository.restoreChain",
)(function* (
  transaction: FlarexMetadataTransaction,
  root: FrameworkMigrationEventDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
  preferredPrevious?: RestoredFrameworkMigrationEvent | null,
): Effect.fn.Return<
  RestoredFrameworkMigrationEventOccupant,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkMigrationCollisionDomain(preferredCollision)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const rootDecoded = yield* decodeEventRoot(root, operation);
  const collisionPreference = preferredPrevious !== undefined &&
      preferredPrevious !== null &&
      isRestoredFrameworkMigrationEvent(preferredPrevious)
    ? preferredPrevious.collision
    : preferredCollision;
  const collision = yield* resolveEventOccupantCollision(
    transaction,
    root,
    rootDecoded.frame,
    collisionPreference,
    operation,
  );
  const rows: FrameworkMigrationEventDriverRow[] = [];
  const decodedRows: DecodedFrameworkMigrationEventRoot[] = [];
  const seenStorageIds = new Set<bigint>();
  const seenSequences = new Set<string>();
  const seenDigests = new Set<string>();
  let anchoredPrevious: RestoredFrameworkMigrationEvent | null | undefined;
  let row = root;
  while (true) {
    const decoded = rows.length === 0
      ? rootDecoded
      : yield* decodeEventRoot(row, operation);
    if (
      decoded.collisionStorageId !== collision.storageId ||
      !sameCollisionCoordinate(decoded.frame.collision, collision.coordinate) ||
      seenStorageIds.has(decoded.storageId) ||
      seenSequences.has(decoded.frame.sequence) ||
      seenDigests.has(decoded.eventSha256)
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    seenStorageIds.add(decoded.storageId);
    seenSequences.add(decoded.frame.sequence);
    seenDigests.add(decoded.eventSha256);
    rows.push(row);
    decodedRows.push(decoded);
    if (
      rows.length === 1 &&
      preferredPrevious !== undefined &&
      storedPreviousReferenceMatches(
        decoded,
        preferredPrevious,
        collision,
      )
    ) {
      anchoredPrevious = preferredPrevious;
      break;
    }
    if (decoded.previousEventStorageId === null) break;
    const previous = yield* loadEventRootByStorageId(
      transaction,
      decoded.previousEventStorageId,
      operation,
    );
    if (Option.isNone(previous)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    row = previous.value;
  }

  let previous: RestoredFrameworkMigrationEvent | null =
    anchoredPrevious ?? null;
  let rootOccupant: RestoredFrameworkMigrationEventOccupant | undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const eventRow = rows[index];
    const decoded = decodedRows[index];
    if (eventRow === undefined || decoded === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const subject = yield* restoreStoredEventSubject(
      transaction,
      collision,
      decoded.frame,
      operation,
    );
    const value: RestoredFrameworkMigrationEvent = yield*
      restoreStoredFrameworkMigrationEvent({
      row: eventRow,
      collision,
      previous,
      subject,
    }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
    const occupant: RestoredFrameworkMigrationEventOccupant = Object.freeze({
      value,
      previous,
      subject,
    });
    if (index === 0) rootOccupant = occupant;
    previous = value;
  }
  if (rootOccupant === undefined) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return rootOccupant;
});

const restoreStoredEventSubject = Effect.fn(
  "FrameworkMigrationEventRepository.restoreSubject",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  frame: FrameworkMigrationEventFrame,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationEventSubject,
  FrameworkMigrationRepositoryError
> {
  switch (frame.kind) {
    case "planAdmitted":
      return Object.freeze({
        kind: frame.kind,
        admission: yield*
          restoreStoredFrameworkMigrationPlanAdmissionReferenceBySha256InTransactionEffect(
            transaction,
            collision,
            frame.admissionSha256,
            operation,
          ),
      });
    case "attemptStarted":
      return Object.freeze({
        kind: frame.kind,
        attempt: yield*
          restoreStoredFrameworkMigrationAttemptStartReferenceBySha256InTransactionEffect(
            transaction,
            collision,
            frame.attemptStartSha256,
            operation,
          ),
      });
    case "leaseRenewed":
      return Object.freeze({
        kind: frame.kind,
        attempt: yield*
          restoreStoredFrameworkMigrationAttemptStartReferenceByIdentityInTransactionEffect(
            transaction,
            collision,
            frame.attemptId,
            frame.attemptFence,
            operation,
          ),
      });
    case "stepCompleted":
      return Object.freeze({
        kind: frame.kind,
        receipt: yield*
          restoreStoredFrameworkMigrationStepReceiptReferenceBySha256InTransactionEffect(
            transaction,
            collision,
            frame.stepReceiptSha256,
            operation,
          ),
      });
    case "attemptTerminated":
      return Object.freeze({
        kind: frame.kind,
        terminal: yield*
          restoreStoredFrameworkMigrationAttemptTerminalReferenceBySha256InTransactionEffect(
            transaction,
            collision,
            frame.terminalSha256,
            operation,
          ),
      });
    case "installationPublished":
      return Object.freeze({
        kind: frame.kind,
        installation: yield*
          restoreStoredFrameworkSchemaInstallationReferenceByReceiptSha256InTransactionEffect(
            transaction,
            collision,
            frame.installationReceiptSha256,
            operation,
          ),
      });
    case "readinessPublished":
      return Object.freeze({
        kind: frame.kind,
        readiness: yield*
          restoreStoredFrameworkSchemaReadinessReferenceBySha256InTransactionEffect(
            transaction,
            collision,
            frame.readinessSha256,
            operation,
          ),
      });
  }
});

const decodeEventRoot = Effect.fn(
  "FrameworkMigrationEventRepository.decodeRoot",
)(function* (
  row: FrameworkMigrationEventDriverRow,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkMigrationEventRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.eventStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const collisionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.collisionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.eventSha256,
    {
      format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
      version: FRAMEWORK_MIGRATION_EVENT_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "event",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  const eventSequence = yield* Effect.fromResult(
    decodeStoredNonNegativeInt64TextResult(
      row.eventSequence,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  if (
    !isStoredFrameworkMigrationEventFrame(frame) ||
    eventSequence !== frame.sequence ||
    row.eventKind !== frame.kind
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }

  let previousEventStorageId: bigint | null = null;
  if (frame.previousEvent === null) {
    if (
      row.previousEventStorageId !== null ||
      row.previousEventSequence !== null ||
      row.previousEventSha256 !== null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  } else {
    if (
      row.previousEventStorageId === null ||
      row.previousEventSequence === null ||
      row.previousEventSha256 === null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    previousEventStorageId = yield* Effect.fromResult(
      decodeStoredStorageIdResult(
        row.previousEventStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    const previousEventSequence = yield* Effect.fromResult(
      decodeStoredNonNegativeInt64TextResult(
        row.previousEventSequence,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    const previousEventSha256 = yield* Effect.fromResult(
      decodeStoredSha256HexResult(
        row.previousEventSha256,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    if (
      previousEventStorageId === storageId ||
      previousEventSequence !== frame.previousEvent.sequence ||
      previousEventSha256 !== frame.previousEvent.eventSha256 ||
      BigInt(previousEventSequence) >= BigInt(frame.sequence)
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }
  return Object.freeze({
    storageId,
    collisionStorageId,
    previousEventStorageId,
    eventSha256: stored.sha256Hex,
    frame,
  });
});

const resolveEventOccupantCollision = Effect.fn(
  "FrameworkMigrationEventRepository.resolveOccupantCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationEventDriverRow,
  frame: FrameworkMigrationEventFrame,
  preferred: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (
    isRestoredFrameworkMigrationCollisionDomain(preferred) &&
    row.collisionStorageId === preferred.storageId &&
    sameCollisionCoordinate(frame.collision, preferred.coordinate)
  ) return preferred;

  const targetValue = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: frame.collision.targetNamespace.deploymentId,
    physicalDatabaseIdentity:
      frame.collision.targetNamespace.physicalDatabaseIdentity,
    schemaName: frame.collision.targetNamespace.schemaName,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  const target = yield*
    readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect(
      transaction,
      targetValue,
      operation,
    ).pipe(Effect.mapError(error => mapStoredRepositoryError(operation, error)));
  if (Option.isNone(target)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const collision = yield*
    readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
      transaction,
      target.value,
      frame.collision,
      operation,
    ).pipe(Effect.mapError(error => mapStoredRepositoryError(operation, error)));
  if (
    Option.isNone(collision) ||
    collision.value.storageId !== row.collisionStorageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return collision.value;
});

const loadEventRootByStorageId = Effect.fn(
  "FrameworkMigrationEventRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  eventStorageId: bigint,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationEventDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(eventReadSelection).from(
      fxSystemFrameworkMigrationEvents,
    ).where(eq(
      fxSystemFrameworkMigrationEvents.eventStorageId,
      eventStorageId,
    )).limit(1),
  ).pipe(Effect.map(detachDriverRows));
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

function previousMatchesFrame(
  previous: RestoredFrameworkMigrationEvent | null,
  collision: RestoredFrameworkMigrationCollisionDomain,
  frame: FrameworkMigrationEventFrame,
): boolean {
  if (frame.previousEvent === null) return previous === null;
  return previous !== null && isRestoredFrameworkMigrationEvent(previous) &&
    restoredFrameworkMigrationEventAuthority(previous) !== undefined &&
    previous.collision.storageId === collision.storageId &&
    previous.event.frame.sequence === frame.previousEvent.sequence &&
    previous.event.sha256 === frame.previousEvent.eventSha256 &&
    BigInt(previous.event.frame.sequence) < BigInt(frame.sequence);
}

function storedPreviousReferenceMatches(
  decoded: DecodedFrameworkMigrationEventRoot,
  preferred: RestoredFrameworkMigrationEvent | null,
  collision: RestoredFrameworkMigrationCollisionDomain,
): boolean {
  const token = decoded.frame.previousEvent;
  if (token === null) {
    return decoded.previousEventStorageId === null && preferred === null;
  }
  return decoded.previousEventStorageId !== null && preferred !== null &&
    isRestoredFrameworkMigrationEvent(preferred) &&
    restoredFrameworkMigrationEventAuthority(preferred) !== undefined &&
    preferred.collision.storageId === collision.storageId &&
    preferred.storageId === decoded.previousEventStorageId &&
    preferred.event.frame.sequence === token.sequence &&
    preferred.event.sha256 === token.eventSha256;
}

function eventSubjectMatchesFrame(
  subject: RestoredFrameworkMigrationEventSubject,
  collision: RestoredFrameworkMigrationCollisionDomain,
  frame: FrameworkMigrationEventFrame,
): boolean {
  if (subject.kind !== frame.kind) return false;
  switch (frame.kind) {
    case "planAdmitted":
      return subject.kind === frame.kind &&
        isRestoredFrameworkMigrationPlanAdmission(subject.admission) &&
        subject.admission.collision.storageId === collision.storageId &&
        subject.admission.admission.sha256 === frame.admissionSha256;
    case "attemptStarted":
      return subject.kind === frame.kind &&
        isRestoredFrameworkMigrationAttemptStart(subject.attempt) &&
        subject.attempt.collision.storageId === collision.storageId &&
        subject.attempt.attempt.sha256 === frame.attemptStartSha256;
    case "leaseRenewed":
      return subject.kind === frame.kind &&
        isRestoredFrameworkMigrationAttemptStart(subject.attempt) &&
        subject.attempt.collision.storageId === collision.storageId &&
        subject.attempt.attempt.frame.attemptId === frame.attemptId &&
        subject.attempt.attempt.frame.attemptFence === frame.attemptFence;
    case "stepCompleted":
      return subject.kind === frame.kind &&
        isRestoredFrameworkMigrationStepReceipt(subject.receipt) &&
        subject.receipt.attempt.collision.storageId === collision.storageId &&
        subject.receipt.receipt.sha256 === frame.stepReceiptSha256;
    case "attemptTerminated":
      return subject.kind === frame.kind &&
        isRestoredFrameworkMigrationAttemptTerminal(subject.terminal) &&
        subject.terminal.attempt.collision.storageId === collision.storageId &&
        subject.terminal.terminal.sha256 === frame.terminalSha256;
    case "installationPublished":
      return subject.kind === frame.kind &&
        isRestoredFrameworkSchemaInstallation(subject.installation) &&
        subject.installation.collision.storageId === collision.storageId &&
        subject.installation.installation.sha256 ===
          frame.installationReceiptSha256;
    case "readinessPublished":
      return subject.kind === frame.kind &&
        isRestoredFrameworkSchemaReadiness(subject.readiness) &&
        subject.readiness.installation.collision.storageId ===
          collision.storageId &&
        subject.readiness.readiness.sha256 === frame.readinessSha256;
  }
}

function eventSubjectBelongsToCollision(
  subject: RestoredFrameworkMigrationEventSubject,
  collision: RestoredFrameworkMigrationCollisionDomain,
): boolean {
  switch (subject.kind) {
    case "planAdmitted":
      return subject.admission.collision.storageId === collision.storageId;
    case "attemptStarted":
    case "leaseRenewed":
      return subject.attempt.collision.storageId === collision.storageId;
    case "stepCompleted":
      return subject.receipt.attempt.collision.storageId === collision.storageId;
    case "attemptTerminated":
      return subject.terminal.attempt.collision.storageId === collision.storageId;
    case "installationPublished":
      return subject.installation.collision.storageId === collision.storageId;
    case "readinessPublished":
      return subject.readiness.installation.collision.storageId ===
        collision.storageId;
  }
}

function eventFrameSubjectSha256(
  frame: FrameworkMigrationEventFrame,
): string | null {
  switch (frame.kind) {
    case "planAdmitted":
      return frame.admissionSha256;
    case "attemptStarted":
      return frame.attemptStartSha256;
    case "leaseRenewed":
      return null;
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

function eventExactlyMatches(
  occupant: RestoredFrameworkMigrationEventOccupant,
  collision: RestoredFrameworkMigrationCollisionDomain,
  previous: RestoredFrameworkMigrationEvent | null,
  subject: RestoredFrameworkMigrationEventSubject,
  expected: FrameworkMigrationEvent,
): boolean {
  return occupant.value.collision.storageId === collision.storageId &&
    restoredEventReferencesExactlyMatch(occupant.previous, previous) &&
    eventSubjectsExactlyMatch(occupant.subject, subject) &&
    occupant.value.event.sha256 === expected.sha256 &&
    occupant.value.event.canonicalJson === expected.canonicalJson;
}

function restoredEventExactlyMatches(
  occupant: RestoredFrameworkMigrationEventOccupant,
  expected: RestoredFrameworkMigrationEvent,
  expectedPrevious: RestoredFrameworkMigrationEvent | null,
  expectedSubject: RestoredFrameworkMigrationEventSubject,
): boolean {
  return occupant.value.storageId === expected.storageId &&
    occupant.value.collision.storageId === expected.collision.storageId &&
    occupant.value.event.sha256 === expected.event.sha256 &&
    occupant.value.event.canonicalJson === expected.event.canonicalJson &&
    restoredEventReferencesExactlyMatch(
      occupant.previous,
      expectedPrevious,
    ) && eventSubjectsExactlyMatch(occupant.subject, expectedSubject);
}

function restoredEventReferencesExactlyMatch(
  left: RestoredFrameworkMigrationEvent | null,
  right: RestoredFrameworkMigrationEvent | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.storageId === right.storageId &&
      left.collision.storageId === right.collision.storageId &&
      left.event.sha256 === right.event.sha256 &&
      left.event.canonicalJson === right.event.canonicalJson;
}

function eventSubjectsExactlyMatch(
  left: RestoredFrameworkMigrationEventSubject,
  right: RestoredFrameworkMigrationEventSubject,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "planAdmitted":
      return right.kind === left.kind &&
        left.admission.storageId === right.admission.storageId &&
        left.admission.admission.sha256 === right.admission.admission.sha256 &&
        left.admission.admission.canonicalJson ===
          right.admission.admission.canonicalJson;
    case "attemptStarted":
    case "leaseRenewed":
      return right.kind === left.kind &&
        restoredAttemptsExactlyMatch(left.attempt, right.attempt);
    case "stepCompleted":
      return right.kind === left.kind &&
        left.receipt.storageId === right.receipt.storageId &&
        left.receipt.receipt.sha256 === right.receipt.receipt.sha256 &&
        left.receipt.receipt.canonicalJson === right.receipt.receipt.canonicalJson;
    case "attemptTerminated":
      return right.kind === left.kind &&
        left.terminal.storageId === right.terminal.storageId &&
        left.terminal.terminal.sha256 === right.terminal.terminal.sha256 &&
        left.terminal.terminal.canonicalJson ===
          right.terminal.terminal.canonicalJson;
    case "installationPublished":
      return right.kind === left.kind &&
        left.installation.storageId === right.installation.storageId &&
        left.installation.installation.sha256 ===
          right.installation.installation.sha256 &&
        left.installation.installation.canonicalJson ===
          right.installation.installation.canonicalJson;
    case "readinessPublished":
      return right.kind === left.kind &&
        left.readiness.storageId === right.readiness.storageId &&
        left.readiness.readiness.sha256 === right.readiness.readiness.sha256 &&
        left.readiness.readiness.canonicalJson ===
          right.readiness.readiness.canonicalJson;
  }
}

function restoredAttemptsExactlyMatch(
  left: RestoredFrameworkMigrationAttemptStart,
  right: RestoredFrameworkMigrationAttemptStart,
): boolean {
  return left.storageId === right.storageId &&
    left.collision.storageId === right.collision.storageId &&
    left.attempt.sha256 === right.attempt.sha256 &&
    left.attempt.canonicalJson === right.attempt.canonicalJson;
}

function sameCollisionCoordinate(
  left: FrameworkMigrationCollisionCoordinate,
  right: FrameworkMigrationCollisionCoordinate,
): boolean {
  return sameTargetNamespace(left.targetNamespace, right.targetNamespace) &&
    left.owner === right.owner && left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function sameTargetNamespace(
  left: FrameworkMigrationCollisionCoordinate["targetNamespace"],
  right: FrameworkMigrationCollisionCoordinate["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

function runRepositoryStatement<Value>(
  operation: FrameworkMigrationRepositoryOperation,
  statement: PromiseLike<Value>,
): Effect.Effect<Value, FrameworkMigrationRepositoryError> {
  return runDrizzleStatementEffect(
    statement,
    cause => FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      cause,
    ),
  );
}

function decodeAuthenticatedSha256(value: string): Effect.Effect<Uint8Array> {
  return Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.orDie);
}

function mapInputValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause)
    : FrameworkMigrationRepositoryError.referenceRefusal(operation);
}

function mapStoredValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause)
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function mapStoredRepositoryError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

const eventCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationEvents.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES}
`;

const eventReadSelection = {
  eventStorageId: fxSystemFrameworkMigrationEvents.eventStorageId,
  collisionStorageId: fxSystemFrameworkMigrationEvents.collisionStorageId,
  eventSequence: fxSystemFrameworkMigrationEvents.eventSequence,
  eventSha256: fxSystemFrameworkMigrationEvents.eventSha256,
  previousEventStorageId:
    fxSystemFrameworkMigrationEvents.previousEventStorageId,
  previousEventSequence: fxSystemFrameworkMigrationEvents.previousEventSequence,
  previousEventSha256: fxSystemFrameworkMigrationEvents.previousEventSha256,
  eventKind: fxSystemFrameworkMigrationEvents.eventKind,
  subjectSha256: fxSystemFrameworkMigrationEvents.subjectSha256,
  leaseAttemptId: fxSystemFrameworkMigrationEvents.leaseAttemptId,
  leaseAttemptFence: fxSystemFrameworkMigrationEvents.leaseAttemptFence,
  leaseOwnerId: fxSystemFrameworkMigrationEvents.leaseOwnerId,
  leaseExpiresAt: fxSystemFrameworkMigrationEvents.leaseExpiresAt,
  frameFormat: fxSystemFrameworkMigrationEvents.frameFormat,
  frameVersion: fxSystemFrameworkMigrationEvents.frameVersion,
  canonicalByteLength: fxSystemFrameworkMigrationEvents.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationEvents.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${eventCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationEvents.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<keyof StoredFrameworkMigrationEventRow, unknown>;
