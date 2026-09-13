/**
 * Shared coordinator journal writes, database time and transaction requests. The target
 * session remains the sole transaction settlement owner.
 */
import { canonicalIsoInstantFromDate, type CanonicalIsoInstant } from "@flarex/time/iso-instant";
import { Brand, Effect } from "effect";
import { sql } from "drizzle-orm";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { captureFrameworkMigrationCollisionHead, captureFrameworkMigrationEvent } from "./canonical";
import type {
  CanonicalNonNegativeInt64,
  FrameworkMigrationAttemptStartSha256,
  FrameworkMigrationAttemptTerminalSha256,
  FrameworkMigrationStepReceiptSha256,
  FrameworkSchemaInstallationReceiptSha256,
  FrameworkSchemaReadinessSha256,
} from "./identity";
import {
  compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect,
} from "./migrationCollisionHeadRepository";
import { appendFrameworkMigrationEventInTransactionEffect } from "./migrationEventRepository";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  type RestoredFrameworkMigrationCollisionHead,
  type RestoredFrameworkMigrationEvent,
  type RestoredFrameworkMigrationEventSubject,
} from "./storedEventRestoration";
import type { RestoredFrameworkMigrationAttemptStart } from "./storedRestoration";
import { FRAMEWORK_MIGRATION_EVENT_FORMAT, FRAMEWORK_MIGRATION_EVENT_VERSION } from "./model";
import type {
  FrameworkMigrationSessionIdentity,
  FrameworkMigrationTransactionBudget,
} from "./targetSession";
import {
  FrameworkMigrationCoordinatorError,
  type FrameworkMigrationCoordinatorFailure,
  coordinatorError,
  corruption,
} from "./coordinatorContracts";

export const brandNonNegativeInt64 = Brand.nominal<CanonicalNonNegativeInt64>();

interface DatabaseClock {
  readonly databaseNow: CanonicalIsoInstant;
  readonly leaseExpiresAt: CanonicalIsoInstant;
}

type FrameworkMigrationEventVariant =
  | Readonly<{
      readonly kind: "attemptStarted";
      readonly attemptStartSha256: FrameworkMigrationAttemptStartSha256;
    }>
  | Readonly<{
      readonly kind: "leaseRenewed";
      readonly attemptId:
        RestoredFrameworkMigrationAttemptStart["attempt"]["frame"]["attemptId"];
      readonly attemptFence:
        RestoredFrameworkMigrationAttemptStart["attempt"]["frame"]["attemptFence"];
      readonly leaseOwnerId:
        RestoredFrameworkMigrationAttemptStart["attempt"]["frame"]["leaseOwnerId"];
      readonly leaseExpiresAt: CanonicalIsoInstant;
    }>
  | Readonly<{
      readonly kind: "stepCompleted";
      readonly stepReceiptSha256: FrameworkMigrationStepReceiptSha256;
    }>
  | Readonly<{
      readonly kind: "attemptTerminated";
      readonly terminalSha256: FrameworkMigrationAttemptTerminalSha256;
    }>
  | Readonly<{
      readonly kind: "installationPublished";
      readonly installationReceiptSha256:
        FrameworkSchemaInstallationReceiptSha256;
    }>
  | Readonly<{
      readonly kind: "readinessPublished";
      readonly readinessSha256: FrameworkSchemaReadinessSha256;
    }>;

export const appendEvent = Effect.fn(
  "FreshFrameworkMigrationCoordinator.appendEvent",
)(function* (
  raw: FlarexMetadataTransaction,
  head: RestoredFrameworkMigrationCollisionHead,
  recordedAt: CanonicalIsoInstant,
  subject: RestoredFrameworkMigrationEventSubject,
  variant: FrameworkMigrationEventVariant,
): Effect.fn.Return<RestoredFrameworkMigrationEvent, FrameworkMigrationCoordinatorFailure> {
  yield* reserveAdditiveEvents(head, 1);
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  if (authority === undefined) {
    return yield* Effect.fail(corruption(
      "step",
      "Collision head event authority is unavailable",
    ));
  }
  const previous = authority.lastEvent;
  const eventValue = yield* captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: head.collision.coordinate,
    sequence: nextInt64(previous?.event.frame.sequence ?? "0"),
    previousEvent: previous === null ? null : eventToken(previous),
    recordedAt,
    ...variant,
  });
  return yield* appendFrameworkMigrationEventInTransactionEffect(
    raw,
    head.collision,
    previous,
    subject,
    eventValue,
  );
});

