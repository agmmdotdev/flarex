import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";
import type {
  CommitInvokeSessionWritesResult,
  PersistenceJson,
} from "@flarex/persistence-postgres";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/postgres";

import {
  createFlarexExecutor,
  InvokeRetryExhaustedError,
} from "../src";
import {
  postgresUrl,
  withTemporaryPostgresExecutorPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres invoke retry coordination", () => {
  it("reruns a mutation after a commit-time OCC conflict", async () => {
    await withTemporaryPostgresExecutorPersistence(async (
      persistence,
      executorPersistence,
    ) => {
      await seedTeam(persistence, "deployment_pg_retry", "1:team", {
        name: "old",
        count: 0,
      });

      let nowMs = 15;
      let nextSession = 0;
      const executor = createFlarexExecutor({
        clock: { now: () => new Date(nowMs) },
        ids: { nextId: () => `session_retry_${++nextSession}` },
        persistence: executorPersistence,
      });
      const registered = await registerActivePackage(executor, {
        deploymentId: "deployment_pg_retry",
        projectId: "project_pg_retry",
      });

      const observedAttempts: Array<{ attempt: number; value: unknown }> = [];
      const result = await executor.runInvokeWithRetries({
        deploymentId: "deployment_pg_retry",
        projectId: "project_pg_retry",
        path: "messages:send",
        kind: "mutation",
        args: { teamId: "1:team", text: "hello" },
        partitionKey: "1:team",
        maxAttempts: 2,
        runAttempt: async (attempt) => {
          const team = await attempt.syscall({ op: "get", id: "1:team" });
          observedAttempts.push({ attempt: attempt.attempt, value: team.value });

          if (attempt.attempt === 1) {
            const concurrent = await commitConcurrentTeamPatch({
              persistence,
              deploymentId: "deployment_pg_retry",
              projectId: "project_pg_retry",
              packageId: registered.package.packageId,
              sessionId: "session_concurrent",
              minimumTs: nowMs,
              value: { name: "new", count: 1 },
            });
            nowMs = concurrent.committedTs + 4;
          }

          await attempt.syscall({
            op: "patch",
            id: "1:team",
            value: { count: 2 },
          });
          return { ok: true, attempt: attempt.attempt };
        },
      });

      expect(result).toMatchObject({
        value: { ok: true, attempt: 2 },
        attempts: 2,
        committedTs: 21,
        writes: [
          {
            tableId: 1,
            id: "1:team",
            prevTs: 16,
            ts: 21,
            value: { name: "new", count: 2 },
          },
        ],
      });
      expect(observedAttempts).toEqual([
        {
          attempt: 1,
          value: { _id: "1:team", name: "old", count: 0 },
        },
        {
          attempt: 2,
          value: { _id: "1:team", name: "new", count: 1 },
        },
      ]);
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_pg_retry",
          "session_retry_1",
        ),
      ).resolves.toMatchObject({ state: "aborted" });
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_pg_retry",
          "session_retry_2",
        ),
      ).resolves.toMatchObject({ state: "finished" });
    });
  });

  it("exhausts retries when every attempt conflicts", async () => {
    await withTemporaryPostgresExecutorPersistence(async (
      persistence,
      executorPersistence,
    ) => {
      await seedTeam(persistence, "deployment_pg_retry_exhausted", "1:team", {
        name: "old",
        count: 0,
      });

      let nowMs = 15;
      let nextSession = 0;
      const executor = createFlarexExecutor({
        clock: { now: () => new Date(nowMs) },
        ids: { nextId: () => `session_retry_${++nextSession}` },
        persistence: executorPersistence,
      });
      const registered = await registerActivePackage(executor, {
        deploymentId: "deployment_pg_retry_exhausted",
        projectId: "project_pg_retry",
      });

      const attempts: number[] = [];
      await expect(
        executor.runInvokeWithRetries({
          deploymentId: "deployment_pg_retry_exhausted",
          projectId: "project_pg_retry",
          path: "messages:send",
          kind: "mutation",
          args: { teamId: "1:team", text: "hello" },
          partitionKey: "1:team",
          maxAttempts: 2,
          runAttempt: async (attempt) => {
            attempts.push(attempt.attempt);
            await attempt.syscall({ op: "get", id: "1:team" });
            const concurrent = await commitConcurrentTeamPatch({
              persistence,
              deploymentId: "deployment_pg_retry_exhausted",
              projectId: "project_pg_retry",
              packageId: registered.package.packageId,
              sessionId: `session_concurrent_${attempt.attempt}`,
              minimumTs: nowMs,
              value: { name: "concurrent", count: attempt.attempt },
            });
            nowMs = concurrent.committedTs + 4;
            await attempt.syscall({
              op: "patch",
              id: "1:team",
              value: { count: 100 + attempt.attempt },
            });
            return { ok: true };
          },
        }),
      ).rejects.toThrow(InvokeRetryExhaustedError);

      expect(attempts).toEqual([1, 2]);
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_pg_retry_exhausted",
          "session_retry_1",
        ),
      ).resolves.toMatchObject({ state: "aborted" });
      await expect(
        persistence.getInvokeSessionMetadata(
          "deployment_pg_retry_exhausted",
          "session_retry_2",
        ),
      ).resolves.toMatchObject({ state: "aborted" });
    });
  });
});

