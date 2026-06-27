import { describe, expect, it } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "../src/deployment/Errors";
import {
  DeploymentService,
  type StartAnalyzedPushInput,
} from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
  type AbandonPushStoreInput,
  type DeploymentSqlStorage,
  type DeploymentTransactionStorage,
  type FinishPushStoreInput,
  type StartAnalyzedPushStoreInput,
} from "../src/deployment/Store";
import {
  codegenAnalysisFromDeploymentAnalysis,
  type DeploymentPushStatusRow,
} from "../src/deployment/Validation";
import { HttpError } from "../src/http";
import type {
  ActiveDeploymentStatus,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushSourcePackage,
  PushStatus,
} from "../src/types";

describe("DeploymentService", () => {
  it("loads the active deployment through the store", async () => {
    const active = activeDeploymentStatus("push-active");

    const result = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()),
      {
        now: 1_600_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.succeed(active),
        },
      },
    );

    expect(result).toBe(active);
  });

  it("returns a typed not-found error for missing active deployments", async () => {
    const error = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()).pipe(
        Effect.catchTag("DeploymentActiveDeploymentNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 1_650_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.succeed(null),
        },
      },
    );

    expect(error).toBeInstanceOf(DeploymentActiveDeploymentNotFoundError);
  });

  it("preserves typed DeploymentSqlError failures from active deployment storage", async () => {
    const failure = new DeploymentSqlError({
      operation: "getActiveDeployment",
      cause: new Error("active read failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 1_660_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("preserves active deployment HttpError failures from storage", async () => {
    const failure = new HttpError(500, "Active push push-active is missing.");

    await expect(runDeployment(
      DeploymentService.use(service => service.getActiveDeployment()),
      {
        now: 1_670_000,
        pushId: "unused-push-id",
        store: {
          getActiveDeployment: () => Effect.fail(failure),
        },
      },
    )).rejects.toBe(failure);
  });

  it("loads push status through the store", async () => {
    const status = analyzedPushStatus("push-read");

    const result = await runDeployment(
      DeploymentService.use(service => service.getPush("push-read")),
      {
        now: 1_680_000,
        pushId: "unused-push-id",
        store: {
          getPush: pushId => Effect.succeed(pushId === "push-read" ? status : null),
        },
      },
    );

    expect(result).toBe(status);
  });

  it("returns a typed not-found error for missing push status reads", async () => {
    const error = await runDeployment(
      DeploymentService.use(service => service.getPush("missing-push")).pipe(
        Effect.catchTag("DeploymentPushNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 1_690_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(null),
        },
      },
    );

    if (!(error instanceof DeploymentPushNotFoundError)) {
      throw new Error("Expected DeploymentPushNotFoundError.");
    }
    expect(error.pushId).toBe("missing-push");
  });

  it("preserves typed DeploymentSqlError failures from push status reads", async () => {
    const failure = new DeploymentSqlError({
      operation: "getPush",
      cause: new Error("push read failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.getPush("push-read-storage-failed")).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 1_695_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

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
    const sql = sqlWithPushes([status]);
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
        () => {
          throw failure;
        },
        functions => functions,
        () => undefined,
        () => null,
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

  it("abandons eligible pushes with controlled clock and normalized reasons", async () => {
    const preflight = analyzedPushStatus("push-abandon");
    const abandoned: PushStatus = {
      ...preflight,
      state: "abandoned",
      error: "typecheck failed",
      updatedAt: 2_500_000,
    };
    const writes: AbandonPushStoreInput[] = [];

    const result = await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-abandon", { reason: "typecheck failed" })),
      {
        now: 2_500_000,
        pushId: "unused-push-id",
        store: {
          getPush: pushId => Effect.succeed(pushId === "push-abandon" ? preflight : null),
          abandonPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return abandoned;
            }),
        },
      },
    );

    expect(writes).toEqual([
      {
        pushId: "push-abandon",
        now: 2_500_000,
        reason: "typecheck failed",
      },
    ]);
    expect(result).toBe(abandoned);
  });

  it("defaults and truncates abandon reasons before storage", async () => {
    const writes: AbandonPushStoreInput[] = [];

    await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-default-reason", {})),
      {
        now: 2_600_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-default-reason")),
          abandonPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return { ...analyzedPushStatus(input.pushId), state: "abandoned", error: input.reason };
            }),
        },
      },
    );

    await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-long-reason", { reason: "x".repeat(1_100) })),
      {
        now: 2_700_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-long-reason")),
          abandonPush: input =>
            Effect.sync(() => {
              writes.push(input);
              return { ...analyzedPushStatus(input.pushId), state: "abandoned", error: input.reason };
            }),
        },
      },
    );

    expect(writes[0]).toMatchObject({
      pushId: "push-default-reason",
      reason: "Push abandoned before activation.",
    });
    expect(writes[1]).toMatchObject({
      pushId: "push-long-reason",
      reason: "x".repeat(1_000),
    });
  });

  it("returns a typed not-found error before abandon storage work", async () => {
    let abandonCalled = false;

    const error = await runDeployment(
      DeploymentService.use(service => service.abandonPush("missing-push", {})).pipe(
        Effect.catchTag("DeploymentPushNotFoundError", error => Effect.succeed(error)),
      ),
      {
        now: 2_800_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(null),
          abandonPush: () =>
            Effect.sync(() => {
              abandonCalled = true;
              return failedPushStatus("missing-push");
            }),
        },
      },
    );

    if (!(error instanceof DeploymentPushNotFoundError)) {
      throw new Error("Expected DeploymentPushNotFoundError.");
    }
    expect(error.pushId).toBe("missing-push");
    expect(abandonCalled).toBe(false);
  });

  it("returns a typed invalid-state error before abandon storage work", async () => {
    const preflight: PushStatus = { ...analyzedPushStatus("push-activated"), state: "activated" };
    let abandonCalled = false;

    const error = await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-activated", {})).pipe(
        Effect.catchTag("DeploymentPushInvalidStateError", error => Effect.succeed(error)),
      ),
      {
        now: 2_900_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(preflight),
          abandonPush: () =>
            Effect.sync(() => {
              abandonCalled = true;
              return preflight;
            }),
        },
      },
    );

    if (!(error instanceof DeploymentPushInvalidStateError)) {
      throw new Error("Expected DeploymentPushInvalidStateError.");
    }
    expect(error).toMatchObject({
      action: "abandon",
      pushId: "push-activated",
      state: "activated",
    });
    expect(abandonCalled).toBe(false);
  });

  it("preserves typed DeploymentSqlError failures from abandon storage", async () => {
    const failure = new DeploymentSqlError({
      operation: "abandonPush",
      cause: new Error("abandon failed"),
    });

    const error = await runDeployment(
      DeploymentService.use(service => service.abandonPush("push-abandon-storage-failed", {})).pipe(
        Effect.catchTag("DeploymentSqlError", error => Effect.succeed(error)),
      ),
      {
        now: 3_000_000,
        pushId: "unused-push-id",
        store: {
          getPush: () => Effect.succeed(analyzedPushStatus("push-abandon-storage-failed")),
          abandonPush: () => Effect.fail(failure),
        },
      },
    );

    expect(error).toBe(failure);
  });

  it("preserves abandon HttpError failures from the storage transaction", async () => {
    const status: PushStatus = { ...analyzedPushStatus("push-already-activated"), state: "activated" };
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const sql = sqlWithPushes([status]);
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
        schema => schema,
        functions => functions,
        () => undefined,
        () => null,
      ),
    );

    try {
      await expect(runtime.runPromise(
        DeploymentPushStore.use(store =>
          store.abandonPush({
            pushId: status.pushId,
            now: 3_100_000,
            reason: "too late",
          }),
        ),
      )).rejects.toMatchObject({
        status: 409,
        message: `Cannot abandon push ${status.pushId} in state activated.`,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves active deployment HttpError failures from the storage read", async () => {
    const status = analyzedPushStatus("push-active-metadata");
    const storage = {
      transaction: async <A>(callback: () => A | Promise<A>): Promise<A> => callback(),
    } as DeploymentTransactionStorage;
    const sql = sqlWithPushes([status]);
    const metadata = new Map<string, string>([
      ["active_push_id", status.pushId],
      ["active_activated_at", "3200000"],
    ]);
    const runtime = ManagedRuntime.make(
      DeploymentPushStore.layer(
        storage,
        sql,
        schema => schema,
        functions => functions,
        () => undefined,
        key => metadata.get(key) ?? null,
      ),
    );

    try {
      await expect(runtime.runPromise(
        DeploymentPushStore.use(store => store.getActiveDeployment()),
      )).rejects.toMatchObject({
        status: 500,
        message: `Active push ${status.pushId} has no execution artifact reference.`,
      });
    } finally {
      await runtime.dispose();
    }
  });
});

