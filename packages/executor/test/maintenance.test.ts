import { describe, expect, it } from "vitest";

import { createFlarexExecutor, MaintenancePolicyError } from "../src";
import {
  deploymentMetadata,
  invokeSessionMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor invoke session maintenance", () => {
  it("aborts sessions older than the configured stale window", async () => {
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_maintenance",
          projectId: "project_maintenance",
        }),
      ],
      [],
      [
        activeSession({
          sessionId: "session_old",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
        activeSession({
          sessionId: "session_recent",
          createdAt: new Date("2026-06-20T00:59:00.000Z"),
        }),
      ],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T01:00:00.000Z") },
      persistence,
    });

    await expect(
      executor.runInvokeSessionMaintenance({
        deploymentId: "deployment_maintenance",
        projectId: "project_maintenance",
        staleAfterMs: 30 * 60 * 1000,
      }),
    ).resolves.toEqual({
      staleAborted: 1,
      sessions: ["session_old"],
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_maintenance",
        "session_old",
      ),
    ).resolves.toMatchObject({
      state: "aborted",
      finishedAt: new Date("2026-06-20T01:00:00.000Z"),
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_maintenance",
        "session_recent",
      ),
    ).resolves.toMatchObject({ state: "active", finishedAt: null });
  });

  it("rejects invalid stale windows", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(),
    });

    await expect(
      executor.runInvokeSessionMaintenance({
        deploymentId: "deployment_maintenance",
        projectId: "project_maintenance",
        staleAfterMs: 0,
      }),
    ).rejects.toThrow(MaintenancePolicyError);
  });
});

function activeSession(
  overrides: Partial<ReturnType<typeof invokeSessionMetadata>> = {},
) {
  return {
    ...invokeSessionMetadata({
      deploymentId: "deployment_maintenance",
      sessionId: "session_active",
      projectId: "project_maintenance",
      packageId: "package_active",
      functionPath: "messages:list",
      functionKind: "query",
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        table: "teams",
        selector: "byId",
        partitionField: "_id",
        argField: "teamId",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      beginTs: 1781913600123,
      schemaVersion: 5,
      executionModule: "_flarex/execution.js",
    }),
    ...overrides,
  };
}