async function seedTeam(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
  id: string,
  value: PersistenceJson,
): Promise<void> {
  await persistence.insertDocumentRevision({
    deploymentId,
    id,
    ts: 10,
    value,
  });
}

async function registerActivePackage(
  executor: ReturnType<typeof createFlarexExecutor>,
  input: {
    deploymentId: string;
    projectId: string;
  },
): Promise<Awaited<ReturnType<typeof executor.registerDeploymentPackage>>> {
  const registered = await executor.registerDeploymentPackage({
    deploymentId: input.deploymentId,
    projectId: input.projectId,
    sourcePackage: sourcePackage(),
    analysisJson: analysisJson(),
  });
  await executor.activateDeploymentPackage({
    deploymentId: input.deploymentId,
    projectId: input.projectId,
    packageId: registered.package.packageId,
    schemaVersion: 5,
  });
  return registered;
}

async function commitConcurrentTeamPatch(input: {
  persistence: PostgresFlarexPersistence;
  deploymentId: string;
  projectId: string;
  packageId: string;
  sessionId: string;
  minimumTs: number;
  value: PersistenceJson;
}): Promise<CommitInvokeSessionWritesResult> {
  const current = await input.persistence.getDocumentRevisionAtTs(
    input.deploymentId,
    "1:team",
    input.minimumTs,
  );
  await input.persistence.insertInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    packageId: input.packageId,
    functionPath: "messages:send",
    functionKind: "mutation",
    partitionKey: "1:team",
    scopeJson: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "1:team",
    },
    argsJson: { teamId: "1:team", text: "concurrent" },
    beginTs: input.minimumTs,
    schemaVersion: 5,
    executionModule: "_flarex/execution.js",
  });
  await input.persistence.insertInvokeSessionDocumentRead({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    tableId: 1,
    documentId: "1:team",
    observedTs: current?.ts ?? null,
  });
  await input.persistence.stageInvokeSessionDocumentWrite({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    tableId: 1,
    documentId: "1:team",
    op: "patch",
    valueJson: input.value,
  });
  return await input.persistence.commitInvokeSessionWrites({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    source: "invoke:messages:send",
    finishedAt: new Date(input.minimumTs),
    minimumTs: input.minimumTs,
  });
}

function sourcePackage(): ArtifactSourcePackage {
  return {
    modules: [
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: ["messages.js"],
    execution: "_flarex/execution.js",
  };
}

function analysisJson(): Record<string, unknown> {
  return {
    schema: {
      version: 5,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [
        {
          indexId: 1,
          tableId: 1,
          name: "by_name",
          fields: ["name"],
        },
      ],
    },
    functions: {
      functions: [
        {
          path: "messages:send",
          kind: "mutation",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
      ],
    },
  };
}
