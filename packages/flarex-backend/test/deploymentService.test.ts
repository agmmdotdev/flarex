import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import {
  DeploymentService,
  type StartAnalyzedPushInput,
} from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
  type StartAnalyzedPushStoreInput,
} from "../src/deployment/Store";
import type {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
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
});

interface DeploymentTestStore {
  startAnalyzedPush(input: StartAnalyzedPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError>;
}

interface DeploymentTestLayerOptions {
  readonly now: number;
  readonly pushId: string;
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
  return DeploymentService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DeploymentPushStore,
        DeploymentPushStore.of({
          startAnalyzedPush: options.store.startAnalyzedPush,
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
