import { describe, expect, it } from "vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import {
  DeploymentApi,
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentRoute,
  DeploymentStorageErrorResponse,
  parseDeploymentErrorResponse,
  parseDeploymentHealthResponse,
  parseFinishPushResponse,
  parsePushStatus,
} from "flarex-protocol/deployment";
import {
  deploymentHttpErrorToAbandonResponse,
  deploymentHttpErrorToFinishResponse,
  deploymentHttpErrorToReadResponse,
  deploymentHttpErrorToStartResponse,
  DeploymentApiHandlers,
  decodeStartAnalyzedPushHandlerInput,
  startAnalyzedPushHandlerInputFromPayload,
} from "../src/deployment/HttpApiHandlers";
import { makeDeploymentApiWebHandler } from "../src/deployment/HttpApiWebHandler";
import { deploymentFailureToHttpError } from "../src/deployment/HttpBoundary";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentValidationError,
} from "../src/deployment/Errors";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import { DeploymentService } from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
  type FinishPushStoreInput,
} from "../src/deployment/Store";
import { HttpError } from "../src/http";
import type {
  ActiveDeploymentStatus,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushSourcePackage,
  PushStatus,
} from "../src/types";

describe("DeploymentApiHandlers", () => {
  it("registers handlers for the current DeploymentApi endpoints", async () => {
    // This is a runtime-bridge test: HttpApiBuilder.group publishes handlers through a Layer.
    const runtime = ManagedRuntime.make(
      DeploymentApiHandlers.pipe(
        Layer.provide(deploymentTestLayer()),
      ),
    );
    try {
      const group = await runtime.runPromise(DeploymentApiGroupContext);

      expect(Array.from(group.handlers.keys()).sort()).toEqual([
        "abandonPush",
        "finishPush",
        "getActiveDeployment",
        "getPush",
        "health",
        "startAnalyzedPush",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("creates a Worker-compatible web handler for current DeploymentApi routes", async () => {
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer());
    try {
      const health = await handler(new Request(`https://deployment.test${DeploymentRoute.health}`));
      expect(health.status).toBe(200);
      const healthBody: unknown = await health.json();
      expect(parseDeploymentHealthResponse(healthBody)).toEqual({
        service: "flarex-deployment",
        status: "ok",
      });

      const push = await handler(new Request("https://deployment.test/push/push-web-handler"));
      expect(push.status).toBe(200);
      const pushBody: unknown = await push.json();
      expect(parsePushStatus(pushBody).pushId).toBe("push-web-handler");

      const invalidStart = await handler(new Request(
        `https://deployment.test${DeploymentRoute.startAnalyzedPush}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourcePackage: sourcePackage() }),
        },
      ));
      expect(invalidStart.status).toBe(400);
      const invalidStartBody: unknown = await invalidStart.json();
      expect(parseDeploymentErrorResponse(invalidStartBody)).toEqual({
        error: "A push without analysis must include an error message.",
      });
    } finally {
      await dispose();
    }
  });

  it("maps service response protocol mismatches to declared storage errors", async () => {
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer({
      getPush: pushId => {
        const malformedPushStatus = {
          ...pushStatus(pushId),
          state: "missing-state",
        };
        return Effect.succeed(malformedPushStatus as unknown as PushStatus);
      },
    }));
    try {
      const response = await handler(new Request("https://deployment.test/push/malformed-push"));

      expect(response.status).toBe(500);
      const body: unknown = await response.json();
      expect(parseDeploymentErrorResponse(body)).toEqual({
        error: "Deployment push response did not match the deployment protocol.",
      });
    } finally {
      await dispose();
    }
  });

  it("handles abandon-push mutations through the Worker-compatible web handler", async () => {
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer());
    try {
      const abandoned = await handler(new Request(
        "https://deployment.test/push/push-web-abandon/abandon",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      ));

      expect(abandoned.status).toBe(200);
      const abandonedBody: unknown = await abandoned.json();
      expect(parsePushStatus(abandonedBody)).toMatchObject({
        pushId: "push-web-abandon",
        state: "abandoned",
        error: "Push abandoned before activation.",
      });

      const conflict = makeDeploymentApiWebHandler(deploymentTestLayer({
        getPush: pushId => Effect.succeed(pushStatus(pushId, "activated")),
      }));
      try {
        const conflictResponse = await conflict.handler(new Request(
          "https://deployment.test/push/push-web-abandon-conflict/abandon",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        ));

        expect(conflictResponse.status).toBe(409);
        const conflictBody: unknown = await conflictResponse.json();
        expect(parseDeploymentErrorResponse(conflictBody)).toEqual({
          error: "Cannot abandon push push-web-abandon-conflict in state activated.",
        });
      } finally {
        await conflict.dispose();
      }
    } finally {
      await dispose();
    }
  });

  it("handles finish-push mutations through the Worker-compatible web handler", async () => {
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer());
    try {
      const activated = await handler(new Request(
        "https://deployment.test/push/push-web-finish/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      ));

      expect(activated.status).toBe(200);
      const activatedBody: unknown = await activated.json();
      expect(parseFinishPushResponse(activatedBody)).toMatchObject({
        result: "activated",
        push: {
          pushId: "push-web-finish",
          state: "activated",
        },
      });

      const rejected = makeDeploymentApiWebHandler(deploymentTestLayer({
        finishPush: input => Effect.succeed({
          result: "rejected",
          push: pushStatus(input.pushId, "failed"),
          code: "invalid_state",
          error: `Cannot finish push ${input.pushId} in state failed.`,
        }),
      }));
      try {
        const rejectedResponse = await rejected.handler(new Request(
          "https://deployment.test/push/push-web-finish-rejected/finish",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          },
        ));

        expect(rejectedResponse.status).toBe(409);
        const rejectedBody: unknown = await rejectedResponse.json();
        expect(parseFinishPushResponse(rejectedBody)).toMatchObject({
          result: "rejected",
          code: "invalid_state",
          error: "Cannot finish push push-web-finish-rejected in state failed.",
          push: {
            pushId: "push-web-finish-rejected",
            state: "failed",
          },
        });
      } finally {
        await rejected.dispose();
      }
    } finally {
      await dispose();
    }
  });

  it("handles analyzed start-push mutations through the Worker-compatible web handler", async () => {
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer());
    try {
      const started = await handler(new Request(
        `https://deployment.test${DeploymentRoute.startAnalyzedPush}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourcePackage: sourcePackage(),
            analysis: deploymentAnalysis(),
            codegenAnalysis: deploymentCodegenAnalysis(),
            diagnostics: [{ level: "warn", message: "generated warning" }],
          }),
        },
      ));

      expect(started.status).toBe(200);
      const startedBody: unknown = await started.json();
      expect(parsePushStatus(startedBody)).toMatchObject({
        pushId: "generated-push",
        state: "analyzed",
        sourcePackage: sourcePackage(),
        diagnostics: [],
      });
    } finally {
      await dispose();
    }
  });

  it("maps service failures to declared DeploymentApi error response bodies", () => {
    expectMappedFailure(
      deploymentHttpErrorToReadResponse,
      deploymentFailureToHttpError(new DeploymentActiveDeploymentNotFoundError()),
      DeploymentNotFoundErrorResponse,
      "No active deployment.",
    );
    expectMappedFailure(
      deploymentHttpErrorToReadResponse,
      deploymentFailureToHttpError(new DeploymentPushNotFoundError({ pushId: "push-missing" })),
      DeploymentNotFoundErrorResponse,
      "Unknown push: push-missing",
    );
    expectMappedFailure(
      deploymentHttpErrorToAbandonResponse,
      deploymentFailureToHttpError(new DeploymentPushInvalidStateError({
        action: "abandon",
        pushId: "push-active",
        state: "activated",
      })),
      DeploymentConflictErrorResponse,
      "Cannot abandon push push-active in state activated.",
    );
    expectMappedFailure(
      deploymentHttpErrorToReadResponse,
      deploymentFailureToHttpError(new DeploymentSqlError({
        operation: "getPush",
        cause: new Error("read failed"),
      })),
      DeploymentStorageErrorResponse,
      "Deployment storage error.",
    );
    expectMappedFailure(
      deploymentHttpErrorToStartResponse,
      deploymentFailureToHttpError(new DeploymentValidationError({
        message: "Deployment analysis must be an object.",
      })),
      DeploymentBadRequestErrorResponse,
      "Deployment analysis must be an object.",
    );
    expectMappedFailure(
      deploymentHttpErrorToFinishResponse,
      deploymentFailureToHttpError(new DeploymentPushNotFoundError({ pushId: "push-finish-missing" })),
      DeploymentNotFoundErrorResponse,
      "Unknown push: push-finish-missing",
    );
  });

  it("maps preserved HttpError statuses to DeploymentApi response classes", () => {
    expect(deploymentHttpErrorToStartResponse(
      new HttpError(400, "bad request"),
    )).toBeInstanceOf(DeploymentBadRequestErrorResponse);
    expect(deploymentHttpErrorToReadResponse(
      new HttpError(404, "missing"),
    )).toBeInstanceOf(DeploymentNotFoundErrorResponse);
    expect(deploymentHttpErrorToAbandonResponse(
      new HttpError(409, "conflict"),
    )).toBeInstanceOf(DeploymentConflictErrorResponse);
    expect(deploymentHttpErrorToFinishResponse(
      new HttpError(500, "storage failed"),
    )).toBeInstanceOf(DeploymentStorageErrorResponse);
  });

  it("maps invalid analyzed start-push payload combinations to 400 response bodies", () => {
    expectStartPayloadBadRequest(
      { sourcePackage: sourcePackage() },
      "A push without analysis must include an error message.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        error: "analysis failed",
        codegenAnalysis: deploymentCodegenAnalysis(),
      },
      "A push without analysis must not include codegenAnalysis.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        error: "analysis failed",
      },
      "A push with analysis must not include error.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        diagnostics: [{ level: "debug", message: "too chatty" }],
      },
      "Push diagnostic at index 0 has an invalid level.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: "not-analysis",
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Deployment analysis must be an object.",
    );
  });

  it("exposes typed analyzed start-push handler input validation", async () => {
    await expect(Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
      diagnostics: [{ level: "warn", message: "generated warning" }],
    }))).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
      diagnostics: [{ level: "warn", message: "generated warning" }],
    });

    const failure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      codegenAnalysis: deploymentCodegenAnalysis(),
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(failure).toBeInstanceOf(DeploymentValidationError);
    if (!(failure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(failure.message).toBe("A push without analysis must not include codegenAnalysis.");

    const diagnosticsFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      diagnostics: [{ level: "debug", message: "too chatty" }],
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(diagnosticsFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(diagnosticsFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(diagnosticsFailure.message).toBe("Push diagnostic at index 0 has an invalid level.");

    const analysisFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: "not-analysis",
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(analysisFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(analysisFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(analysisFailure.message).toBe("Deployment analysis must be an object.");
  });
});

type DeploymentApiGroupId = HttpApiGroup.ApiGroup<"flarex-deployment", "deployment">;

const DeploymentApiGroupContext = Context.Service<DeploymentApiGroupId, {
  readonly handlers: ReadonlyMap<string, unknown>;
}>(DeploymentApi.groups.deployment.key);

function expectMappedFailure(
  mapFailure: (error: HttpError) => DeploymentApiErrorInstance,
  failure: HttpError,
  expectedClass: new (props: { readonly error: string }) => DeploymentApiErrorInstance,
  message: string,
): void {
  const error = mapFailure(failure);
  expect(error).toBeInstanceOf(expectedClass);
  expect(parseDeploymentErrorResponse(error)).toEqual({ error: message });
}

function expectStartPayloadBadRequest(
  payload: Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
  message: string,
): void {
  try {
    startAnalyzedPushHandlerInputFromPayload(payload);
    throw new Error("Expected analyzed start-push payload to fail.");
  } catch (cause) {
    if (!(cause instanceof DeploymentValidationError)) throw cause;
    const error = deploymentHttpErrorToStartResponse(deploymentFailureToHttpError(cause));
    expect(error).toBeInstanceOf(DeploymentBadRequestErrorResponse);
    expect(parseDeploymentErrorResponse(error)).toEqual({ error: message });
  }
}

type DeploymentApiErrorInstance =
  | DeploymentBadRequestErrorResponse
  | DeploymentConflictErrorResponse
  | DeploymentNotFoundErrorResponse
  | DeploymentStorageErrorResponse;

interface DeploymentTestLayerOverrides {
  readonly getPush?: (pushId: string) => Effect.Effect<PushStatus>;
  readonly finishPush?: (
    input: FinishPushStoreInput,
  ) => Effect.Effect<FinishPushResponse, DeploymentSqlError | DeploymentValidationError>;
}

function deploymentTestLayer(overrides: DeploymentTestLayerOverrides = {}) {
  return DeploymentService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DeploymentPushStore,
        DeploymentPushStore.of({
          getPush: overrides.getPush ?? (pushId => Effect.succeed(pushStatus(pushId))),
          getActiveDeployment: () => Effect.succeed(activeDeploymentStatus()),
          startAnalyzedPush: input => Effect.succeed(pushStatus(input.pushId)),
          finishPush: overrides.finishPush ?? (input => Effect.succeed({
            result: "activated",
            push: pushStatus(input.pushId, "activated"),
          })),
          abandonPush: input => Effect.succeed({
            ...pushStatus(input.pushId, "abandoned"),
            error: input.reason,
          }),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentArtifacts,
        DeploymentArtifacts.of({
          executionArtifactRefForSourcePackage: () => Effect.succeed(executionArtifactRef()),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentClock,
        DeploymentClock.of({
          currentTimeMillis: Effect.succeed(1_700_000),
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        DeploymentIds,
        DeploymentIds.of({
          pushId: Effect.succeed("generated-push"),
        }),
      ),
    ),
  );
}

function activeDeploymentStatus(): ActiveDeploymentStatus {
  return {
    activePushId: "active-push",
    activatedAt: 1_700_000,
    schemaVersion: 0,
    executionArtifactRef: executionArtifactRef(),
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
  };
}

function pushStatus(pushId: string, state: PushStatus["state"] = "analyzed"): PushStatus {
  return {
    pushId,
    state,
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
    diagnostics: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

function sourcePackage(): PushSourcePackage {
  return {
    modules: [{
      path: "__execution.ts",
      environment: "isolate",
      sha256: "a".repeat(64),
    }],
    functions: [],
    execution: "__execution.ts",
  };
}

function deploymentAnalysis(): ActiveDeploymentStatus["analysis"] {
  return {
    schema: {
      version: 0,
      tables: [],
      indexes: [],
    },
    functions: {
      functions: [],
    },
  };
}

function deploymentCodegenAnalysis(): ActiveDeploymentStatus["codegenAnalysis"] {
  return {
    schema: {
      version: 0,
      tables: [],
      indexes: [],
    },
    functions: [],
  };
}

function executionArtifactRef(): ExecutionArtifactRef {
  return {
    runtime: "dynamic-worker",
    artifactId: "artifact-id",
    sourcePackageHash: "source-package-hash",
    executionModule: "__execution.ts",
  };
}
