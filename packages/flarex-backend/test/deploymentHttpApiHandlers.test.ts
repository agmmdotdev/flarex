import { describe, expect, it } from "vitest";
import { query } from "flarex/server";
import { isValidator, v, type GenericValidator, type Validator } from "flarex/values";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import {
  DeploymentApi,
  DeploymentBadRequestErrorResponse,
  DeploymentConflictErrorResponse,
  DeploymentNotFoundErrorResponse,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  DeploymentStorageErrorResponse,
  decodeDeploymentErrorResponseEffect,
  decodeDeploymentHealthResponseEffect,
  decodeFinishPushResponseEffect,
  decodePushStatusEffect,
  encodeDeploymentAnalysis,
  encodeDeploymentCodegenAnalysis,
} from "flarex-protocol/deployment";
import {
  deploymentAbandonFailureToResponse,
  deploymentFinishFailureToResponse,
  mapDeploymentAbandonFailure,
  mapDeploymentFinishFailure,
  mapDeploymentProtocolResponseFailure,
  mapDeploymentReadFailure,
  mapDeploymentStartFailure,
  deploymentReadFailureToResponse,
  deploymentStartFailureToResponse,
  deploymentActiveDeploymentResponseForHttpApi,
  DeploymentApiHandlers,
  decodeActiveDeploymentStatusForHttpApi,
  decodeFinishPushResponseForHttpApi,
  decodePushStatusForHttpApi,
  deploymentAbandonPushResponseForHttpApi,
  deploymentFinishPushResponseForHttpApi,
  deploymentPushStatusResponseForHttpApi,
  deploymentStartAnalyzedPushResponseForHttpApi,
  deploymentAbandonFailureResponseEffect,
  deploymentAbandonPushHandler,
  deploymentFinishFailureResponseEffect,
  deploymentFinishPushHandler,
  deploymentGetActiveDeploymentHandler,
  deploymentGetPushHandler,
  deploymentHealthHandler,
  deploymentProtocolResponseFailureEffect,
  deploymentReadFailureResponseEffect,
  deploymentStartAnalyzedPushHandler,
  deploymentStartFailureResponseEffect,
  decodeStartAnalyzedPushHandlerInput,
  decodeStartAnalyzedPushHandlerProtocolInput,
} from "../src/deployment/HttpApiHandlers";
import { makeDeploymentApiWebHandler } from "../src/deployment/HttpApiWebHandler";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentActiveDeploymentNotFoundError,
  DeploymentArtifactRefError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentStoredPushMissingError,
  DeploymentValidationError,
} from "../src/deployment/Errors";
import { DeploymentArtifacts, DeploymentClock, DeploymentIds } from "../src/deployment/Runtime";
import {
  DeploymentService,
  type DeploymentServiceApi,
  type StartAnalyzedPushInput,
} from "../src/deployment/Service";
import {
  DeploymentPushStore,
  DeploymentSqlError,
  type FinishPushStoreInput,
  type StartAnalyzedPushStoreInput,
  deploymentStartPushApplicationPlan,
  deploymentSchemaApplicationPlan,
  deploymentFunctionsApplicationPlan,
} from "../src/deployment/Store";
import { codegenAnalysisFromDeploymentAnalysis, decodePushStatusFromRow } from "../src/deployment/Validation";
import { decodeValidatorJsonWireV1 } from "flarex-protocol/validator-json";
import type {
  DeploymentAnalysis,
  ActiveDeploymentStatus,
  ExecutionArtifactRef,
  FinishPushResponse,
  PushSourcePackage,
  PushStatus,
} from "../src/types";

async function decodeDeploymentErrorResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeDeploymentErrorResponseEffect(value));
}

async function decodeDeploymentHealthResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeDeploymentHealthResponseEffect(value));
}

async function decodeFinishPushResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeFinishPushResponseEffect(value));
}

async function decodePushStatusForTest(value: unknown) {
  return await Effect.runPromise(decodePushStatusEffect(value));
}