interface DeploymentTestStore {
  getPush?(pushId: string): Effect.Effect<PushStatus | null, DeploymentSqlError>;
  getActiveDeployment?(): Effect.Effect<ActiveDeploymentStatus | null, DeploymentSqlError | HttpError>;
  startAnalyzedPush?(input: StartAnalyzedPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError>;
  finishPush?(input: FinishPushStoreInput): Effect.Effect<FinishPushResponse, DeploymentSqlError | HttpError>;
  abandonPush?(input: AbandonPushStoreInput): Effect.Effect<PushStatus, DeploymentSqlError | HttpError>;
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
          getActiveDeployment: store.getActiveDeployment,
          startAnalyzedPush: store.startAnalyzedPush,
          finishPush: store.finishPush,
          abandonPush: store.abandonPush,
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
    getActiveDeployment: store.getActiveDeployment ?? (() => Effect.succeed(null)),
    startAnalyzedPush: store.startAnalyzedPush ?? (input => Effect.succeed(pushStatusFromStoreInput(input))),
    finishPush: store.finishPush ?? (() => Effect.succeed({
      result: "activated",
      push: analyzedPushStatus("default-finished-push"),
    })),
    abandonPush: store.abandonPush ?? (input => Effect.succeed({
      ...analyzedPushStatus(input.pushId),
      state: "abandoned",
      error: input.reason,
      updatedAt: input.now,
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

function sqlWithPushes(pushes: ReadonlyArray<PushStatus>): DeploymentSqlStorage {
  const rows = new Map(pushes.map(push => [push.pushId, pushStatusRow(push)]));
  return {
    exec: (_query: string, pushId?: string) => ({
      toArray: () => {
        if (typeof pushId !== "string") return [];
        const row = rows.get(pushId);
        return row === undefined ? [] : [row];
      },
    }),
  } as unknown as DeploymentSqlStorage;
}

function pushStatusRow(push: PushStatus): DeploymentPushStatusRow {
  return {
    push_id: push.pushId,
    state: push.state,
    source_package_json: JSON.stringify(push.sourcePackage),
    schema_json: push.analysis === undefined ? null : JSON.stringify(push.analysis.schema),
    functions_json: push.analysis === undefined ? null : JSON.stringify(push.analysis.functions),
    codegen_analysis_json: push.codegenAnalysis === undefined
      ? push.analysis === undefined
        ? null
        : JSON.stringify(codegenAnalysisFromDeploymentAnalysis(push.analysis))
      : JSON.stringify(push.codegenAnalysis),
    error: push.error ?? null,
    diagnostics_json: push.diagnostics === undefined || push.diagnostics.length === 0
      ? null
      : JSON.stringify(push.diagnostics),
    created_at: push.createdAt,
    updated_at: push.updatedAt,
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

function activeDeploymentStatus(activePushId: string): ActiveDeploymentStatus {
  const source = sourcePackage();
  const analysis = deploymentAnalysis();
  const codegenAnalysis = deploymentCodegenAnalysis();
  return {
    activePushId,
    activatedAt: 2_000,
    schemaVersion: analysis.schema.version,
    executionArtifactRef: executionArtifactRef(),
    sourcePackage: source,
    analysis,
    codegenAnalysis,
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
