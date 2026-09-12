import { and, count, eq, inArray, sql } from "drizzle-orm";
import { expect } from "vitest";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  MAX_RETAINED_FLOOR_LEASE_ROWS,
  observeRetainedHistoryFloorCandidateEffect,
  publishRetainedHistoryFloorEffect,
  type RetainedHistoryFloorObservationPort,
  type RetainedHistoryFloorPublicationPort,
} from "../src/retainedHistoryFloorObservation";
import {
  fxSystemCommits,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../src/schema";
import { runEffect } from "./effectTestRuntime";

export async function seedRetainedFloorLeaseCommit(database: FlarexMetadataDatabase, scopeId: ScopeId): Promise<void> {
  const [clock] = await database.select().from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  if (clock?.scopeUuid == null || clock.epochUuid == null) throw new Error("Expected a replacement scope clock.");
  await database.insert(fxSystemCommits).values({
    scopeUuid: clock.scopeUuid, epochUuid: clock.epochUuid,
    commitSeq: CommitSeqSchema.make(1n), changeCount: 0,
    committedAt: sql`clock_timestamp() - interval '30 seconds'`,
  });
  await database.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
}

/** Copies stored attempt rows for a synthetic lease-directory fixture. */
export async function retainedHistoryFloorLeaseScenario(input: Readonly<{
  database: FlarexMetadataDatabase;
  sessionId: TransactionSessionIdV1;
  deploymentId: TransactionGrantDeploymentIdV1;
  observation: RetainedHistoryFloorObservationPort;
  publication: RetainedHistoryFloorPublicationPort;
}>): Promise<void> {
  const db = input.database;
  const [session] = await db.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, input.sessionId));
  const [lease] = await db.select().from(fxSystemSnapshotLeases)
    .where(eq(fxSystemSnapshotLeases.sessionId, input.sessionId));
  const [root] = await db.select().from(fxSystemTransactionJournals)
    .where(eq(fxSystemTransactionJournals.sessionId, input.sessionId));
  const [claim] = await db.select().from(fxSystemTransactionExecutionClaims)
    .where(eq(fxSystemTransactionExecutionClaims.sessionId, input.sessionId));
  if (!session || !lease || !root || !claim) throw new Error("Expected a complete activated attempt.");
  expect(lease.snapshotCommitSeq).toBe(1n);
  const expired = new Date("2000-01-01T00:00:00.000Z");
  const live = lease.leaseExpiresAt;
  const ids = Array.from({ length: MAX_RETAINED_FLOOR_LEASE_ROWS + 1 }, (_, index) =>
    TransactionSessionIdV1Schema.make(`00100000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`));
  for (let offset = 0; offset < ids.length; offset += 256) {
    const batch = ids.slice(offset, offset + 256);
    await db.transaction(async tx => {
      await tx.insert(fxSystemTransactionSessions).values(batch.map(sessionId => ({
        ...session,
        sessionId,
        requestKey: TransactionRequestKeyV1Schema.make(`floor-backlog-${sessionId}`),
      })));
      await tx.insert(fxSystemSnapshotLeases).values(batch.map(sessionId => ({
        ...lease, sessionId, leaseExpiresAt: expired,
      })));
      await tx.insert(fxSystemTransactionJournals).values(batch.map(sessionId => ({ ...root, sessionId })));
      await tx.insert(fxSystemTransactionExecutionClaims).values(batch.map(sessionId => ({ ...claim, sessionId })));
    });
  }
  const scope = eq(fxSystemSnapshotLeases.scopeUuid, session.scopeUuid);
  const original = and(scope, eq(fxSystemSnapshotLeases.sessionId, input.sessionId));
  await db.update(fxSystemSnapshotLeases).set({ leaseExpiresAt: live }).where(original);
  // Seed the time-window evidence after the bulk setup, using database time.
  await db.insert(fxSystemCommits).values([
    { scopeUuid: session.scopeUuid, epochUuid: lease.snapshotEpochUuid,
      commitSeq: CommitSeqSchema.make(2n), changeCount: 0,
      committedAt: sql`clock_timestamp() - interval '20 seconds'` },
    { scopeUuid: session.scopeUuid, epochUuid: lease.snapshotEpochUuid,
      commitSeq: CommitSeqSchema.make(3n), changeCount: 0,
      committedAt: sql`clock_timestamp() - interval '1 second'` },
  ]);
  await db.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(3n) })
    .where(eq(fxSystemScopeClocks.scopeUuid, session.scopeUuid));
  const observe = () => runEffect(observeRetainedHistoryFloorCandidateEffect(input.observation, input.deploymentId));
  await expect(observe()).resolves.toMatchObject({
    disposition: "advanceable", candidateFloor: 1n, leaseCeiling: 1n, holdReasons: [],
  });
  await db.update(fxSystemSnapshotLeases).set({
    snapshotEpochUuid: ScopeEpochUuidV1Schema.make("00100000-0000-4000-8000-999999999999"),
    snapshotCommitSeq: CommitSeqSchema.make(999n),
  }).where(original);
  await expect(observe()).resolves.toMatchObject({
    disposition: "held", candidateFloor: 0n, holdReasons: ["liveLeaseAuthorityUnavailable"],
  });
  await db.update(fxSystemSnapshotLeases).set({ leaseExpiresAt: expired }).where(original);
  await expect(observe()).resolves.toMatchObject({
    disposition: "advanceable", candidateFloor: 2n, leaseCeiling: 3n, holdReasons: [],
  });
  await db.update(fxSystemSnapshotLeases).set({ leaseExpiresAt: live })
    .where(and(scope, inArray(fxSystemSnapshotLeases.sessionId, ids)));
  await expect(observe()).resolves.toMatchObject({
    disposition: "held", candidateFloor: 0n, holdReasons: ["leaseDirectoryLimit"],
  });
  const firstId = ids[0];
  if (firstId === undefined) throw new Error("Expected backlog identities.");
  await db.update(fxSystemSnapshotLeases).set({ leaseExpiresAt: expired })
    .where(and(scope, eq(fxSystemSnapshotLeases.sessionId, firstId)));
  await expect(observe()).resolves.toMatchObject({
    disposition: "advanceable", candidateFloor: 1n, leaseCeiling: 1n, holdReasons: [],
  });
  await db.update(fxSystemSnapshotLeases).set({ leaseExpiresAt: expired }).where(scope);
  const [before] = await db.select({ floor: fxSystemScopeClocks.oldestAvailableCommitSeq })
    .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, session.scopeUuid));
  expect(before?.floor).toBe(0n);
  await expect(runEffect(publishRetainedHistoryFloorEffect(input.publication, input.deploymentId)))
    .resolves.toMatchObject({ disposition: "advanced", previousFloor: 0n, currentFloor: 2n });
  // Observation/publication ignores expired pins; it does not delete attempts.
  expect(await db.select({ count: count() }).from(fxSystemSnapshotLeases).where(scope))
    .toEqual([{ count: MAX_RETAINED_FLOOR_LEASE_ROWS + 2 }]);
  expect(await db.select({ count: count() }).from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.scopeUuid, session.scopeUuid)))
    .toEqual([{ count: MAX_RETAINED_FLOOR_LEASE_ROWS + 2 }]);
}
