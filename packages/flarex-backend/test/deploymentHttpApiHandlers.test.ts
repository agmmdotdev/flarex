import { describe, expect, it } from "vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import {
  DeploymentApi,
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentStorageErrorResponse,
  parseDeploymentErrorResponse,
} from "flarex-protocol/deployment";
import {
  deploymentHttpErrorToAbandonResponse,
  deploymentHttpErrorToFinishResponse,
  deploymentHttpErrorToReadResponse,
  deploymentHttpErrorToStartResponse,
  DeploymentApiHandlers,
  startAnalyzedPushHandlerInputFromPayload,
} from "../src/deployment/HttpApiHandlers";
import { deploymentFailureToHttpError } from "../src/deployment/HttpBoundary";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
} from "../src/deployment/Errors";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import { DeploymentService } from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
} from "../src/deployment/Store";
import { HttpError } from "../src/http";
import type {
  ActiveDeploymentStatus,
  ExecutionArtifactRef,
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
      new HttpError(400, "Deployment analysis must be an object."),
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
    if (!(cause instanceof HttpError)) throw cause;
    const error = deploymentHttpErrorToStartResponse(cause);
    expect(error).toBeInstanceOf(DeploymentBadRequestErrorResponse);
    expect(parseDeploymentErrorResponse(error)).toEqual({ error: message });
  }
}

type DeploymentApiErrorInstance =
  | DeploymentBadRequestErrorResponse
  | DeploymentConflictErrorResponse
  | DeploymentNotFoundErrorResponse
  | DeploymentStorageErrorResponse;

function deploymentTestLayer() {
  return DeploymentService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DeploymentPushStore,
        DeploymentPushStore.of({
          getPush: pushId => Effect.succeed(pushStatus(pushId)),
          getActiveDeployment: () => Effect.succeed(activeDeploymentStatus()),
          startAnalyzedPush: input => Effect.succeed(pushStatus(input.pushId)),
          finishPush: input => Effect.succeed({
            result: "activated",
            push: pushStatus(input.pushId, "activated"),
          }),
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