describe("DeploymentApiHandlers", () => {
  const invalidTableRoots = [
    ["int64", () => v.literal(1n), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["negative zero", () => v.literal(-0), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["scalar", () => v.string(), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["array", () => v.array(v.string()), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["nested union", () => v.union(v.union(v.object({}))), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["nonfinite root", () => v.literal(NaN), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["nonfinite array", () => v.array(v.literal(Infinity)), 'Schema table "items" document validator must be any, an object, or a union of objects.'],
    ["record before root and finite", () => sourceRecord(v.literal(1n), v.literal(Infinity)), "Records can only have string keys; the key validator must be a subtype of v.string()."],
  ] as const;
  for (const suppliedCodegen of [false, true]) {
    it.each(invalidTableRoots)(`rejects fresh %s table roots before Store (supplied codegen=${suppliedCodegen})`, async (_name, root, message) => {
      const analysis = sdkFreshTableRoot(root());
      await expectFreshMetadataRejected({ sourcePackage: freshSourcePackage(), analysis: encodeDeploymentAnalysis(analysis),
        ...(suppliedCodegen ? { codegenAnalysis: encodeDeploymentCodegenAnalysis(codegenAnalysisFromDeploymentAnalysis(analysis)) } : {}),
      }, message);
    });
  }
  for (const side of ["analysis", "codegen"] as const) {
    it.each(invalidTableRoots.slice(0, 5))(`rejects a %s table root supplied only in ${side}`, async (_name, root) => {
      const invalid = sdkFreshTableRoot(root());
      const valid = sdkFreshTableRoot(v.object({}));
      await expectFreshMetadataRejected({ sourcePackage: freshSourcePackage(),
        analysis: encodeDeploymentAnalysis(side === "analysis" ? invalid : valid),
        codegenAnalysis: encodeDeploymentCodegenAnalysis(codegenAnalysisFromDeploymentAnalysis(side === "codegen" ? invalid : valid)),
      }, "Codegen analysis schema must match deployment analysis schema.");
    });
  }

  it.each([
    { type: "record", keys: { type: "string" }, values: { type: "number" } },
    { type: "record", keys: { type: "string" }, values: { fieldType: { type: "number" } } },
    { type: "record", keys: { type: "string" }, values: { fieldType: { type: "number" }, optional: true } },
  ])("refuses malformed source record transport before Store", async record => {
    let storeCalls = 0;
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer({
      startAnalyzedPush: () => Effect.sync(() => { storeCalls += 1; throw new Error("Malformed source wire reached Store"); }),
    }));
    try {
      const analysis = encodeDeploymentAnalysis(sdkFreshAnalysis(v.number(), "args"));
      const payload = { sourcePackage: freshSourcePackage(), analysis: { ...analysis, functions: { functions: [
        { ...analysis.functions.functions[0], args: { type: "object", value: { rows: { fieldType: record, optional: false } } } },
      ] } } };
      const response = await handler(new Request("https://deployment.test" + DeploymentRoute.startAnalyzedPush, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      }));
      expect(response.status).toBe(400);
      expect(storeCalls).toBe(0);
    } finally { await dispose(); }
  });

  const invalidSourceValidators = [
    ["int64 record key", () => sourceRecord(v.literal(1n), v.number()), "Records can only have string keys; the key validator must be a subtype of v.string()."],
    ["string literal record key", () => sourceRecord(v.literal("only"), v.number()), "Records cannot have string literal keys"],
    ["nonfinite record key", () => sourceRecord(v.literal(NaN), v.number()), "Records can only have string keys; the key validator must be a subtype of v.string()."],
    ["record before nonfinite value", () => sourceRecord(v.literal("only"), v.literal(Infinity)), "Records cannot have string literal keys"],
    ["NaN literal", () => v.literal(NaN), "Infinite or NaN values are not supported in literal validators."],
    ["Infinity literal", () => v.literal(Infinity), "Infinite or NaN values are not supported in literal validators."],
  ] as const;

  for (const location of ["table", "args", "returns"] as const) {
    for (const suppliedCodegen of [false, true]) {
      it.each(invalidSourceValidators)(`rejects fresh %s in ${location} before Store (supplied codegen=${suppliedCodegen})`, async (_name, leaf, message) => {
        const analysis = sdkFreshAnalysis(leaf(), location);
        await expectFreshMetadataRejected({ sourcePackage: freshSourcePackage(), analysis: encodeDeploymentAnalysis(analysis),
          ...(suppliedCodegen ? { codegenAnalysis: encodeDeploymentCodegenAnalysis(codegenAnalysisFromDeploymentAnalysis(analysis)) } : {}),
        }, message);
      });
    }
  }

  it.each(["analysis", "codegen"] as const)("rejects an invalid %s counterpart even when the other metadata is valid", async side => {
    const valid = sdkFreshAnalysis(v.literal(1n), "args");
    const invalid = sdkFreshAnalysis(v.literal(NaN), "args");
    const analysis = side === "analysis" ? invalid : valid;
    const codegen = codegenAnalysisFromDeploymentAnalysis(side === "codegen" ? invalid : valid);
    await expectFreshMetadataRejected({ sourcePackage: freshSourcePackage(), analysis: encodeDeploymentAnalysis(analysis),
      codegenAnalysis: encodeDeploymentCodegenAnalysis(codegen) }, "Codegen function lessons:list must match deployment function metadata.");
  });

  it.each([1n, -0])("round-trips literal %s through HTTP metadata, actual Store plans and stored-wire decoding", async value => {
    const validator = { type: "object" as const, value: { value: { fieldType: { type: "literal" as const, value }, optional: false } } };
    const analysis: DeploymentAnalysis = { schema: { version: 1, tables: [{ tableId: 1, name: "items", placement: { kind: "global" }, validator }], indexes: [] },
      functions: { functions: [{ path: "lessons:list", kind: "query", visibility: "public", args: validator,
        returns: { type: "literal", value }, route: null, partition: null }] } };
    const source = { ...sourcePackage(), functions: ["lessons.ts"], modules: [...sourcePackage().modules,
      { path: "lessons.ts", environment: "isolate" as const, sha256: "b".repeat(64) }] };
    let reachedStore = false;
    const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer({
      startAnalyzedPush: input => Effect.gen(function* () {
        if (!("analysis" in input)) throw new Error("Expected analyzed metadata");
        const returned = input.analysis.functions.functions[0]?.returns;
        if (returned?.type !== "literal") throw new Error("Expected semantic literal");
        expect(Object.is(returned.value, value)).toBe(true);
        reachedStore = true;
        const schemaPlan = yield* deploymentSchemaApplicationPlan(input.analysis.schema);
        const functionPlan = yield* deploymentFunctionsApplicationPlan(input.analysis.functions);
        const schemaLiteral = decodeValidatorJsonWireV1(JSON.parse(schemaPlan.tables[0]!.schemaJson));
        if (schemaLiteral.type !== "object" || schemaLiteral.value.value?.fieldType.type !== "literal") throw new Error("Expected stored schema literal");
        expect(Object.is(schemaLiteral.value.value.fieldType.value, value)).toBe(true);
        const functionLiteral = decodeValidatorJsonWireV1(JSON.parse(functionPlan.functions[0]!.returnsJson));
        if (functionLiteral.type !== "literal") throw new Error("Expected stored return literal");
        expect(Object.is(functionLiteral.value, value)).toBe(true);
        const { row } = yield* deploymentStartPushApplicationPlan(input);
        return yield* decodePushStatusFromRow({ push_id: row.pushId, state: row.state,
          source_package_json: row.sourcePackageJson, schema_json: row.schemaJson, functions_json: row.functionsJson,
          codegen_analysis_json: row.codegenAnalysisJson, error: row.error, diagnostics_json: row.diagnosticsJson,
          created_at: row.createdAt, updated_at: row.updatedAt });
      }),
    }));
    try {
      const response = await handler(new Request("https://deployment.test" + DeploymentRoute.startAnalyzedPush, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourcePackage: source,
          analysis: encodeDeploymentAnalysis(analysis), codegenAnalysis: encodeDeploymentCodegenAnalysis(codegenAnalysisFromDeploymentAnalysis(analysis)), diagnostics: [] }),
      }));
      expect(response.status).toBe(200);
      const reopened = await decodePushStatusForTest(await response.json());
      expect(reachedStore).toBe(true);
      const returned = reopened.analysis?.functions.functions[0]?.returns;
      if (returned?.type !== "literal") throw new Error("Expected reopened return literal");
      expect(Object.is(returned.value, value)).toBe(true);
    } finally { await dispose(); }
  });

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
      expect(await decodeDeploymentHealthResponseForTest(healthBody)).toEqual({
        service: "flarex-deployment",
        status: "ok",
      });

      const push = await handler(new Request("https://deployment.test/push/push-web-handler"));
      expect(push.status).toBe(200);
      const pushBody: unknown = await push.json();
      expect((await decodePushStatusForTest(pushBody)).pushId).toBe("push-web-handler");

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
      expect(await decodeDeploymentErrorResponseForTest(invalidStartBody)).toEqual({
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
      expect(await decodeDeploymentErrorResponseForTest(body)).toEqual({
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
      expect(await decodePushStatusForTest(abandonedBody)).toMatchObject({
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
        expect(await decodeDeploymentErrorResponseForTest(conflictBody)).toEqual({
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
      expect(await decodeFinishPushResponseForTest(activatedBody)).toMatchObject({
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
        expect(await decodeFinishPushResponseForTest(rejectedBody)).toMatchObject({
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
      expect(await decodePushStatusForTest(startedBody)).toMatchObject({
        pushId: "generated-push",
        state: "analyzed",
        sourcePackage: sourcePackage(),
        diagnostics: [],
      });
    } finally {
      await dispose();
    }
  });

  it("maps typed service failures to declared DeploymentApi error response bodies", async () => {
    await expectMappedFailure(
      deploymentReadFailureToResponse,
      new DeploymentActiveDeploymentNotFoundError(),
      DeploymentNotFoundErrorResponse,
      "No active deployment.",
    );
    await expectMappedFailure(
      deploymentReadFailureToResponse,
      new DeploymentPushNotFoundError({ pushId: "push-missing" }),
      DeploymentNotFoundErrorResponse,
      "Unknown push: push-missing",
    );
    await expectMappedFailure(
      deploymentAbandonFailureToResponse,
      new DeploymentPushInvalidStateError({
        action: "abandon",
        pushId: "push-active",
        state: "activated",
      }),
      DeploymentConflictErrorResponse,
      "Cannot abandon push push-active in state activated.",
    );
    await expectMappedFailure(
      deploymentReadFailureToResponse,
      new DeploymentSqlError({
        operation: "getPush",
        cause: new Error("read failed"),
      }),
      DeploymentStorageErrorResponse,
      "Deployment storage error.",
    );
    await expectMappedFailure(
      deploymentStartFailureToResponse,
      new DeploymentProtocolValidationError({
        schema: "AnalyzedStartPushRequest",
        message: "Analyzed start push request must include sourcePackage.",
        cause: {},
      }),
      DeploymentBadRequestErrorResponse,
      "Analyzed start push request must include sourcePackage.",
    );
    await expectMappedFailure(
      deploymentStartFailureToResponse,
      new DeploymentValidationError({
        message: "Deployment analysis must be an object.",
      }),
      DeploymentBadRequestErrorResponse,
      "Deployment analysis must be an object.",
    );
    await expectMappedFailure(
      deploymentFinishFailureToResponse,
      new DeploymentPushNotFoundError({ pushId: "push-finish-missing" }),
      DeploymentNotFoundErrorResponse,
      "Unknown push: push-finish-missing",
    );
    await expectMappedFailure(
      deploymentFinishFailureToResponse,
      new DeploymentArtifactRefError({
        operation: "executionArtifactRefForSourcePackage",
        message: "artifact hash failed",
        cause: new Error("artifact hash failed"),
      }),
      DeploymentStorageErrorResponse,
      "Deployment artifact error: artifact hash failed",
    );
  });

  it("maps typed generated-handler failure channels by tag", async () => {
    await expect(Effect.runPromise(mapDeploymentReadFailure(Effect.fail(
      new DeploymentActiveDeploymentNotFoundError(),
    )))).rejects.toBeInstanceOf(DeploymentNotFoundErrorResponse);

    await expect(Effect.runPromise(mapDeploymentStartFailure(Effect.fail(
      new DeploymentValidationError({ message: "Deployment analysis must be an object." }),
    )))).rejects.toBeInstanceOf(DeploymentBadRequestErrorResponse);

    await expect(Effect.runPromise(mapDeploymentFinishFailure(Effect.fail(
      new DeploymentPushNotFoundError({ pushId: "push-finish-missing" }),
    )))).rejects.toBeInstanceOf(DeploymentNotFoundErrorResponse);

    await expect(Effect.runPromise(mapDeploymentAbandonFailure(Effect.fail(
      new DeploymentPushInvalidStateError({
        action: "abandon",
        pushId: "push-active",
        state: "activated",
      }),
    )))).rejects.toBeInstanceOf(DeploymentConflictErrorResponse);

    await expect(Effect.runPromise(mapDeploymentProtocolResponseFailure(Effect.fail(
      new DeploymentProtocolValidationError({
        schema: "PushStatus",
        message: "Deployment push response did not match the deployment protocol.",
        cause: {},
      }),
    )))).rejects.toMatchObject({
      error: "Deployment push response did not match the deployment protocol.",
    });
  });

  it("maps read, start, and protocol response failures through named adapter effects", async () => {
    const readNotFound = await Effect.runPromise(Effect.flip(
      deploymentReadFailureResponseEffect(new DeploymentActiveDeploymentNotFoundError()),
    ));
    expect(readNotFound).toBeInstanceOf(DeploymentNotFoundErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(readNotFound)).toEqual({
      error: "No active deployment.",
    });

    const readStorage = await Effect.runPromise(Effect.flip(
      deploymentReadFailureResponseEffect(new DeploymentActiveDeploymentInvalidError({
        message: "Active push active-push is missing.",
      })),
    ));
    expect(readStorage).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(readStorage)).toEqual({
      error: "Active push active-push is missing.",
    });

    const startBadRequest = await Effect.runPromise(Effect.flip(
      deploymentStartFailureResponseEffect(new DeploymentProtocolValidationError({
        schema: "AnalyzedStartPushRequest",
        message: "Analyzed start push request must include sourcePackage.",
        cause: {},
      })),
    ));
    expect(startBadRequest).toBeInstanceOf(DeploymentBadRequestErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(startBadRequest)).toEqual({
      error: "Analyzed start push request must include sourcePackage.",
    });

    const startStorage = await Effect.runPromise(Effect.flip(
      deploymentStartFailureResponseEffect(new DeploymentStoredPushMissingError({
        operation: "startPush",
        pushId: "push-start-effect-storage",
        stage: "stored",
      })),
    ));
    expect(startStorage).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(startStorage)).toEqual({
      error: "Deployment storage error.",
    });

    const protocolStorage = await Effect.runPromise(Effect.flip(
      deploymentProtocolResponseFailureEffect(new DeploymentProtocolValidationError({
        schema: "PushStatus",
        message: "Deployment push response did not match the deployment protocol.",
        cause: {},
      })),
    ));
    expect(protocolStorage).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(protocolStorage)).toEqual({
      error: "Deployment push response did not match the deployment protocol.",
    });
  });

  it("maps finish and abandon failures through named adapter effects", async () => {
    const finishNotFound = await Effect.runPromise(Effect.flip(
      deploymentFinishFailureResponseEffect(
        new DeploymentPushNotFoundError({ pushId: "push-finish-effect-missing" }),
      ),
    ));
    expect(finishNotFound).toBeInstanceOf(DeploymentNotFoundErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(finishNotFound)).toEqual({
      error: "Unknown push: push-finish-effect-missing",
    });

    const finishStorage = await Effect.runPromise(Effect.flip(
      deploymentFinishFailureResponseEffect(new DeploymentStoredPushMissingError({
        operation: "finishPush",
        pushId: "push-finish-effect-storage",
        stage: "post-write",
      })),
    ));
    expect(finishStorage).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(finishStorage)).toEqual({
      error: "Deployment storage error.",
    });

    const abandonConflict = await Effect.runPromise(Effect.flip(
      deploymentAbandonFailureResponseEffect(new DeploymentPushInvalidStateError({
        action: "abandon",
        pushId: "push-abandon-effect-active",
        state: "activated",
      })),
    ));
    expect(abandonConflict).toBeInstanceOf(DeploymentConflictErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(abandonConflict)).toEqual({
      error: "Cannot abandon push push-abandon-effect-active in state activated.",
    });

    const abandonStorage = await Effect.runPromise(Effect.flip(
      deploymentAbandonFailureResponseEffect(new DeploymentSqlError({
        operation: "abandonPush",
        cause: new Error("abandon storage failed"),
      })),
    ));
    expect(abandonStorage).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(abandonStorage)).toEqual({
      error: "Deployment storage error.",
    });
  });

  it("runs named generated-handler effects with typed success and failure channels", async () => {
    const service = deploymentTestService();

    await expect(Effect.runPromise(deploymentHealthHandler())).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });

    await expect(Effect.runPromise(deploymentGetActiveDeploymentHandler(service))).resolves.toMatchObject({
      activePushId: "active-push",
      schemaVersion: 0,
    });

    await expect(Effect.runPromise(deploymentGetPushHandler(service, "push-direct"))).resolves.toMatchObject({
      pushId: "push-direct",
      state: "analyzed",
    });

    await expect(Effect.runPromise(deploymentStartAnalyzedPushHandler(service, {
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
      diagnostics: [{ level: "warn", message: "generated warning" }],
    }))).resolves.toMatchObject({
      pushId: "generated-push",
      state: "analyzed",
    });

    await expect(Effect.runPromise(deploymentFinishPushHandler(service, "push-finish-direct")))
      .resolves.toMatchObject({
        result: "activated",
        push: {
          pushId: "push-finish-direct",
          state: "activated",
        },
      });

    await expect(Effect.runPromise(deploymentAbandonPushHandler(service, "push-abandon-direct", {
      reason: "direct handler abandon",
    }))).resolves.toMatchObject({
      pushId: "push-abandon-direct",
      state: "abandoned",
      error: "direct handler abandon",
    });

    const missingPush = await Effect.runPromise(Effect.flip(deploymentGetPushHandler(
      deploymentTestService({
        getPush: pushId => Effect.fail(new DeploymentPushNotFoundError({ pushId })),
      }),
      "push-missing-direct",
    )));
    expect(missingPush).toBeInstanceOf(DeploymentNotFoundErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(missingPush)).toEqual({
      error: "Unknown push: push-missing-direct",
    });
  });

  it("maps read-side service and response validation through named HTTP API adapters", async () => {
    const service = deploymentTestService();

    await expect(Effect.runPromise(deploymentActiveDeploymentResponseForHttpApi(service)))
      .resolves.toMatchObject({
        activePushId: "active-push",
        schemaVersion: 0,
      });

    await expect(Effect.runPromise(deploymentPushStatusResponseForHttpApi(service, "push-read-adapter")))
      .resolves.toMatchObject({
        pushId: "push-read-adapter",
        state: "analyzed",
      });

    const missingActive = await Effect.runPromise(Effect.flip(deploymentActiveDeploymentResponseForHttpApi(
      deploymentTestService({
        getActiveDeployment: () => Effect.fail(new DeploymentActiveDeploymentNotFoundError()),
      }),
    )));
    expect(missingActive).toBeInstanceOf(DeploymentNotFoundErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(missingActive)).toEqual({
      error: "No active deployment.",
    });

    const invalidActiveProtocol = await Effect.runPromise(Effect.flip(deploymentActiveDeploymentResponseForHttpApi(
      deploymentTestService({
        getActiveDeployment: () =>
          Effect.succeed({
            ...activeDeploymentStatus(),
            executionArtifactRef: {
              ...executionArtifactRef(),
              runtime: "unsupported-runtime",
            },
          } as unknown as ActiveDeploymentStatus),
      }),
    )));
    expect(invalidActiveProtocol).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(invalidActiveProtocol)).toEqual({
      error: "Active deployment response did not match the deployment protocol.",
    });

    const malformedPushProtocol = await Effect.runPromise(Effect.flip(deploymentPushStatusResponseForHttpApi(
      deploymentTestService({
        getPush: pushId =>
          Effect.succeed({
            ...pushStatus(pushId),
            state: "missing-state",
          } as unknown as PushStatus),
      }),
      "push-malformed-adapter",
    )));
    expect(malformedPushProtocol).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(malformedPushProtocol)).toEqual({
      error: "Deployment push response did not match the deployment protocol.",
    });
  });

  it("maps start service responses through a named HTTP API adapter", async () => {
    await expect(Effect.runPromise(deploymentStartAnalyzedPushResponseForHttpApi(
      deploymentTestService(),
      startAnalyzedPushInput(),
    ))).resolves.toMatchObject({
      pushId: "generated-push",
      state: "analyzed",
    });

    const invalidStartInput = await Effect.runPromise(Effect.flip(deploymentStartAnalyzedPushResponseForHttpApi(
      deploymentTestService({
        startAnalyzedPush: () => Effect.fail(new DeploymentValidationError({
          message: "Deployment analysis must be an object.",
        })),
      }),
      startAnalyzedPushInput(),
    )));
    expect(invalidStartInput).toBeInstanceOf(DeploymentBadRequestErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(invalidStartInput)).toEqual({
      error: "Deployment analysis must be an object.",
    });

    const startStorage = await Effect.runPromise(Effect.flip(deploymentStartAnalyzedPushResponseForHttpApi(
      deploymentTestService({
        startAnalyzedPush: () => Effect.fail(new DeploymentStoredPushMissingError({
          operation: "startPush",
          pushId: "push-start-storage-adapter",
          stage: "stored",
        })),
      }),
      startAnalyzedPushInput(),
    )));
    expect(startStorage).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(startStorage)).toEqual({
      error: "Deployment storage error.",
    });

    const invalidStartProtocol = await Effect.runPromise(Effect.flip(deploymentStartAnalyzedPushResponseForHttpApi(
      deploymentTestService({
        startAnalyzedPush: () =>
          Effect.succeed({
            ...pushStatus("push-start-malformed-adapter"),
            state: "missing-state",
          } as unknown as PushStatus),
      }),
      startAnalyzedPushInput(),
    )));
    expect(invalidStartProtocol).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(invalidStartProtocol)).toEqual({
      error: "Deployment push response did not match the deployment protocol.",
    });
  });

  it("maps finish and abandon service responses through named HTTP API adapters", async () => {
    const service = deploymentTestService();

    await expect(Effect.runPromise(deploymentFinishPushResponseForHttpApi(
      service,
      "push-finish-adapter",
    ))).resolves.toMatchObject({
      result: "activated",
      push: {
        pushId: "push-finish-adapter",
        state: "activated",
      },
    });

    await expect(Effect.runPromise(deploymentAbandonPushResponseForHttpApi(
      service,
      "push-abandon-adapter",
      { reason: "adapter abandon" },
    ))).resolves.toMatchObject({
      pushId: "push-abandon-adapter",
      state: "abandoned",
      error: "adapter abandon",
    });

    const missingFinish = await Effect.runPromise(Effect.flip(deploymentFinishPushResponseForHttpApi(
      deploymentTestService({
        finishPush: pushId => Effect.fail(new DeploymentPushNotFoundError({ pushId })),
      }),
      "push-finish-missing-adapter",
    )));
    expect(missingFinish).toBeInstanceOf(DeploymentNotFoundErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(missingFinish)).toEqual({
      error: "Unknown push: push-finish-missing-adapter",
    });

    const invalidFinishProtocol = await Effect.runPromise(Effect.flip(deploymentFinishPushResponseForHttpApi(
      deploymentTestService({
        finishPush: pushId =>
          Effect.succeed({
            result: "activated",
            push: {
              ...pushStatus(pushId, "activated"),
              state: "missing-state",
            },
          } as unknown as FinishPushResponse),
      }),
      "push-finish-malformed-adapter",
    )));
    expect(invalidFinishProtocol).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(invalidFinishProtocol)).toEqual({
      error: "Finish push response did not match the deployment protocol.",
    });

    const activeAbandon = await Effect.runPromise(Effect.flip(deploymentAbandonPushResponseForHttpApi(
      deploymentTestService({
        abandonPush: pushId => Effect.fail(new DeploymentPushInvalidStateError({
          action: "abandon",
          pushId,
          state: "activated",
        })),
      }),
      "push-abandon-active-adapter",
      {},
    )));
    expect(activeAbandon).toBeInstanceOf(DeploymentConflictErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(activeAbandon)).toEqual({
      error: "Cannot abandon push push-abandon-active-adapter in state activated.",
    });

    const invalidAbandonProtocol = await Effect.runPromise(Effect.flip(deploymentAbandonPushResponseForHttpApi(
      deploymentTestService({
        abandonPush: pushId =>
          Effect.succeed({
            ...pushStatus(pushId, "abandoned"),
            state: "missing-state",
          } as unknown as PushStatus),
      }),
      "push-abandon-malformed-adapter",
      {},
    )));
    expect(invalidAbandonProtocol).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(invalidAbandonProtocol)).toEqual({
      error: "Deployment push response did not match the deployment protocol.",
    });
  });

  it("validates generated-handler responses through named protocol effects", async () => {
    await expect(Effect.runPromise(decodeActiveDeploymentStatusForHttpApi(
      activeDeploymentStatus(),
    ))).resolves.toMatchObject({
      activePushId: "active-push",
      schemaVersion: 0,
    });

    await expect(Effect.runPromise(decodePushStatusForHttpApi(
      pushStatus("push-response-direct"),
    ))).resolves.toMatchObject({
      pushId: "push-response-direct",
      state: "analyzed",
    });

    await expect(Effect.runPromise(decodeFinishPushResponseForHttpApi({
      result: "activated",
      push: pushStatus("push-finish-response-direct", "activated"),
    }))).resolves.toMatchObject({
      result: "activated",
      push: {
        pushId: "push-finish-response-direct",
        state: "activated",
      },
    });

    const failure = await Effect.runPromise(Effect.flip(decodePushStatusForHttpApi({
      ...pushStatus("push-response-invalid"),
      state: "missing-state",
    })));
    expect(failure).toBeInstanceOf(DeploymentStorageErrorResponse);
    expect(await decodeDeploymentErrorResponseForTest(failure)).toEqual({
      error: "Deployment push response did not match the deployment protocol.",
    });
  });

  it("maps invalid analyzed start-push payload combinations to 400 response bodies", async () => {
    await expectStartPayloadBadRequest(
      { sourcePackage: sourcePackage() },
      "A push without analysis must include an error message.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        error: "analysis failed",
        codegenAnalysis: deploymentCodegenAnalysis(),
      },
      "A push without analysis must not include codegenAnalysis.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        error: "analysis failed",
      },
      "A push with analysis must not include error.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        diagnostics: [{ level: "debug", message: "too chatty" }],
      },
      "Push diagnostic at index 0 has an invalid level.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: "not-analysis",
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Deployment analysis must be an object.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          schema: "not-schema",
          functions: deploymentAnalysis().functions,
        },
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Schema must be an object.",
    );
    await expectStartPayloadBadRequest(
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
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "$schema.tables.messages.placement: Invalid placement.",
    );
    await expectStartPayloadBadRequest(
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
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "$schema.tables.messages.validator.value: Expected JSON value.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: {
          schema: deploymentAnalysis().schema,
          functions: {
            functions: [{ path: "messages:list", kind: "query", route: "not-route" }],
          },
        },
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "$functions.messages:list.route: Invalid route policy.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentPartitionValidationAnalysis(),
      },
      "teams:create.partition: Unknown partition table missing.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: "not-codegen",
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Codegen analysis must be an object.",
    );
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: "not-functions",
        },
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Codegen analysis functions must be an array.",
    );
    await expectStartPayloadBadRequest(
      {
        sourcePackage: sourcePackage(),
        analysis: deploymentAnalysis(),
        codegenAnalysis: {
          schema: deploymentAnalysis().schema,
          functions: ["not-module"],
        },
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Codegen module at index 0 must be an object.",
    );
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Codegen module messages functions must be an array.",
    );
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
      } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
      "Codegen function messages[0] must be an object.",
    );
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
    await expectStartPayloadBadRequest(
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
      Effect.catchTag("DeploymentProtocolValidationError", error => Effect.succeed(error)),
    ));
    expect(failure).toBeInstanceOf(DeploymentProtocolValidationError);
    if (!(failure instanceof DeploymentProtocolValidationError)) {
      throw new Error("Expected DeploymentProtocolValidationError.");
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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
    } as unknown as Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0]).pipe(
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

  it("keeps generated-handler protocol guards separate from domain validation", async () => {
    await expect(Effect.runPromise(decodeStartAnalyzedPushHandlerProtocolInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
    }))).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
    });

    const missingError = await Effect.runPromise(decodeStartAnalyzedPushHandlerProtocolInput({
      sourcePackage: sourcePackage(),
    }).pipe(
      Effect.catchTag("DeploymentProtocolValidationError", error => Effect.succeed(error)),
    ));
    expect(missingError).toBeInstanceOf(DeploymentProtocolValidationError);
    if (!(missingError instanceof DeploymentProtocolValidationError)) {
      throw new Error("Expected DeploymentProtocolValidationError.");
    }
    expect(missingError.message).toBe("A push without analysis must include an error message.");

    const codegenWithoutAnalysis = await Effect.runPromise(decodeStartAnalyzedPushHandlerProtocolInput({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      codegenAnalysis: deploymentCodegenAnalysis(),
    }).pipe(
      Effect.catchTag("DeploymentProtocolValidationError", error => Effect.succeed(error)),
    ));
    expect(codegenWithoutAnalysis).toBeInstanceOf(DeploymentProtocolValidationError);
    if (!(codegenWithoutAnalysis instanceof DeploymentProtocolValidationError)) {
      throw new Error("Expected DeploymentProtocolValidationError.");
    }
    expect(codegenWithoutAnalysis.message).toBe("A push without analysis must not include codegenAnalysis.");

    const errorWithAnalysis = await Effect.runPromise(decodeStartAnalyzedPushHandlerProtocolInput({
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      error: "analysis failed",
    }).pipe(
      Effect.catchTag("DeploymentProtocolValidationError", error => Effect.succeed(error)),
    ));
    expect(errorWithAnalysis).toBeInstanceOf(DeploymentProtocolValidationError);
    if (!(errorWithAnalysis instanceof DeploymentProtocolValidationError)) {
      throw new Error("Expected DeploymentProtocolValidationError.");
    }
    expect(errorWithAnalysis.message).toBe("A push with analysis must not include error.");
  });
});

