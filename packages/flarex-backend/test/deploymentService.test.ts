import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import {
  DeploymentPushNotFoundError,
  DeploymentService,
  type StartAnalyzedPushInput,
} from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
  type FinishPushStoreInput,
  type StartAnalyzedPushStoreInput,
} from "../src/deployment/Store";
import { HttpError } from "../src/http";
import type {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushSourcePackage,
  PushStatus,
} from "../src/types";

describe("DeploymentService", () => {
  it("starts analyzed pushes with the controlled clock and push id", async () => {
    const writes: StartAnalyzedPushStoreInput[] = [];
    const input: StartAnalyzedPushInput = {
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
      diagnostics: [{ level: "log", message: "ok" }],
    };

    const result = await runDeployment(
      DeploymentService.use(service => service.startAnalyzedPush(input)),
      {
        now: 1_700_000,
        pushId: "push-analyzed",
        store: {
          startAnalyzedPush: storeInput =>
            Effect.sync(() => {
              writes.push(storeInput);
              return pushStatusFromStoreInput(storeInput);
            }),
        },
      },
    );

    expect(writes).toEqual([
      {
        pushId: "push-analyzed",
        now: 1_700_000,
        sourcePackage: input.sourcePackage,
        analysis: input.analysis,
        codegenAnalysis: input.codegenAnalysis,
        diagnostics: input.diagnostics,
      },
    ]);
    expect(result).toMatchObject({
      pushId: "push-analyzed",
      state: "analyzed",
      analysis: input.analysis,
      codegenAnalysis: input.codegenAnalysis,
    });
  });

  it("starts failed pushes without analysis metadata", async () => {
    const writes: StartAnalyzedPushStoreInput[] = [];
    const input: StartAnalyzedPushInput = {
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      diagnostics: [{ level: "error", message: "failed" }],
    };

    const result = await runDeployment(
      DeploymentService.use(service => service.startAnalyzedPush(input)),
      {
        now: 1_800_000,
        pushId: "push-failed",
        store: {
          startAnalyzedPush: storeInput =>
            Effect.sync(() => {
              writes.push(storeInput);
              return pushStatusFromStoreInput(storeInput);
            }),
        },
      },
    );

    expect(writes).toEqual([
      {
        pushId: "push-failed",
        now: 1_800_000,
        sourcePackage: input.sourcePackage,
        error: "analysis failed",
        diagnostics: input.diagnostics,
      },
    ]);
    expect(result).toMatchObject({
      pushId: "push-failed",
      state: "failed",
      error: "analysis failed",
    });
  });

  it("preserves typed DeploymentSqlError failures from the store", async () => {
    const failure = new DeploymentSqlError({
      operation: "startPush",
      cause: new Error("insert failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service =>
        service.startAnalyzedPush({
          sourcePackage: sourcePackage(),
          error: "analysis failed",
          diagnostics: [],
        })
      ).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 1_900_000,
        pushId: "push-storage-failed",
        store: {
          startAnalyzedPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("finishes analyzed pushes with controlled clock and artifact refs", async () => {
    const preflight = analyzedPushStatus("push-finish");
    const finished: FinishPushResponse = {
      result: "activated",
      push: { ...preflight, state: "activated", updatedAt: 2_000_000 },
    };
    const artifactRequests: PushSourcePackage[] = [];
    const writes: FinishPushStoreInput[] = [];
    const ref = executionArtifactRef();

    const result = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-finish")),
      {
        now: 2_000_000,
        pushId: "unused-push-id",
        artifactRef: ref,
        artifactRequests,
        store: {
          getPush: pushId => Effect.succeed(pushId === "push-finish" ? preflight : null),
          finishPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return finished;
            }),
        },
      },
    );

    expect(artifactRequests).toEqual([preflight.sourcePackage]);
    expect(writes).toEqual([
      {
        pushId: "push-finish",
        now: 2_000_000,
        executionArtifactRef: ref,
      },
    ]);
    expect(result).toBe(finished);
  });

  it("preserves finish rejection responses from the store", async () => {
    const preflight = failedPushStatus("push-invalid-state");
    const rejection: FinishPushResponse = {
      result: "rejected",
      push: preflight,
      code: "invalid_state",
      error: "Cannot finish push push-invalid-state in state failed.",
      ...(preflight.diagnostics === undefined ? {} : { diagnostics: preflight.diagnostics }),
    };

    const result = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-invalid-state")),
      {
        now: 2_100_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(preflight),
          finishPush: () => Effect.succeed(rejection),
        },
      },
    );

    expect(result).toBe(rejection);
  });

  it("returns a typed not-found error before artifact or finish work", async () => {
    const artifactRequests: PushSourcePackage[] = [];
    let finishCalled = false;

    const error = await runDeployment(
      DeploymentService.use(service => service.finishPush("missing-push")).pipe(
        Effect.catchTag("DeploymentPushNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 2_200_000,
        pushId: "unused-push-id",
        artifactRequests,
        store: {
          getPush: () => Effect.succeed(null),
          finishPush: () =>
            Effect.sync(() => {
              finishCalled = true;
              return { result: "activated", push: analyzedPushStatus("missing-push") };
            }),
        },
      },
    );

    if (!(error instanceof DeploymentPushNotFoundError)) {
      throw new Error("Expected DeploymentPushNotFoundError.");
    }
    expect(error.pushId).toBe("missing-push");
    expect(artifactRequests).toEqual([]);
    expect(finishCalled).toBe(false);
  });

  it("preserves typed DeploymentSqlError failures from finish storage", async () => {
    const failure = new DeploymentSqlError({
      operation: "finishPush",
      cause: new Error("finish failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.finishPush("push-storage-failed")).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 2_300_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-storage-failed")),
          finishPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("preserves activation HttpError failures from the finish transaction", async () => {
    const failure = new HttpError(400, "Schema must be an object.");
    const status = analyzedPushStatus("push-validation-failed");
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const sql = {
      exec: () => undefined,
    } as unknown as DeploymentSqlStorage;
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
        pushId => (pushId === status.pushId ? status : null),
        () => {
          throw failure;
        },
        functions => functions,
        () => undefined,
      ),
    );

    try {
      await expect(runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.finishPush({
            pushId: status.pushId,
            now: 2_400_000,
            executionArtifactRef: executionArtifactRef(),
          }),
        ),
      )).rejects.toBe(failure);
    } finally {
      await runtime.dispose();
    }
  });
});

