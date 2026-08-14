import {
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createTaskSystemWakeSchedulerDirectoryV1,
} from "../src/taskSystemWakeSchedulerDirectoryV1";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";
import {
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

describe("DTE05-C2 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-C2.",
    ).not.toBeNull();
  });
});

describePostgres("DTE05-C2 trusted Task scheduler directory - PostgreSQL", () => {
  it("reconstructs fresh authority and a C1 scheduler after settlement", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const parent = await seedRegisteredTaskSystemParentV1(
        persistence,
        "dte05-c2:task-scheduler-directory-parent",
      );
      await seedTaskSystemRunAttemptStoreV1(persistence, { parent });

      const first = makeDirectory(persistence, attemptUuidSequence(701));
      const firstPage = await runEffect(first.discoverEffect({ limit: 10 }));
      const partition = firstPage.partitions.find(({ scopeId }) =>
        scopeId === parent.scopeId
      );
      expect(partition).toMatchObject({
        deploymentId: parent.deploymentId,
        scopeId: parent.scopeId,
      });
      expect(partition).not.toHaveProperty("physicalLocator");
      expect(partition).not.toHaveProperty("authority");
      if (partition === undefined) {
        throw new Error("Task scheduler directory omitted the seeded scope.");
      }

      const accepted = await runEffect(partition.scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));
      expect(accepted).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 1,
      });
      expect(accepted.handled[0]).toMatchObject({
        disposition: "accepted",
        outcomeKind: "attempt_granted",
      });

      const reconstructed = makeDirectory(
        persistence,
        attemptUuidSequence(801),
      );
      const reconstructedPage = await runEffect(
        reconstructed.discoverEffect({ limit: 10 }),
      );
      const reconstructedPartition = reconstructedPage.partitions.find(
        ({ scopeId }) => scopeId === parent.scopeId,
      );
      if (reconstructedPartition === undefined) {
        throw new Error("Reconstructed directory omitted the seeded scope.");
      }
      const recovered = await runEffect(
        reconstructedPartition.scheduler.run({
          dueKind: "start_attempt",
          cursor: null,
        }),
      );
      expect(recovered).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 0,
        continuation: null,
      });
    }, { historicalApplicationAnalysis: true });
  });
});

function makeDirectory(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
) {
  return createTaskSystemWakeSchedulerDirectoryV1(persistence.drizzle, {
    authority: {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared Task scope must not read split receipts.");
        },
      },
      scopeClockTargets: {
        resolve: async (physicalLocator) =>
          createPostgresLocatedTaskSystemRunAttemptTargetV1(
            persistence,
            physicalLocator,
          ),
      },
    },
    partition: {
      scheduler: {
        pageSize: 10,
        maximumPages: 10,
        maximumCandidates: 100,
      },
      retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
      runAttemptStore: { randomUuid },
    },
  });
}

function attemptUuidSequence(start: number): () => string {
  let ordinal = start;
  return () =>
    `85000000-0000-4000-8000-${String(ordinal++).padStart(12, "0")}`;
}
