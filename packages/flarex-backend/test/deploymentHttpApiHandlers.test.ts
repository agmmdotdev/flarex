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
  DeploymentArtifactRefError,
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
    expectMappedFailure(
      deploymentHttpErrorToFinishResponse,
      deploymentFailureToHttpError(new DeploymentArtifactRefError({
        operation: "executionArtifactRefForSourcePackage",
        message: "artifact hash failed",
        cause: new Error("artifact hash failed"),
      })),
      DeploymentStorageErrorResponse,
      "Deployment artifact error: artifact hash failed",
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
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          schema: "not-schema",
          functions: deploymentAnalysis().functions,
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Schema must be an object.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          schema: {
            ...deploymentAnalysis().schema,
            tables: [{
              tableId: 1,
              name: "messages",
              placement: { kind: "nearby" },
            }],
          },
          functions: deploymentAnalysis().functions,
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "$schema.tables.messages.placement: Invalid placement.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          schema: {
            ...deploymentAnalysis().schema,
            tables: [{
              tableId: 1,
              name: "messages",
              placement: { kind: "global" },
              validator: { type: "array", value: undefined },
            }],
          },
          functions: deploymentAnalysis().functions,
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "$schema.tables.messages.validator.value: Expected JSON value.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          schema: deploymentAnalysis().schema,
          functions: {
            functions: [{ path: "messages:list", kind: "query", route: "not-route" }],
          },
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "$functions.messages:list.route: Invalid route policy.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentPartitionValidationAnalysis(),
      },
      "teams:create.partition: Unknown partition table missing.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: "not-codegen",
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Codegen analysis must be an object.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: { ...deploymentAnalysis().schema, version: 2 },
          functions: [],
        },
      },
      "Codegen analysis schema must match deployment analysis schema.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: "not-functions",
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Codegen analysis functions must be an array.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: ["not-module"],
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Codegen module at index 0 must be an object.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "",
            functions: [],
          }],
        },
      },
      "Codegen module at index 0 has an invalid moduleName.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: "not-functions",
          }],
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Codegen module messages functions must be an array.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [
            { moduleName: "messages", functions: [] },
            { moduleName: "messages", functions: [] },
          ],
        },
      },
      "Duplicate codegen module metadata: messages.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: ["not-function"],
          }],
        },
      } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0],
      "Codegen function messages[0] must be an object.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "other",
              exportName: "list",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        },
      },
      "Codegen function messages[0] moduleName must match its module.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        },
      },
      "Codegen function messages[0] has an invalid exportName.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "missing",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        },
      },
      "Codegen function messages:missing has no deployment function metadata.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: [
              {
                moduleName: "messages",
                exportName: "list",
                kind: "query",
                visibility: "public",
                args: { type: "any" },
                returns: null,
                partition: null,
              },
              {
                moduleName: "messages",
                exportName: "list",
                kind: "query",
                visibility: "public",
                args: { type: "any" },
                returns: null,
                partition: null,
              },
            ],
          }],
        },
      },
      "Duplicate codegen function metadata path: messages:list.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "list",
              kind: "query",
              visibility: "public",
              args: null,
              returns: null,
              partition: null,
            }],
          }],
        },
      },
      "$codegen.functions.messages:list.args: Validator is required.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "list",
              kind: "mutation",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        },
      },
      "Codegen function messages:list must match deployment function metadata.",
    );
    expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          ...deploymentAnalysis(),
          functions: {
            functions: [{ path: "messages:list", kind: "query" }],
          },
        },
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: [],
        },
      },
      "Codegen analysis functions must cover every deployment function.",
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

    const schemaValidationFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: {
        schema: "not-schema",
        functions: deploymentAnalysis().functions,
      },
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(schemaValidationFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(schemaValidationFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(schemaValidationFailure.message).toBe("Schema must be an object.");

    const functionValidationFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: {
        schema: deploymentAnalysis().schema,
        functions: {
          functions: [{ path: "messages:list", kind: "query", route: "not-route" }],
        },
      },
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(functionValidationFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(functionValidationFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(functionValidationFailure.message).toBe("$functions.messages:list.route: Invalid route policy.");

    const partitionValidationFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentPartitionValidationAnalysis(),
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(partitionValidationFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(partitionValidationFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(partitionValidationFailure.message).toBe("teams:create.partition: Unknown partition table missing.");

    const codegenAnalysisFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: "not-codegen",
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenAnalysisFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenAnalysisFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenAnalysisFailure.message).toBe("Codegen analysis must be an object.");

    const codegenSchemaFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: { ...deploymentAnalysis().schema, version: 2 },
        functions: [],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenSchemaFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenSchemaFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenSchemaFailure.message).toBe("Codegen analysis schema must match deployment analysis schema.");

    const codegenFunctionsFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: "not-functions",
      },
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionsFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionsFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionsFailure.message).toBe("Codegen analysis functions must be an array.");

    const codegenModuleFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: ["not-module"],
      },
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenModuleFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenModuleFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenModuleFailure.message).toBe("Codegen module at index 0 must be an object.");

    const codegenModuleNameFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "",
          functions: [],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenModuleNameFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenModuleNameFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenModuleNameFailure.message).toBe("Codegen module at index 0 has an invalid moduleName.");

    const codegenModuleFunctionsFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: "not-functions",
        }],
      },
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenModuleFunctionsFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenModuleFunctionsFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenModuleFunctionsFailure.message).toBe("Codegen module messages functions must be an array.");

    const duplicateCodegenModuleFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [
          { moduleName: "messages", functions: [] },
          { moduleName: "messages", functions: [] },
        ],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(duplicateCodegenModuleFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(duplicateCodegenModuleFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(duplicateCodegenModuleFailure.message).toBe("Duplicate codegen module metadata: messages.");

    const codegenFunctionObjectFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: ["not-function"],
        }],
      },
    } as unknown as Parameters<typeof startAnalyzedPushHandlerInputFromPayload>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionObjectFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionObjectFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionObjectFailure.message).toBe("Codegen function messages[0] must be an object.");

    const codegenFunctionModuleNameFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: [{
            moduleName: "other",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          }],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionModuleNameFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionModuleNameFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionModuleNameFailure.message).toBe(
      "Codegen function messages[0] moduleName must match its module.",
    );

    const codegenFunctionExportNameFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: [{
            moduleName: "messages",
            exportName: "",
            kind: "query",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          }],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionExportNameFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionExportNameFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionExportNameFailure.message).toBe(
      "Codegen function messages[0] has an invalid exportName.",
    );

    const codegenFunctionMetadataFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: [{
            moduleName: "messages",
            exportName: "missing",
            kind: "query",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          }],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionMetadataFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionMetadataFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionMetadataFailure.message).toBe(
      "Codegen function messages:missing has no deployment function metadata.",
    );

    const duplicateCodegenFunctionFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: {
        ...deploymentAnalysis(),
        functions: {
          functions: [{ path: "messages:list", kind: "query" }],
        },
      },
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: [
            {
              moduleName: "messages",
              exportName: "list",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            },
            {
              moduleName: "messages",
              exportName: "list",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            },
          ],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(duplicateCodegenFunctionFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(duplicateCodegenFunctionFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(duplicateCodegenFunctionFailure.message).toBe(
      "Duplicate codegen function metadata path: messages:list.",
    );

    const codegenFunctionArgsFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: {
        ...deploymentAnalysis(),
        functions: {
          functions: [{ path: "messages:list", kind: "query" }],
        },
      },
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: [{
            moduleName: "messages",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: null,
            returns: null,
            partition: null,
          }],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionArgsFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionArgsFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionArgsFailure.message).toBe(
      "$codegen.functions.messages:list.args: Validator is required.",
    );

    const codegenFunctionMatchFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: {
        ...deploymentAnalysis(),
        functions: {
          functions: [{ path: "messages:list", kind: "query" }],
        },
      },
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [{
          moduleName: "messages",
          functions: [{
            moduleName: "messages",
            exportName: "list",
            kind: "mutation",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          }],
        }],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenFunctionMatchFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenFunctionMatchFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenFunctionMatchFailure.message).toBe(
      "Codegen function messages:list must match deployment function metadata.",
    );

    const codegenCoverageFailure = await Effect.runPromise(decodeStartAnalyzedPushHandlerInput({
      sourcePackage: sourcePackage(),
      analysis: {
        ...deploymentAnalysis(),
        functions: {
          functions: [{ path: "messages:list", kind: "query" }],
        },
      },
      codegenAnalysis: {
        schema: deploymentAnalysis().schema,
        functions: [],
      },
    }).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenCoverageFailure).toBeInstanceOf(DeploymentValidationError);
    if (!(codegenCoverageFailure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(codegenCoverageFailure.message).toBe(
      "Codegen analysis functions must cover every deployment function.",
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

function deploymentPartitionValidationAnalysis(): ActiveDeploymentStatus["analysis"] {
  return {
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "teams",
        placement: { kind: "partitionBy", field: "slug" },
      }],
      indexes: [],
    },
    functions: {
      functions: [{
        path: "teams:create",
        kind: "mutation",
        args: { type: "object", value: { teamSlug: { fieldType: { type: "string" }, optional: false } } },
        route: { type: "args", field: "teamSlug" },
        partition: {
          type: "partition",
          table: "missing",
          selector: "byId",
          partitionField: "_id",
          argField: "teamSlug",
        },
      }],
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