type DeploymentApiGroupId = HttpApiGroup.Service<"flarex-deployment", "deployment">;

const DeploymentApiGroupContext = Context.Service<DeploymentApiGroupId, {
  readonly handlers: ReadonlyMap<string, unknown>;
}>(DeploymentApi.groups.deployment.key);

async function expectMappedFailure<E>(
  mapFailure: (error: E) => DeploymentApiErrorInstance,
  failure: E,
  expectedClass: new (props: { readonly error: string }) => DeploymentApiErrorInstance,
  message: string,
): Promise<void> {
  const error = mapFailure(failure);
  expect(error).toBeInstanceOf(expectedClass);
  expect(await decodeDeploymentErrorResponseForTest(error)).toEqual({ error: message });
}

async function expectStartPayloadBadRequest(
  payload: Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0],
  message: string,
): Promise<void> {
  const cause = await Effect.runPromise(Effect.flip(
    decodeStartAnalyzedPushHandlerInput(payload),
  ));
  const error = deploymentStartFailureToResponse(cause);
  expect(error).toBeInstanceOf(DeploymentBadRequestErrorResponse);
  expect(await decodeDeploymentErrorResponseForTest(error)).toEqual({ error: message });
}

type DeploymentApiErrorInstance =
  | DeploymentBadRequestErrorResponse
  | DeploymentConflictErrorResponse
  | DeploymentNotFoundErrorResponse
  | DeploymentStorageErrorResponse;

