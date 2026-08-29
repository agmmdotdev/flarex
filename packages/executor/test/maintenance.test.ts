import { describe, expect, it } from "vitest";

import { createFlarexExecutor, MaintenancePolicyError } from "../src";
import {
  deploymentMetadata,
  invokeSessionMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor invoke session maintenance", () => {
  it("lists maintenance deployments in stable cursor batches", async () => {
    const persistence = memoryPersistence([
      {
        ...deploymentMetadata({
          deploymentId: "deployment_b",
          projectId: "project_b",
        }),
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
      },
      {
        ...deploymentMetadata({
          deploymentId: "deployment_a",
          projectId: "project_a",
        }),
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
      },
      {
        ...deploymentMetadata({
          deploymentId: "deployment_c",
          projectId: "project_c",
        }),
        createdAt: new Date("2026-06-20T01:00:00.000Z"),
      },
    ]);
    const executor = createFlarexExecutor({ persistence });

    const first = await executor.listMaintenanceDeployments({ limit: 2 });
    expect(first.deployments.map((deployment) => deployment.deploymentId)).toEqual([
      "deployment_a",
      "deployment_b",
    ]);
    expect(first.nextCursor).toEqual({
      deploymentId: "deployment_b",
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    await expect(
      executor.listMaintenanceDeployments({
        limit: 2,
        cursor: first.nextCursor!,
      }),
    ).resolves.toMatchObject({
      deployments: [{ deploymentId: "deployment_c" }],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("rejects invalid maintenance deployment list limits", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(),
    });

    await expect(
      executor.listMaintenanceDeployments({ limit: 0 }),
    ).rejects.toThrow(MaintenancePolicyError);
  });

  it("runs one maintenance batch for each listed deployment", async () => {
    const persistence = memoryPersistence(
      [
        {
          ...deploymentMetadata({
            deploymentId: "deployment_a",
            projectId: "project_a",
          }),
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        {
          ...deploymentMetadata({
            deploymentId: "deployment_b",
            projectId: "project_b",
          }),
          createdAt: new Date("2026-06-20T01:00:00.000Z"),
        },
        {
          ...deploymentMetadata({
            deploymentId: "deployment_c",
            projectId: "project_c",
          }),
          createdAt: new Date("2026-06-20T02:00:00.000Z"),
        },
      ],
      [],
      [
        deploymentSession({
          deploymentId: "deployment_a",
          projectId: "project_a",
          sessionId: "session_a_old",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
        deploymentSession({
          deploymentId: "deployment_a",
          projectId: "project_a",
          sessionId: "session_a_recent",
          createdAt: new Date("2026-06-20T00:59:00.000Z"),
        }),
        deploymentSession({
          deploymentId: "deployment_b",
          projectId: "project_b",
          sessionId: "session_b_old_1",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
        deploymentSession({
          deploymentId: "deployment_b",
          projectId: "project_b",
          sessionId: "session_b_old_2",
          createdAt: new Date("2026-06-20T00:05:00.000Z"),
        }),
      ],
    );
    let clockReads = 0;
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return new Date("2026-06-20T01:00:00.000Z");
        },
      },
      persistence,
    });

    await expect(
      executor.runMaintenanceSweep({
        deploymentLimit: 2,
        staleAfterMs: 30 * 60 * 1000,
        maxSessionsPerDeployment: 1,
      }),
    ).resolves.toEqual({
      deployments: [
        {
          deploymentId: "deployment_a",
          projectId: "project_a",
          staleAborted: 1,
          sessions: ["session_a_old"],
          hasMoreSessions: false,
        },
        {
          deploymentId: "deployment_b",
          projectId: "project_b",
          staleAborted: 1,
          sessions: ["session_b_old_1"],
          hasMoreSessions: true,
        },
      ],
      nextDeploymentCursor: {
        deploymentId: "deployment_b",
        createdAt: new Date("2026-06-20T01:00:00.000Z"),
      },
      hasMoreDeployments: true,
    });
    await expect(
      persistence.getInvokeSessionMetadata("deployment_b", "session_b_old_2"),
    ).resolves.toMatchObject({ state: "active" });
    expect(clockReads).toBe(4);
  });

  it("runs maintenance sweep after a deployment cursor", async () => {
    const persistence = memoryPersistence(
      [
        {
          ...deploymentMetadata({
            deploymentId: "deployment_a",
            projectId: "project_a",
          }),
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        {
          ...deploymentMetadata({
            deploymentId: "deployment_b",
            projectId: "project_b",
          }),
          createdAt: new Date("2026-06-20T01:00:00.000Z"),
        },
      ],
      [],
      [
        deploymentSession({
          deploymentId: "deployment_b",
          projectId: "project_b",
          sessionId: "session_b_old",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
      ],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T01:00:00.000Z") },
      persistence,
    });

    await expect(
      executor.runMaintenanceSweep({
        deploymentLimit: 2,
        deploymentCursor: {
          deploymentId: "deployment_a",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        staleAfterMs: 30 * 60 * 1000,
      }),
    ).resolves.toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_b",
          projectId: "project_b",
          staleAborted: 1,
          sessions: ["session_b_old"],
          hasMoreSessions: false,
        },
      ],
      nextDeploymentCursor: null,
      hasMoreDeployments: false,
    });
  });

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
      hasMore: false,
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

  it("limits maintenance to the oldest stale session batch", async () => {
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
          sessionId: "session_b",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
        activeSession({
          sessionId: "session_a",
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        }),
        activeSession({
          sessionId: "session_c",
          createdAt: new Date("2026-06-20T00:10:00.000Z"),
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
        maxSessions: 2,
      }),
    ).resolves.toEqual({
      staleAborted: 2,
      sessions: ["session_a", "session_b"],
      hasMore: true,
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_maintenance",
        "session_c",
      ),
    ).resolves.toMatchObject({ state: "active" });
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

  it("rejects invalid maintenance batch sizes", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(),
    });

    await expect(
      executor.runInvokeSessionMaintenance({
        deploymentId: "deployment_maintenance",
        projectId: "project_maintenance",
        staleAfterMs: 30 * 60 * 1000,
        maxSessions: 0,
      }),
    ).rejects.toThrow(MaintenancePolicyError);
  });

  it("preserves configured clock and Date observation failures by identity", async () => {
    const clockFailure = new Error("maintenance clock failed");
    const clockFailureExecutor = createFlarexExecutor({
      persistence: memoryPersistence(),
      clock: { now: () => { throw clockFailure; } },
    });

    await expect(clockFailureExecutor.runInvokeSessionMaintenance({
      deploymentId: "deployment_maintenance",
      projectId: "project_maintenance",
      staleAfterMs: 1,
    })).rejects.toBe(clockFailure);

    const observationFailure = new Error("maintenance Date failed");
    let getTimeReads = 0;
    class ThrowingMaintenanceDate extends Date {
      override getTime(): number {
        getTimeReads += 1;
        throw observationFailure;
      }
    }
    const observationFailureExecutor = createFlarexExecutor({
      persistence: memoryPersistence(),
      clock: { now: () => new ThrowingMaintenanceDate(100) },
    });

    await expect(observationFailureExecutor.runInvokeSessionMaintenance({
      deploymentId: "deployment_maintenance",
      projectId: "project_maintenance",
      staleAfterMs: 1,
    })).rejects.toBe(observationFailure);
    expect(getTimeReads).toBe(1);
  });

  it("lists deployments before reading the sweep clock and preserves failures", async () => {
    const listFailure = new Error("deployment listing failed");
    const basePersistence = memoryPersistence();
    const persistence = {
      ...basePersistence,
      async listDeploymentMetadata(): Promise<never> {
        throw listFailure;
      },
    };
    let clockReads = 0;
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(executor.runMaintenanceSweep({
      deploymentLimit: 1,
      staleAfterMs: 1,
    })).rejects.toBe(listFailure);
    expect(clockReads).toBe(0);
  });

  it("stops a sweep at the first stale-abort failure", async () => {
    const abortFailure = new Error("stale abort failed");
    const basePersistence = memoryPersistence([
      deploymentMetadata({
        deploymentId: "deployment_a",
        projectId: "project_a",
      }),
      deploymentMetadata({
        deploymentId: "deployment_b",
        projectId: "project_b",
      }),
    ]);
    const abortDeployments: string[] = [];
    const persistence = {
      ...basePersistence,
      async abortStaleInvokeSessionsMetadata(
        input: Parameters<
          typeof basePersistence.abortStaleInvokeSessionsMetadata
        >[0],
      ): Promise<never> {
        abortDeployments.push(input.deploymentId);
        throw abortFailure;
      },
    };
    let clockReads = 0;
    const executor = createFlarexExecutor({
      persistence,
      clock: {
        now: () => {
          clockReads += 1;
          return new Date(100);
        },
      },
    });

    await expect(executor.runMaintenanceSweep({
      deploymentLimit: 2,
      staleAfterMs: 1,
    })).rejects.toBe(abortFailure);
    expect(clockReads).toBe(2);
    expect(abortDeployments).toEqual(["deployment_a"]);
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

function deploymentSession(input: {
  deploymentId: string;
  projectId: string;
  sessionId: string;
  createdAt: Date;
}) {
  return {
    ...invokeSessionMetadata({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      projectId: input.projectId,
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
    createdAt: input.createdAt,
  };
}
