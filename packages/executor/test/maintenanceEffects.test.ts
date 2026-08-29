import { createLegacyV1AppDataEngine } from
  "@flarex/persistence-postgres/legacy-v1-app-data-engine";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { createLegacyOnlyAppDataEngineRegistry } from "../src/appDataEngines";
import {
  runInvokeSessionMaintenanceEffect,
  runMaintenanceSweepEffect,
} from "../src/maintenance";
import {
  makeInvokeSessionOperations,
  makeSessionTimeEffect,
  type InvokeSessionOperations,
} from "../src/sessions";
import { runEffect } from "./effectTestRuntime";
import {
  deploymentMetadata,
  invokeSessionMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor Effect-native session maintenance", () => {
  it("keeps cutoff and abort-finish observations separate under TestClock", async () => {
    const persistence = memoryPersistence(
      [deploymentMetadata({
        deploymentId: "deployment_maintenance_effect",
        projectId: "project_maintenance_effect",
      })],
      [],
      [activeSession({
        deploymentId: "deployment_maintenance_effect",
        projectId: "project_maintenance_effect",
        sessionId: "session_maintenance_effect",
        createdAt: new Date(0),
      })],
    );
    const baseOperations = sessionOperations(persistence);
    const cutoffs: Date[] = [];
    const operations: InvokeSessionOperations = {
      ...baseOperations,
      abortStale: (input) => Effect.gen(function* () {
        cutoffs.push(input.olderThan);
        yield* TestClock.setTime(120);
        return yield* baseOperations.abortStale(input);
      }),
    };

    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(100);
      return yield* runInvokeSessionMaintenanceEffect(
        makeSessionTimeEffect(undefined),
        operations,
        {
          deploymentId: "deployment_maintenance_effect",
          projectId: "project_maintenance_effect",
          staleAfterMs: 50,
        },
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(cutoffs).toEqual([new Date(50)]);
    expect(result).toEqual({
      staleAborted: 1,
      sessions: ["session_maintenance_effect"],
      hasMore: false,
    });
    await expect(persistence.getInvokeSessionMetadata(
      "deployment_maintenance_effect",
      "session_maintenance_effect",
    )).resolves.toMatchObject({
      state: "aborted",
      finishedAt: new Date(120),
    });
  });

  it("reads a fresh cutoff for every sequential sweep deployment", async () => {
    const persistence = memoryPersistence([
      deploymentMetadata({
        deploymentId: "deployment_a",
        projectId: "project_a",
      }),
      deploymentMetadata({
        deploymentId: "deployment_b",
        projectId: "project_b",
      }),
    ]);
    const baseOperations = sessionOperations(persistence);
    const cutoffs: Date[] = [];
    const operations: InvokeSessionOperations = {
      ...baseOperations,
      abortStale: (input) => Effect.gen(function* () {
        cutoffs.push(input.olderThan);
        yield* TestClock.adjust("10 millis");
        return { aborted: 0, sessions: [], hasMore: false };
      }),
    };

    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(100);
      return yield* runMaintenanceSweepEffect(
        persistence,
        makeSessionTimeEffect(undefined),
        operations,
        { deploymentLimit: 2, staleAfterMs: 50 },
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(cutoffs).toEqual([new Date(50), new Date(60)]);
    expect(result.deployments).toEqual([
      {
        deploymentId: "deployment_a",
        projectId: "project_a",
        staleAborted: 0,
        sessions: [],
        hasMoreSessions: false,
      },
      {
        deploymentId: "deployment_b",
        projectId: "project_b",
        staleAborted: 0,
        sessions: [],
        hasMoreSessions: false,
      },
    ]);
  });
});

function sessionOperations(
  persistence: ReturnType<typeof memoryPersistence>,
): InvokeSessionOperations {
  return makeInvokeSessionOperations({
    persistence,
    appDataEngines: createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    ),
    clock: undefined,
    ids: { nextId: () => "unused" },
    liveQueryInvalidation: undefined,
  });
}

function activeSession(input: {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly createdAt: Date;
}) {
  return {
    ...invokeSessionMetadata({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      packageId: "package_maintenance_effect",
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
      beginTs: 0,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    }),
    createdAt: input.createdAt,
  };
}
