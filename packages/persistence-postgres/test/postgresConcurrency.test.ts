import { describe, expect, it } from "vitest";

import {
  type CommitInvokeSessionWritesResult,
  type FlarexPersistence,
  InvokeSessionOccConflictError,
} from "../src";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres OCC concurrency", () => {
  it("serializes concurrent commits and rejects a stale document read", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDocumentRevision({
        deploymentId: "deployment_pg_occ_conflict",
        id: "1:team",
        ts: 10,
        value: { name: "team", count: 0 },
      });
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_a",
        beginTs: 10,
      });
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_b",
        beginTs: 10,
      });
      for (const sessionId of ["session_a", "session_b"]) {
        await persistence.insertInvokeSessionDocumentRead({
          deploymentId: "deployment_pg_occ_conflict",
          sessionId,
          tableId: 1,
          documentId: "1:team",
          observedTs: 10,
        });
      }
      await persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_a",
        tableId: 1,
        documentId: "1:team",
        op: "patch",
        valueJson: { count: 1 },
      });
      await persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_b",
        tableId: 1,
        documentId: "1:team",
        op: "patch",
        valueJson: { count: 2 },
      });

      const outcomes = await Promise.allSettled([
        commitSession(persistence, "deployment_pg_occ_conflict", "session_a"),
        commitSession(persistence, "deployment_pg_occ_conflict", "session_b"),
      ]);

      const fulfilled = fulfilledOutcomes(outcomes);
      const rejected = rejectedOutcomes(outcomes);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toBeInstanceOf(InvokeSessionOccConflictError);
      expect(fulfilled[0]?.committedTs).toBe(11);

      const current = await persistence.getDocumentRevisionAtTs(
        "deployment_pg_occ_conflict",
        "1:team",
        100,
      );
      expect(current).toMatchObject({
        ts: 11,
        value: expect.objectContaining({ count: expect.any(Number) }),
      });
      const currentValue = current?.value;
      if (!isRecord(currentValue)) {
        throw new Error("Expected current document value.");
      }
      expect([1, 2]).toContain(currentValue.count);
    });
  });

  it("assigns unique commit timestamps for concurrent non-conflicting commits", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      for (const id of ["1:team_a", "1:team_b"]) {
        await persistence.insertDocumentRevision({
          deploymentId: "deployment_pg_occ_parallel",
          id,
          ts: 10,
          value: { name: id, count: 0 },
        });
      }
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_a",
        beginTs: 10,
      });
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_b",
        beginTs: 10,
      });
      await stagePatchFromObservedRead(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_a",
        documentId: "1:team_a",
        count: 1,
      });
      await stagePatchFromObservedRead(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_b",
        documentId: "1:team_b",
        count: 2,
      });

      const results = await Promise.all([
        commitSession(persistence, "deployment_pg_occ_parallel", "session_a"),
        commitSession(persistence, "deployment_pg_occ_parallel", "session_b"),
      ]);

      expect(results.map((result) => result.committedTs).sort()).toEqual([
        11,
        12,
      ]);
      await expect(
        persistence.getDocumentRevisionAtTs(
          "deployment_pg_occ_parallel",
          "1:team_a",
          100,
        ),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ count: 1 }),
      });
      await expect(
        persistence.getDocumentRevisionAtTs(
          "deployment_pg_occ_parallel",
          "1:team_b",
          100,
        ),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ count: 2 }),
      });
    });
  });
});

async function insertMutationSession(
  persistence: FlarexPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    beginTs: number;
  },
): Promise<void> {
  await persistence.insertInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: "project_pg_occ",
    packageId: "package_pg_occ",
    functionPath: "teams:update",
    functionKind: "mutation",
    partitionKey: "team:1",
    scopeJson: { kind: "partition", partitionKey: "team:1" },
    argsJson: { teamId: "team:1" },
    beginTs: input.beginTs,
    schemaVersion: 1,
    executionModule: "_flarex/execution.js",
  });
}

async function stagePatchFromObservedRead(
  persistence: FlarexPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    documentId: string;
    count: number;
  },
): Promise<void> {
  await persistence.insertInvokeSessionDocumentRead({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    tableId: 1,
    documentId: input.documentId,
    observedTs: 10,
  });
  await persistence.stageInvokeSessionDocumentWrite({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    tableId: 1,
    documentId: input.documentId,
    op: "patch",
    valueJson: { count: input.count },
  });
}

async function commitSession(
  persistence: FlarexPersistence,
  deploymentId: string,
  sessionId: string,
): Promise<CommitInvokeSessionWritesResult> {
  return await persistence.commitInvokeSessionWrites({
    deploymentId,
    sessionId,
    source: "invoke:teams:update",
    finishedAt: new Date("2026-06-20T00:00:00.000Z"),
    minimumTs: 10,
  });
}

function fulfilledOutcomes<T>(
  outcomes: Array<PromiseSettledResult<T>>,
): T[] {
  return outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
}

function rejectedOutcomes(
  outcomes: Array<PromiseSettledResult<unknown>>,
): unknown[] {
  return outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