interface DeploymentTestLayerOverrides {
  readonly startAnalyzedPush?: (input: StartAnalyzedPushStoreInput) => Effect.Effect<PushStatus, DeploymentValidationError>;
  readonly getPush?: (pushId: string) => Effect.Effect<PushStatus>;
  readonly finishPush?: (
    input: FinishPushStoreInput,
  ) => Effect.Effect<FinishPushResponse, DeploymentSqlError | DeploymentValidationError>;
}

interface DeploymentTestServiceOverrides {
  readonly getActiveDeployment?: DeploymentServiceApi["getActiveDeployment"];
  readonly getPush?: DeploymentServiceApi["getPush"];
  readonly startAnalyzedPush?: DeploymentServiceApi["startAnalyzedPush"];
  readonly finishPush?: DeploymentServiceApi["finishPush"];
  readonly abandonPush?: DeploymentServiceApi["abandonPush"];
}

function deploymentTestService(
  overrides: DeploymentTestServiceOverrides = {},
): DeploymentServiceApi {
  return {
    getActiveDeployment: overrides.getActiveDeployment ?? (() => Effect.succeed(activeDeploymentStatus())),
    getPush: overrides.getPush ?? (pushId => Effect.succeed(pushStatus(pushId))),
    startAnalyzedPush: overrides.startAnalyzedPush ?? (() => Effect.succeed(pushStatus("generated-push"))),
    finishPush: overrides.finishPush ?? (pushId => Effect.succeed({
      result: "activated",
      push: pushStatus(pushId, "activated"),
    })),
    abandonPush: overrides.abandonPush ?? ((pushId, request) => Effect.succeed({
      ...pushStatus(pushId, "abandoned"),
      error: request.reason ?? "Push abandoned before activation.",
    })),
  };
}

