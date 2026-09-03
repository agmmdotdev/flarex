import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { Brand, Option } from "effect";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
} from "../src/frameworkSchema/installation/canonical";
import {
  initializeFrameworkSchemaAvailabilityHeadInTransactionEffect,
  readFrameworkSchemaAvailabilityHeadInTransactionEffect,
} from "../src/frameworkSchema/installation/availabilityHeadRepository";
import {
  appendFrameworkSchemaAvailabilityHistoryInTransactionEffect,
} from "../src/frameworkSchema/installation/availabilityHistoryRepository";
import {
  restoredFrameworkSchemaAvailabilityHistoryAuthority,
  type RestoredFrameworkSchemaAvailabilityHead,
} from
  "../src/frameworkSchema/installation/storedMetadataRestoration";
import {
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
} from "../src/migrationCoordination/canonical";
import type { CanonicalNonNegativeInt64 } from
  "../src/migrationCoordination/identity";
import {
  initializeFrameworkMigrationCollisionHeadInTransactionEffect,
  readFrameworkMigrationCollisionHeadInTransactionEffect,
} from "../src/migrationCoordination/migrationCollisionHeadRepository";
import {
  appendFrameworkMigrationEventInTransactionEffect,
} from "../src/migrationCoordination/migrationEventRepository";
import {
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
} from "../src/migrationCoordination/model";
import {
  restoredFrameworkMigrationAttemptTerminalStepReceipts,
} from "../src/migrationCoordination/storedRestoration";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationCollisionHead,
} from "../src/migrationCoordination/storedEventRestoration";
import {
  readFrameworkMigrationCollisionDomainInTransactionEffect,
  readFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import { runEffect } from "./effectTestRuntime";
import {
  COORDINATOR_AVAILABLE_AT,
  createSuccessfulTerminalPlanValues,
  storeSuccessfulReadinessGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";

const PGLITE_TEST_TIMEOUT = 180_000;
const eventSequence = Brand.nominal<CanonicalNonNegativeInt64>();

describe("framework coordinator checkpoint-2 cold reopen", () => {
  it("rehydrates the complete authenticated graph after a file-backed reopen", async () => {
    const testRoot = await mkdtemp(resolve(
      tmpdir(),
      "flarex-framework-coordinator-cold-",
    ));
    const dataDirectory = resolve(testRoot, "database");
    let database: PGlite | undefined = new PGlite(dataDirectory);

    try {
      let persistence = await createPGlitePersistence({ db: database });
      await persistence.migrate();
      const writeValues = await createSuccessfulTerminalPlanValues();
      const beforeClose = await persistence.drizzle.transaction(
        async transaction => {
          const graph = await storeSuccessfulReadinessGraphInTransaction(
            transaction,
            writeValues,
          );
          const eventValue = await runEffect(captureFrameworkMigrationEvent({
            format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
            version: FRAMEWORK_MIGRATION_EVENT_VERSION,
            collision: graph.collision.coordinate,
            sequence: eventSequence("1"),
            previousEvent: null,
            recordedAt: graph.readiness.readiness.frame.validatedAt,
            kind: "readinessPublished",
            readinessSha256: graph.readiness.readiness.sha256,
          }));
          const event = await runEffect(
            appendFrameworkMigrationEventInTransactionEffect(
              transaction,
              graph.collision,
              null,
              Object.freeze({
                kind: "readinessPublished",
                readiness: graph.readiness,
              }),
              eventValue,
            ),
          );
          const collisionHeadValue = await runEffect(
            captureFrameworkMigrationCollisionHead({
              admission: graph.admission.admission,
              headRevision: eventSequence("1"),
              attemptFence: graph.attempt.attempt.frame.attemptFence,
              currentAttempt: Object.freeze({
                attemptId: graph.attempt.attempt.frame.attemptId,
                attemptFence: graph.attempt.attempt.frame.attemptFence,
                leaseOwnerId: graph.attempt.attempt.frame.leaseOwnerId,
                leaseExpiresAt: graph.attempt.attempt.frame.leaseExpiresAt,
              }),
              lastEvent: Object.freeze({
                sequence: event.event.frame.sequence,
                eventSha256: event.event.sha256,
              }),
              updatedAt: event.event.frame.recordedAt,
            }),
          );
          const collisionHead = await runEffect(
            initializeFrameworkMigrationCollisionHeadInTransactionEffect(
              transaction,
              graph.collision,
              graph.admission,
              graph.attempt,
              event,
              collisionHeadValue,
            ),
          );
          const historyValue = await runEffect(
            captureFrameworkSchemaAvailabilityHistory({
              readiness: graph.readiness.readiness,
              previous: null,
              status: "ready",
              reasonSha256: null,
              recordedAt: COORDINATOR_AVAILABLE_AT,
            }),
          );
          const history = await runEffect(
            appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
              transaction,
              graph.readiness,
              null,
              historyValue,
            ),
          );
          const availabilityHeadValue = await runEffect(
            captureFrameworkSchemaAvailabilityHead(history.history),
          );
          const availabilityHead = await runEffect(
            initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
              transaction,
              history,
              availabilityHeadValue,
            ),
          );
          return checkpoint2GraphIdentity(collisionHead, availabilityHead);
        },
      );

      await database.close();
      database = undefined;

      database = new PGlite(dataDirectory);
      persistence = await createPGlitePersistence({ db: database });
      await persistence.migrate();
      const freshValues = await createSuccessfulTerminalPlanValues();
      const afterReopen = await persistence.drizzle.transaction(
        async transaction => {
          const target = Option.getOrThrow(await runEffect(
            readFrameworkSchemaTargetNamespaceInTransactionEffect(
              transaction,
              freshValues.targetValue,
            ),
          ));
          const collision = Option.getOrThrow(await runEffect(
            readFrameworkMigrationCollisionDomainInTransactionEffect(
              transaction,
              target,
              freshValues.planValue.frame.collision,
            ),
          ));
          const collisionHead = Option.getOrThrow(await runEffect(
            readFrameworkMigrationCollisionHeadInTransactionEffect(
              transaction,
              collision,
            ),
          ));
          const headAuthority = requiredCollisionHeadAuthority(collisionHead);
          const eventAuthority = requiredReadinessEventAuthority(
            headAuthority.lastEvent,
          );
          const availabilityHead = Option.getOrThrow(await runEffect(
            readFrameworkSchemaAvailabilityHeadInTransactionEffect(
              transaction,
              eventAuthority.subject.readiness.installation,
            ),
          ));
          return checkpoint2GraphIdentity(collisionHead, availabilityHead);
        },
      );

      expect(afterReopen).toEqual(beforeClose);
    } finally {
      try {
        await database?.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, PGLITE_TEST_TIMEOUT);
});

function checkpoint2GraphIdentity(
  collisionHead: RestoredFrameworkMigrationCollisionHead,
  availabilityHead: RestoredFrameworkSchemaAvailabilityHead,
) {
  const headAuthority = requiredCollisionHeadAuthority(collisionHead);
  const event = headAuthority.lastEvent;
  const eventAuthority = requiredReadinessEventAuthority(event);
  const { readiness } = eventAuthority.subject;
  const { installation } = readiness;
  const { terminal } = installation;
  const receipts = restoredFrameworkMigrationAttemptTerminalStepReceipts(
    terminal,
  );
  if (receipts === undefined) {
    throw new Error("Cold-restored terminal is missing receipt authority");
  }
  const historyAuthority =
    restoredFrameworkSchemaAvailabilityHistoryAuthority(
      availabilityHead.history,
    );
  if (historyAuthority === undefined) {
    throw new Error("Cold-restored availability history lacks authority");
  }

  expect(headAuthority.currentAttempt?.storageId).toBe(
    terminal.attempt.storageId,
  );
  expect(eventAuthority.previous).toBeNull();
  expect(historyAuthority.previous).toBeNull();
  expect(availabilityHead.installation.storageId).toBe(installation.storageId);
  expect(availabilityHead.installation.installation.sha256).toBe(
    installation.installation.sha256,
  );
  expect(availabilityHead.readiness.storageId).toBe(readiness.storageId);
  expect(availabilityHead.readiness.readiness.sha256).toBe(
    readiness.readiness.sha256,
  );
  expect(availabilityHead.installation).toBe(
    availabilityHead.readiness.installation,
  );
  expect(availabilityHead.installation).toBe(
    availabilityHead.history.installation,
  );
  expect(availabilityHead.readiness).toBe(availabilityHead.history.readiness);

  return Object.freeze({
    targetNamespace: Object.freeze({
      storageId: collisionHead.collision.targetNamespace.storageId.toString(),
      sha256: collisionHead.collision.targetNamespace.targetNamespace
        .targetNamespaceSha256,
    }),
    collision: Object.freeze({
      storageId: collisionHead.collision.storageId.toString(),
      coordinate: collisionHead.collision.coordinate,
    }),
    plan: Object.freeze({
      storageId: collisionHead.plan.storageId.toString(),
      sha256: collisionHead.plan.plan.migrationPlanSha256,
    }),
    admission: Object.freeze({
      storageId: collisionHead.admission.storageId.toString(),
      sha256: collisionHead.admission.admission.sha256,
    }),
    attempt: Object.freeze({
      storageId: terminal.attempt.storageId.toString(),
      sha256: terminal.attempt.attempt.sha256,
    }),
    receipts: Object.freeze(receipts.map(receipt => Object.freeze({
      storageId: receipt.storageId.toString(),
      sha256: receipt.receipt.sha256,
    }))),
    terminal: Object.freeze({
      storageId: terminal.storageId.toString(),
      sha256: terminal.terminal.sha256,
    }),
    installation: Object.freeze({
      storageId: installation.storageId.toString(),
      sha256: installation.installation.sha256,
    }),
    readiness: Object.freeze({
      storageId: readiness.storageId.toString(),
      sha256: readiness.readiness.sha256,
    }),
    event: Object.freeze({
      storageId: event.storageId.toString(),
      sha256: event.event.sha256,
    }),
    collisionHead: collisionHead.head.sha256,
    availabilityHistory: Object.freeze({
      storageId: availabilityHead.history.storageId.toString(),
      sha256: availabilityHead.history.history.sha256,
    }),
    availabilityHead: availabilityHead.head.sha256,
  });
}

function requiredCollisionHeadAuthority(
  head: RestoredFrameworkMigrationCollisionHead,
) {
  const authority = restoredFrameworkMigrationCollisionHeadAuthority(head);
  if (authority?.currentAttempt === null || authority?.currentAttempt === undefined) {
    throw new Error("Cold-restored collision head lacks current-attempt authority");
  }
  if (authority.lastEvent === null) {
    throw new Error("Cold-restored collision head lacks last-event authority");
  }
  return Object.freeze({
    currentAttempt: authority.currentAttempt,
    lastEvent: authority.lastEvent,
  });
}

function requiredReadinessEventAuthority(
  event: ReturnType<typeof requiredCollisionHeadAuthority>["lastEvent"],
) {
  const authority = restoredFrameworkMigrationEventAuthority(event);
  if (authority?.subject.kind !== "readinessPublished") {
    throw new Error("Cold-restored event lacks readiness subject authority");
  }
  return Object.freeze({
    previous: authority.previous,
    subject: authority.subject,
  });
}