interface DeploymentTestStore {
  getPush?(pushId: string): Effect.Effect<PushStatus | null, DeploymentSqlError>;
  startAnalyzedPush?(input: StartAnalyzedPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError>;
  finishPush?(input: FinishPushStoreInput): Effect.Effect<FinishPushResponse, DeploymentSqlError | HttpError>;
}

interface DeploymentTestLayerOptions {
  readonly now: number;
  readonly pushId: string;
  readonly artifactRef?: ExecutionArtifactRef;
  readonly artifactRequests?: PushSourcePackage[];
  readonly store: DeploymentTestStore;
}

async function runDeployment<A, E>(
  effect: Effect.Effect<A, E, DeploymentService>,
  options: DeploymentTestLayerOptions,
): Promise<A> {
  const runtime = ManagedRuntime.make(deploymentTestLayer(options));
  try {
    return await runtime.runPromise(effect);
  } finally {
    await runtime.dispose();
  }
}

function deploymentTestLayer(options: DeploymentTestLayerOptions) {
  const store = testStore(options.store);
  return DeploymentService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DeploymentPushStore,
        DeploymentPushStore.of({
          getPush: store.getPush,
          startAnalyzedPush: store.startAnalyzedPush,
          finishPush: store.finishPush,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentArtifacts,
        DeploymentArtifacts.of({
          executionArtifactRefForSourcePackage: sourcePackage =>
            Effect.sync(() => {
              options.artifactRequests?.push(sourcePackage);
              return options.artifactRef ?? executionArtifactRef();
            }),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentClock,
        DeploymentClock.of({
          currentTimeMillis: Effect.succeed(options.now),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentIds,
        DeploymentIds.of({
          pushId: Effect.succeed(options.pushId),
        }),
      ),
    ),
  );
}

function testStore(store: DeploymentTestStore): Required<DeploymentTestStore> {
  return {
    getPush: store.getPush ?? (() => Effect.succeed(null)),
    startAnalyzedPush: store.startAnalyzedPush ?? (input => Effect.succeed(pushStatusFromStoreInput(input))),
    finishPush: store.finishPush ?? (() => Effect.succeed({
      result: "activated",
      push: analyzedPushStatus("default-finished-push"),
    })),
  };
}

function pushStatusFromStoreInput(input: StartAnalyzedPushStoreInput): PushStatus {
  const base = {
    pushId: input.pushId,
    sourcePackage: input.sourcePackage,
    diagnostics: [...input.diagnostics],
    createdAt: input.now,
    updatedAt: input.now,
  };
  if ("analysis" in input) {
    return {
      ...base,
      state: "analyzed",
      analysis: input.analysis,
      codegenAnalysis: input.codegenAnalysis,
    };
  }
  return {
    ...base,
    state: "failed",
    error: input.error,
  };
}

function analyzedPushStatus(pushId: string): PushStatus {
  return {
    pushId,
    state: "analyzed",
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function failedPushStatus(pushId: string): PushStatus {
  return {
    pushId,
    state: "failed",
    sourcePackage: sourcePackage(),
    error: "analysis failed",
    diagnostics: [{ level: "error", message: "failed" }],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function executionArtifactRef(): ExecutionArtifactRef {
  return {
    runtime: "dynamic-worker",
    artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourcePackageHash: "a".repeat(64),
    executionModule: "__execution.ts",
  };
}

function sourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "lessons.ts",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
      {
        path: "__execution.ts",
        environment: "isolate",
        sha256: "b".repeat(64),
      },
    ],
    functions: ["lessons.ts"],
    execution: "__execution.ts",
  };
}

function deploymentAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          visibility: "public",
          args: { type: "object", value: {} },
          returns: null,
          route: null,
          partition: null,
        },
      ],
    },
  };
}

function deploymentCodegenAnalysis(): DeploymentCodegenAnalysis {
  return {
    schema: deploymentAnalysis().schema,
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
            partition: null,
          },
        ],
      },
    ],
  };
}