function deploymentTestLayer(overrides: DeploymentTestLayerOverrides = {}) {
  return DeploymentService.layer.pipe(
    Layer.provide(
      Layer.succeed(
        DeploymentPushStore,
        DeploymentPushStore.of({
          getPush: overrides.getPush ?? (pushId => Effect.succeed(pushStatus(pushId))),
          getActiveDeployment: () => Effect.succeed(activeDeploymentStatus()),
          startAnalyzedPush: overrides.startAnalyzedPush ?? (input => Effect.succeed(pushStatus(input.pushId))),
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

function startAnalyzedPushInput(
  overrides: Partial<StartAnalyzedPushInput> = {},
): StartAnalyzedPushInput {
  return {
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
    diagnostics: [],
    ...overrides,
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


function sourceRecord(key: GenericValidator, value: GenericValidator): Validator<unknown, "required", string> {
  const validator: unknown = Reflect.apply(v.record, undefined, [key, value]);
  if (!isRequiredTestValidator(validator)) throw new Error("Expected SDK record validator");
  return validator;
}

function freshSourcePackage(): PushSourcePackage {
  return { ...sourcePackage(), functions: ["lessons.ts"], modules: [...sourcePackage().modules,
    { path: "lessons.ts", environment: "isolate", sha256: "b".repeat(64) }] };
}

function sdkFreshAnalysis(leaf: Validator<unknown, "required", string>, location: "table" | "args" | "returns"): DeploymentAnalysis {
  const registered = query({ args: { value: location === "args" ? leaf : v.string() },
    returns: location === "returns" ? leaf : v.null(), handler: async () => null });
  return { schema: { version: 1, tables: location === "table" ? [{ tableId: 1, name: "items", placement: { kind: "global" },
    validator: decodeValidatorJsonWireV1(v.object({ value: leaf }).json) }] : [], indexes: [] },
    functions: { functions: [{ path: "lessons:list", kind: "query", visibility: "public",
      args: decodeValidatorJsonWireV1(JSON.parse(registered.exportArgs())), returns: decodeValidatorJsonWireV1(JSON.parse(registered.exportReturns())),
      route: null, partition: null }] } };
}

async function expectFreshMetadataRejected(payload: Parameters<typeof decodeStartAnalyzedPushHandlerInput>[0], message: string): Promise<void> {
  let storeCalls = 0;
  const { handler, dispose } = makeDeploymentApiWebHandler(deploymentTestLayer({
    startAnalyzedPush: () => Effect.sync(() => { storeCalls += 1; throw new Error("Fresh invalid metadata reached Store"); }),
  }));
  try {
    const response = await handler(new Request("https://deployment.test" + DeploymentRoute.startAnalyzedPush, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(storeCalls).toBe(0);
  } finally { await dispose(); }
}

function isRequiredTestValidator(value: unknown): value is Validator<unknown, "required", string> {
  return isValidator(value) && value.isOptional === "required";
}

function sdkFreshTableRoot(root: Validator<unknown, "required", string>): DeploymentAnalysis {
  const base = sdkFreshAnalysis(v.number(), "args");
  return { ...base, schema: { ...base.schema, tables: [{ tableId: 1, name: "items", placement: { kind: "global" },
    validator: decodeValidatorJsonWireV1(root.json) }] } };
}