export const advanceHead = Effect.fn(
  "FreshFrameworkMigrationCoordinator.advanceHead",
)(function* (
  raw: FlarexMetadataTransaction,
  head: RestoredFrameworkMigrationCollisionHead,
  nextAttempt: RestoredFrameworkMigrationAttemptStart | null,
  currentAttempt: RestoredFrameworkMigrationCollisionHead["head"]["frame"]["currentAttempt"],
  lastEvent: RestoredFrameworkMigrationEvent,
  updatedAt: CanonicalIsoInstant,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionHead,
  FrameworkMigrationCoordinatorFailure
> {
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  if (
    authority === undefined ||
    (currentAttempt === null) !== (nextAttempt === null) ||
    (nextAttempt !== null && (
      nextAttempt.collision.storageId !== head.collision.storageId ||
      nextAttempt.admission.storageId !== head.admission.storageId ||
      nextAttempt.attempt.frame.attemptId !== currentAttempt?.attemptId ||
      nextAttempt.attempt.frame.attemptFence !== currentAttempt.attemptFence
    ))
  ) {
    return yield* Effect.fail(corruption(
      "step",
      "Collision head attempt authority is unavailable",
    ));
  }
  const headValue = yield* captureFrameworkMigrationCollisionHead({
    admission: head.admission.admission,
    headRevision: nextInt64(head.head.frame.headRevision),
    attemptFence: currentAttempt?.attemptFence ??
      head.head.frame.attemptFence,
    currentAttempt,
    lastEvent: eventToken(lastEvent),
    updatedAt,
  });
  return yield*
    compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
      raw,
      head,
      head.admission,
      nextAttempt,
      lastEvent,
      headValue,
    );
});

export const readDatabaseClock = Effect.fn(
  "FreshFrameworkMigrationCoordinator.readDatabaseClock",
)(function* (
  raw: FlarexMetadataTransaction,
  leaseDurationMilliseconds: number,
): Effect.fn.Return<DatabaseClock, FrameworkMigrationCoordinatorError> {
  const result = yield* runDrizzleStatementEffect(
    raw.execute(sql`
      with migration_clock as (
        select date_trunc('milliseconds', clock_timestamp()) as database_now
      )
      select database_now,
        database_now + (${leaseDurationMilliseconds}::bigint *
          interval '1 millisecond') as lease_expires_at
      from migration_clock
    `),
    cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock query failed",
      cause,
    ),
  );
  const rows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(result, () => {
      throw new Error("Invalid database clock result");
    }),
    catch: cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock result is invalid",
      cause,
    ),
  });
  const row = rows[0];
  if (rows.length !== 1 || !isRecord(row)) {
    return yield* Effect.fail(coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock returned an invalid row count",
    ));
  }
  const databaseNow = databaseTimestampFromUnknown(row.database_now);
  const leaseExpiresAt = databaseTimestampFromUnknown(row.lease_expires_at);
  if (databaseNow === null || leaseExpiresAt === null) {
    return yield* Effect.fail(coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock returned an invalid timestamp",
    ));
  }
  return Object.freeze({
    databaseNow: yield* Effect.fromResult(
      canonicalIsoInstantFromDate(databaseNow),
    ).pipe(Effect.mapError(cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration clock was not canonical",
      cause,
    ))),
    leaseExpiresAt: yield* Effect.fromResult(
      canonicalIsoInstantFromDate(leaseExpiresAt),
    ).pipe(Effect.mapError(cause => coordinatorError(
      "claim",
      "resourceFailure",
      "Database migration lease expiry was not canonical",
      cause,
    ))),
  });
});

export function eventToken(event: RestoredFrameworkMigrationEvent) {
  return Object.freeze({
    sequence: event.event.frame.sequence,
    eventSha256: event.event.sha256,
  });
}

export function nextInt64(value: string): CanonicalNonNegativeInt64 {
  return brandNonNegativeInt64((BigInt(value) + 1n).toString());
}

export function ordinaryRequest(input: FrameworkMigrationTransactionBudget) {
  return Object.freeze({
    kind: "ordinary" as const,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  });
}

export function recoveryRequest(
  input: FrameworkMigrationTransactionBudget,
  excludedSessionIdentity: FrameworkMigrationSessionIdentity,
) {
  return Object.freeze({
    kind: "recovery" as const,
    excludedSessionIdentity,
    lockTimeoutMilliseconds: input.lockTimeoutMilliseconds,
    statementTimeoutMilliseconds: input.statementTimeoutMilliseconds,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reserveAdditiveEvents(head: RestoredFrameworkMigrationCollisionHead, count: number): Effect.Effect<void, FrameworkMigrationCoordinatorError> {
  return head.plan.plan.frame.version === 2 && BigInt(head.head.frame.lastEvent?.sequence ?? "0") + BigInt(count) > 128n
    ? Effect.fail(coordinatorError("step", "invalidInput", "Additive event budget is exhausted")) : Effect.void;
}
