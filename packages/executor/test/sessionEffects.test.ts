import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { TestClock } from "effect/testing";
import { createLegacyV1AppDataEngine } from "@flarex/persistence-postgres/legacy-v1-app-data-engine";
import {
  InvokeSessionDocumentValidationError,
  InvokeSessionDocumentWriteCorruptionError,
  InvokeSessionMetadataAlreadyExistsError,
  InvokeSessionOccConflictError,
} from "@flarex/persistence-postgres";
import type { ArtifactSourcePackage } from "flarex/artifacts";

import { createLegacyOnlyAppDataEngineRegistry } from "../src/appDataEngines";
import {
  createFlarexExecutor,
  InvokeRetryExhaustedError,
} from "../src";
import { runInvokeWithRetriesEffect } from "../src/retry";
import {
  makeInvokeSessionOperations,
  type InvokeSessionOperations,
} from "../src/sessions";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { memoryPersistence } from "./helpers/persistence";

describe("executor Effect-native invoke sessions", () => {
  it("uses Effect TestClock for a direct begin and abort lifecycle", async () => {
    const persistence = memoryPersistence();
    await prepareDeployment(persistence);
    const sessionOperations = makeInvokeSessionOperations({
      persistence,
      appDataEngines: createLegacyOnlyAppDataEngineRegistry(
        createLegacyV1AppDataEngine(persistence),
      ),
      clock: undefined,
      ids: { nextId: () => "session_effect_direct" },
      liveQueryInvalidation: undefined,
    });

    const result = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(15);
      const session = yield* sessionOperations.begin({
        deploymentId: "deployment_session",
        projectId: "project_session",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      });
      yield* TestClock.setTime(20);
      const aborted = yield* sessionOperations.abort({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: session.sessionId,
      });
      return { session, aborted };
    }).pipe(Effect.provide(TestClock.layer())));

    expect(result).toMatchObject({
      session: { sessionId: "session_effect_direct", beginTs: 15 },
      aborted: { aborted: true },
    });
    await expect(persistence.getInvokeSessionMetadata(
      "deployment_session",
      "session_effect_direct",
    )).resolves.toMatchObject({
      beginTs: 15,
      state: "aborted",
      finishedAt: new Date(20),
    });
  });

  it("uses Effect TestClock for every observation in a multi-attempt retry", async () => {
    const occFailure = new InvokeSessionOccConflictError(
      "deployment_session",
      "1:team",
      10,
      20,
    );
    const basePersistence = memoryPersistence();
    const commitDates: Date[] = [];
    const abortDates: Date[] = [];
    const persistence = {
      ...basePersistence,
      async commitInvokeSessionWrites(
        input: Parameters<typeof basePersistence.commitInvokeSessionWrites>[0],
      ): Promise<never> {
        commitDates.push(input.finishedAt);
        throw occFailure;
      },
      async abortInvokeSessionMetadata(
        input: Parameters<typeof basePersistence.abortInvokeSessionMetadata>[0],
      ) {
        abortDates.push(input.finishedAt);
        return await basePersistence.abortInvokeSessionMetadata(input);
      },
    };
    await prepareDeployment(persistence);
    let nextSession = 0;
    const appDataEngines = createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    );
    const sessionOperations = makeInvokeSessionOperations({
      persistence,
      appDataEngines,
      clock: undefined,
      ids: { nextId: () => `session_effect_retry_${++nextSession}` },
      liveQueryInvalidation: undefined,
    });

    const failure = await runEffectFailure(Effect.gen(function* () {
      yield* TestClock.setTime(15);
      return yield* runInvokeWithRetriesEffect(
        persistence,
        appDataEngines,
        sessionOperations,
        {
          deploymentId: "deployment_session",
          projectId: "project_session",
          path: "messages:send",
          kind: "mutation",
          args: { teamId: "1:team", text: "hello" },
          partitionKey: "1:team",
          maxAttempts: 2,
          runAttempt: async () => "ok",
        },
      );
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure).toBeInstanceOf(InvokeRetryExhaustedError);
    if (!(failure instanceof InvokeRetryExhaustedError)) {
      throw failure;
    }
    expect(failure.lastError).toBe(occFailure);
    expect(commitDates).toEqual([new Date(15), new Date(15)]);
    expect(abortDates).toEqual([new Date(15), new Date(15)]);
    await expect(basePersistence.getInvokeSessionMetadata(
      "deployment_session",
      "session_effect_retry_1",
    )).resolves.toMatchObject({ beginTs: 15, state: "aborted" });
    await expect(basePersistence.getInvokeSessionMetadata(
      "deployment_session",
      "session_effect_retry_2",
    )).resolves.toMatchObject({ beginTs: 15, state: "aborted" });
  });

  it("keeps known persistence failures typed and identity-preserved", async () => {
    const metadataFailure = new InvokeSessionMetadataAlreadyExistsError(
      "deployment_session",
      "session_effect_metadata_conflict",
    );
    const occFailure = new InvokeSessionOccConflictError(
      "deployment_session",
      "1:team",
      10,
      20,
    );
    const validationFailure = new InvokeSessionDocumentValidationError(
      "teams",
      "1:team",
      "expected a string",
      "$.name",
    );
    const corruptionFailure = new InvokeSessionDocumentWriteCorruptionError(
      "deployment_session",
      "session_effect_corruption",
      "1:team",
      "valueNotJson",
    );
    const basePersistence = memoryPersistence();
    await prepareDeployment(basePersistence);
    const persistence = {
      ...basePersistence,
      async insertInvokeSessionMetadata(): Promise<never> {
        throw metadataFailure;
      },
      async commitInvokeSessionWrites(): Promise<never> {
        throw occFailure;
      },
    };
    const appDataEngines = createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    );
    const sessionOperations = makeInvokeSessionOperations({
      persistence,
      appDataEngines,
      clock: undefined,
      ids: { nextId: () => "session_effect_metadata_conflict" },
      liveQueryInvalidation: undefined,
    });

    const beginFailure = await runEffectFailure(sessionOperations.begin({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    }));
    expect(beginFailure).toBe(metadataFailure);

    const commitFailures = [
      occFailure,
      validationFailure,
      corruptionFailure,
    ] as const;
    for (const [index, expectedFailure] of commitFailures.entries()) {
      const activePersistence = {
        ...basePersistence,
        async commitInvokeSessionWrites(): Promise<never> {
          throw expectedFailure;
        },
      };
      const activeEngines = createLegacyOnlyAppDataEngineRegistry(
        createLegacyV1AppDataEngine(activePersistence),
      );
      const activeOperations = makeInvokeSessionOperations({
        persistence: activePersistence,
        appDataEngines: activeEngines,
        clock: undefined,
        ids: { nextId: () => `session_effect_commit_failure_${index}` },
        liveQueryInvalidation: undefined,
      });
      const finishFailure = await runEffectFailure(Effect.gen(function* () {
        const session = yield* activeOperations.begin({
          deploymentId: "deployment_session",
          projectId: "project_session",
          path: "messages:send",
          kind: "mutation",
          args: { teamId: "1:team", text: "hello" },
          partitionKey: "1:team",
        });
        return yield* activeOperations.finish({
          deploymentId: "deployment_session",
          projectId: "project_session",
          sessionId: session.sessionId,
          value: "ok",
        });
      }).pipe(Effect.provide(TestClock.layer())));
      expect(finishFailure).toBe(expectedFailure);
    }
  });

  it("aborts an active session when post-begin work defects", async () => {
    const finishDefect = new Error("finish invariant failed");
    const persistence = memoryPersistence();
    await prepareDeployment(persistence);
    const appDataEngines = createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    );
    const baseSessionOperations = makeInvokeSessionOperations({
      persistence,
      appDataEngines,
      clock: undefined,
      ids: { nextId: () => "session_effect_finish_defect" },
      liveQueryInvalidation: undefined,
    });
    let abortCalls = 0;
    const sessionOperations: InvokeSessionOperations = {
      ...baseSessionOperations,
      finish: () => Effect.die(finishDefect),
      abort: (input) => Effect.gen(function* () {
        abortCalls += 1;
        return yield* baseSessionOperations.abort(input);
      }),
    };

    const exit = await runEffect(Effect.exit(Effect.gen(function* () {
      yield* TestClock.setTime(15);
      return yield* runInvokeWithRetriesEffect(
        persistence,
        appDataEngines,
        sessionOperations,
        {
          deploymentId: "deployment_session",
          projectId: "project_session",
          path: "messages:list",
          kind: "query",
          args: { teamId: "team:1" },
          partitionKey: "team:1",
          runAttempt: async () => "ok",
        },
      );
    }).pipe(Effect.provide(TestClock.layer()))));

    expect(abortCalls).toBe(1);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) {
        expect(defect.success).toBe(finishDefect);
      }
    }
    await expect(persistence.getInvokeSessionMetadata(
      "deployment_session",
      "session_effect_finish_defect",
    )).resolves.toMatchObject({ state: "aborted" });
  });

  it("does not suppress a defect from best-effort abort cleanup", async () => {
    const abortDefect = new Error("abort invariant failed");
    const attemptFailure = new Error("attempt failed");
    const persistence = memoryPersistence();
    await prepareDeployment(persistence);
    const appDataEngines = createLegacyOnlyAppDataEngineRegistry(
      createLegacyV1AppDataEngine(persistence),
    );
    const baseSessionOperations = makeInvokeSessionOperations({
      persistence,
      appDataEngines,
      clock: undefined,
      ids: { nextId: () => "session_effect_abort_defect" },
      liveQueryInvalidation: undefined,
    });
    const sessionOperations: InvokeSessionOperations = {
      ...baseSessionOperations,
      abort: () => Effect.die(abortDefect),
    };

    const exit = await runEffect(Effect.exit(Effect.gen(function* () {
      yield* TestClock.setTime(15);
      return yield* runInvokeWithRetriesEffect(
        persistence,
        appDataEngines,
        sessionOperations,
        {
          deploymentId: "deployment_session",
          projectId: "project_session",
          path: "messages:list",
          kind: "query",
          args: { teamId: "team:1" },
          partitionKey: "team:1",
          runAttempt: async () => {
            throw attemptFailure;
          },
        },
      );
    }).pipe(Effect.provide(TestClock.layer()))));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) {
        expect(defect.success).toBe(abortDefect);
      }
    }
  });
});

async function prepareDeployment(
  persistence: ReturnType<typeof memoryPersistence>,
): Promise<void> {
  const executor = createFlarexExecutor({ persistence });
  const registered = await executor.registerDeploymentPackage({
    deploymentId: "deployment_session",
    projectId: "project_session",
    sourcePackage: sourcePackage(),
    analysisJson: analysisJson(),
  });
  await executor.activateDeploymentPackage({
    deploymentId: "deployment_session",
    projectId: "project_session",
    packageId: registered.package.packageId,
    schemaVersion: 5,
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
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "messages:list",
          kind: "query",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
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
