import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  DeploymentProtocolValidationError,
  DeploymentPushAction,
  DeploymentRoute,
  decodeActiveDeploymentStatusEffect,
  decodeAnalyzedStartPushRequestEffect,
  decodeDeploymentErrorResponseEffect,
  decodeFinishPushResponseEffect,
  decodePushStatusEffect,
} from "flarex-protocol/deployment";
import { RequestJsonError } from "../src/http";
import {
  decodeDeploymentApiRouteInput,
  decodeDeploymentAnalyzedStartPushRouteRequest,
  decodeDeploymentAnalyzedStartPushRoutePayload,
  decodeDeploymentAbandonPushRouteRequest,
  decodeDeploymentAbandonPushRoutePayload,
  decodeDeploymentFinishPushRouteRequest,
  decodeDeploymentFinishPushRoutePayload,
  deploymentRouteErrorToHttpErrorEffect,
} from "../src/deployment/HttpApiRouteBoundary";
import {
  dispatchDeploymentApiReadRouteInputDirect,
  dispatchDeploymentApiMutationRouteInputDirect,
  deploymentInternalRouteErrorToResponseEffect,
  type DeploymentApiReadRouteInput,
  type DeploymentApiMutationRouteInput,
  routeDeploymentDurableObject,
  runDeploymentDurableObjectRoute,
} from "../src/deployment/InternalRouteBoundary";
import {
  DeploymentActiveDeploymentNotFoundError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentValidationError,
} from "../src/deployment/Errors";
import { DeploymentService, type DeploymentServiceApi } from "../src/deployment/Service";
import type {
  ActiveDeploymentStatus,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  PushStatus,
} from "../src/types";

async function decodeActiveDeploymentStatusForTest(value: unknown) {
  return await Effect.runPromise(decodeActiveDeploymentStatusEffect(value));
}

async function decodeAnalyzedStartPushRequestForTest(value: unknown) {
  return await Effect.runPromise(decodeAnalyzedStartPushRequestEffect(value));
}

async function decodeDeploymentErrorResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeDeploymentErrorResponseEffect(value));
}

async function decodeFinishPushResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeFinishPushResponseEffect(value));
}

async function decodePushStatusForTest(value: unknown) {
  return await Effect.runPromise(decodePushStatusEffect(value));
}

describe("deployment HttpApi route boundary", () => {
  it("decodes DeploymentDO API routes to typed route inputs", async () => {
    const health = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.health,
      { method: "GET" },
    )));
    expect(health).toMatchObject({ _tag: "DeploymentApiHealthRoute" });
    if (health?._tag !== "DeploymentApiHealthRoute") {
      throw new Error("Expected health route input.");
    }
    expect(health.request.url).toBe(`https://deployment.test${DeploymentRoute.health}`);

    const active = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.activeDeployment,
      { method: "GET" },
    )));
    expect(active).toMatchObject({ _tag: "DeploymentApiActiveDeploymentRoute" });
    if (active?._tag !== "DeploymentApiActiveDeploymentRoute") {
      throw new Error("Expected active deployment route input.");
    }
    expect(active.request.url).toBe(`https://deployment.test${DeploymentRoute.activeDeployment}`);

    const readPush = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-read-typed`,
      { method: "GET" },
    )));
    expect(readPush).toMatchObject({
      _tag: "DeploymentApiGetPushRoute",
      pushId: "push-read-typed",
    });
    if (readPush?._tag !== "DeploymentApiGetPushRoute") {
      throw new Error("Expected get-push route input.");
    }
    expect(readPush.request.url).toBe(`https://deployment.test${DeploymentRoute.push}/push-read-typed`);

    const start = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body: {
          sourcePackage: sourcePackage(),
          analysis: { schema: {}, functions: {} },
          diagnostics: [{ level: "warn", message: "typed route input" }],
        },
      },
    )));
    expect(start).toMatchObject({
      _tag: "DeploymentApiStartAnalyzedPushRoute",
      body: {
        sourcePackage: sourcePackage(),
        diagnostics: [{ level: "warn", message: "typed route input" }],
      },
    });
    if (start?._tag !== "DeploymentApiStartAnalyzedPushRoute") {
      throw new Error("Expected analyzed start route input.");
    }
    expect(start.body).toMatchObject({
      sourcePackage: sourcePackage(),
      diagnostics: [{ level: "warn", message: "typed route input" }],
    });

    const finish = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-finish-typed/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: true },
      },
    )));
    expect(finish).toMatchObject({
      _tag: "DeploymentApiFinishPushRoute",
      pushId: "push-finish-typed",
      body: { activate: true },
    });

    const abandon = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-abandon-typed/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: "typed route abandon" },
      },
    )));
    expect(abandon).toMatchObject({
      _tag: "DeploymentApiAbandonPushRoute",
      pushId: "push-abandon-typed",
      body: { reason: "typed route abandon" },
    });
  });

  it("canonicalizes analyzed start-push requests through Effect decoders", async () => {
    const body = {
      sourcePackage: sourcePackage(),
      analysis: { schema: {}, functions: {} },
      diagnostics: [{ level: "warn", message: "generated warning" }],
    };
    const startRouteInput = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body,
      },
    )));
    if (startRouteInput?._tag !== "DeploymentApiStartAnalyzedPushRoute") {
      throw new Error("Expected analyzed start route input.");
    }
    expect(await decodeAnalyzedStartPushRequestForTest(startRouteInput.body)).toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
    await expect(Effect.runPromise(
      decodeDeploymentAnalyzedStartPushRouteRequest(jsonRequest(DeploymentRoute.startAnalyzedPush, {
        method: "POST",
        body,
      })),
    )).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushRoutePayload(body))).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
  });

  it("canonicalizes finish and abandon mutation requests through Effect decoders", async () => {
    const finish = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-finish/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: true },
      },
    )));
    if (finish?._tag !== "DeploymentApiFinishPushRoute") {
      throw new Error("Expected finish route input.");
    }
    expect(finish.body).toEqual({ activate: true });
    const effectFinish = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-finish-effect-request/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: true },
      },
    )));
    if (effectFinish?._tag !== "DeploymentApiFinishPushRoute") {
      throw new Error("Expected finish route input.");
    }
    expect(effectFinish.body).toEqual({ activate: true });

    await expect(Effect.runPromise(
      decodeDeploymentFinishPushRouteRequest(jsonRequest(
        `${DeploymentRoute.push}/push-finish-effect/${DeploymentPushAction.finish}`,
        {
          method: "POST",
          body: { activate: true },
        },
      )),
    )).resolves.toEqual({ activate: true });
    await expect(Effect.runPromise(decodeDeploymentFinishPushRoutePayload({
      activate: false,
    }))).resolves.toEqual({ activate: false });

    const abandon = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-abandon/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: "generated output failed" },
      },
    )));
    if (abandon?._tag !== "DeploymentApiAbandonPushRoute") {
      throw new Error("Expected abandon route input.");
    }
    expect(abandon.body).toEqual({ reason: "generated output failed" });
    const effectAbandon = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-abandon-effect-request/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: "generated output failed" },
      },
    )));
    if (effectAbandon?._tag !== "DeploymentApiAbandonPushRoute") {
      throw new Error("Expected abandon route input.");
    }
    expect(effectAbandon.body).toEqual({ reason: "generated output failed" });

    await expect(Effect.runPromise(
      decodeDeploymentAbandonPushRouteRequest(jsonRequest(
        `${DeploymentRoute.push}/push-abandon-effect/${DeploymentPushAction.abandon}`,
        {
          method: "POST",
          body: { reason: "effect parsed reason" },
        },
      )),
    )).resolves.toEqual({ reason: "effect parsed reason" });
    await expect(Effect.runPromise(decodeDeploymentAbandonPushRoutePayload({
      reason: "effect parser reason",
    }))).resolves.toEqual({ reason: "effect parser reason" });
  });

  it("keeps route decoder failures typed before generated handler routing", async () => {
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushRouteRequest(jsonRequest(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushRouteRequest(jsonRequest(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body: { sourcePackage: 123 },
      },
    )))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body: { sourcePackage: 123 },
      },
    )))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushRoutePayload({
      sourcePackage: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(Effect.runPromise(decodeDeploymentFinishPushRouteRequest(jsonRequest(
      `${DeploymentRoute.push}/push-finish-effect-malformed/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-finish-effect-request-malformed/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);

    await expect(Effect.runPromise(decodeDeploymentFinishPushRouteRequest(jsonRequest(
      `${DeploymentRoute.push}/push-finish-effect-invalid/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: "yes" },
      },
    )))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-finish-effect-request-invalid/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: "yes" },
      },
    )))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeDeploymentFinishPushRoutePayload({
      activate: "yes",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(Effect.runPromise(decodeDeploymentAbandonPushRouteRequest(jsonRequest(
      `${DeploymentRoute.push}/push-abandon-effect-malformed/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodeDeploymentAbandonPushRouteRequest(jsonRequest(
      `${DeploymentRoute.push}/push-abandon-effect-invalid/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: 123 },
      },
    )))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      `${DeploymentRoute.push}/push-abandon-effect-request-invalid/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: 123 },
      },
    )))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeDeploymentAbandonPushRoutePayload({
      reason: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("maps Deployment route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    await expect(Effect.runPromise(Effect.flip(
      deploymentRouteErrorToHttpErrorEffect(jsonError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new DeploymentProtocolValidationError({
      schema: "FinishPushRequest",
      message: "Finish push activate flag must be a boolean.",
      cause: null,
    });
    await expect(Effect.runPromise(Effect.flip(
      deploymentRouteErrorToHttpErrorEffect(protocolError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Finish push activate flag must be a boolean.",
    });
  });

  it("leaves non-API routes and fallback health methods on DeploymentDO", async () => {
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest("/not-found", {
      method: "GET",
    })))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(DeploymentRoute.health, {
      method: "POST",
      body: {},
    })))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(`${DeploymentRoute.push}/push-read`, {
      method: "POST",
      body: {},
    })))).resolves.toBeNull();
  });

  it("maps DeploymentDO adapter route failures at one Effect edge", async () => {
    const malformed = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.startAnalyzedPush, {
        method: "POST",
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const invalid = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.startAnalyzedPush, {
        method: "POST",
        body: { sourcePackage: 123 },
      }),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "A push without analysis must include an error message.",
    });

    const health = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.health, {
        method: "POST",
      }),
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });

    const notFound = await runDeploymentRoute(
      jsonRequest("/not-found", {
        method: "GET",
      }),
    );
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: "Not found.",
    });
  });

  it("routes DeploymentDO read and mutation inputs directly", async () => {
    const health = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.health, {
        method: "GET",
      }),
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });

    const active = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.activeDeployment, {
        method: "GET",
      }),
      deploymentTestService({
        getActiveDeployment: () => Effect.succeed(activeDeploymentStatus()),
      }),
    );
    expect(active.status).toBe(200);
    expect(await decodeActiveDeploymentStatusForTest(await active.json())).toMatchObject({
      activePushId: "active-push",
      schemaVersion: 0,
    });

    const readPush = await runDeploymentRoute(
      jsonRequest(`${DeploymentRoute.push}/push-direct-read`, {
        method: "GET",
      }),
      deploymentTestService({
        getPush: pushId => Effect.succeed(pushStatus(pushId)),
      }),
    );
    expect(readPush.status).toBe(200);
    expect(await decodePushStatusForTest(await readPush.json())).toMatchObject({
      pushId: "push-direct-read",
      state: "analyzed",
    });

    const missingActive = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.activeDeployment, {
        method: "GET",
      }),
      deploymentTestService({
        getActiveDeployment: () => Effect.fail(new DeploymentActiveDeploymentNotFoundError()),
      }),
    );
    expect(missingActive.status).toBe(404);
    expect(await decodeDeploymentErrorResponseForTest(await missingActive.json())).toEqual({
      error: "No active deployment.",
    });

    const missingPush = await runDeploymentRoute(
      jsonRequest(`${DeploymentRoute.push}/push-direct-missing`, {
        method: "GET",
      }),
      deploymentTestService({
        getPush: pushId => Effect.fail(new DeploymentPushNotFoundError({ pushId })),
      }),
    );
    expect(missingPush.status).toBe(404);
    expect(await decodeDeploymentErrorResponseForTest(await missingPush.json())).toEqual({
      error: "Unknown push: push-direct-missing",
    });

    const storageFailure = await runDeploymentRoute(
      jsonRequest(`${DeploymentRoute.push}/push-direct-storage-failed`, {
        method: "GET",
      }),
      deploymentTestService({
        getPush: () => Effect.fail(new DeploymentValidationError({
          message: "Stored push is invalid.",
        })),
      }),
    );
    expect(storageFailure.status).toBe(500);
    expect(await decodeDeploymentErrorResponseForTest(await storageFailure.json())).toEqual({
      error: "Deployment storage error.",
    });

    const start = await runDeploymentRoute(
      jsonRequest(DeploymentRoute.startAnalyzedPush, {
        method: "POST",
        body: {
          sourcePackage: sourcePackage(),
          analysis: deploymentAnalysis(),
          codegenAnalysis: deploymentCodegenAnalysis(),
          diagnostics: [{ level: "warn", message: "direct route" }],
        },
      }),
      deploymentTestService({
        startAnalyzedPush: () => Effect.succeed(pushStatus("push-direct-route")),
      }),
    );
    expect(start.status).toBe(200);
    await expect(start.json()).resolves.toMatchObject({
      pushId: "push-direct-route",
      state: "analyzed",
    });

    const finish = await runDeploymentRoute(
      jsonRequest(`${DeploymentRoute.push}/push-direct-route/${DeploymentPushAction.finish}`, {
        method: "POST",
        body: {},
      }),
      deploymentTestService({
        finishPush: pushId => Effect.succeed({
          result: "activated",
          push: pushStatus(pushId, "activated"),
        }),
      }),
    );
    expect(finish.status).toBe(200);
    await expect(finish.json()).resolves.toMatchObject({
      result: "activated",
      push: {
        pushId: "push-direct-route",
        state: "activated",
      },
    });

    const abandon = await runDeploymentRoute(
      jsonRequest(`${DeploymentRoute.push}/push-direct-route/${DeploymentPushAction.abandon}`, {
        method: "POST",
        body: { reason: "cancelled" },
      }),
      deploymentTestService({
        abandonPush: (pushId, request) => Effect.succeed({
          ...pushStatus(pushId, "abandoned"),
          error: request.reason ?? "Push abandoned before activation.",
        }),
      }),
    );
    expect(abandon.status).toBe(200);
    await expect(abandon.json()).resolves.toMatchObject({
      pushId: "push-direct-route",
      state: "abandoned",
      error: "cancelled",
    });
  });

  it("dispatches typed DeploymentDO mutation route inputs directly to generated handler effects", async () => {
    const service = deploymentTestService();
    const startRouteInput = await mutationRouteInput(
      DeploymentRoute.startAnalyzedPush,
      {
        method: "POST",
        body: {
          sourcePackage: sourcePackage(),
          analysis: deploymentAnalysis(),
          codegenAnalysis: deploymentCodegenAnalysis(),
          diagnostics: [{ level: "warn", message: "direct dispatch" }],
        },
      },
      "DeploymentApiStartAnalyzedPushRoute",
    );
    const startResponse = await Effect.runPromise(dispatchDeploymentApiMutationRouteInputDirect(
      startRouteInput,
      service,
    ));
    expect(startResponse.status).toBe(200);
    await expect(startResponse.json()).resolves.toMatchObject({
      pushId: "generated-push",
      state: "analyzed",
    });

    const rejectedFinishRouteInput = await mutationRouteInput(
      `${DeploymentRoute.push}/push-direct-rejected/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: {},
      },
      "DeploymentApiFinishPushRoute",
    );
    const rejectedFinishResponse = await Effect.runPromise(dispatchDeploymentApiMutationRouteInputDirect(
      rejectedFinishRouteInput,
      deploymentTestService({
        finishPush: pushId => Effect.succeed({
          result: "rejected",
          push: pushStatus(pushId, "failed"),
          code: "invalid_state",
          error: `Cannot finish push ${pushId} in state failed.`,
        }),
      }),
    ));
    expect(rejectedFinishResponse.status).toBe(409);
    const rejectedFinishBody: unknown = await rejectedFinishResponse.json();
    expect(await decodeFinishPushResponseForTest(rejectedFinishBody)).toMatchObject({
      result: "rejected",
      code: "invalid_state",
      error: "Cannot finish push push-direct-rejected in state failed.",
      push: {
        pushId: "push-direct-rejected",
        state: "failed",
      },
    });

    const activeAbandonRouteInput = await mutationRouteInput(
      `${DeploymentRoute.push}/push-direct-active/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: {},
      },
      "DeploymentApiAbandonPushRoute",
    );
    const activeAbandonResponse = await Effect.runPromise(dispatchDeploymentApiMutationRouteInputDirect(
      activeAbandonRouteInput,
      deploymentTestService({
        abandonPush: pushId => Effect.fail(new DeploymentPushInvalidStateError({
          action: "abandon",
          pushId,
          state: "activated",
        })),
      }),
    ));
    expect(activeAbandonResponse.status).toBe(409);
    const activeAbandonBody: unknown = await activeAbandonResponse.json();
    expect(await decodeDeploymentErrorResponseForTest(activeAbandonBody)).toEqual({
      error: "Cannot abandon push push-direct-active in state activated.",
    });
  });

  it("dispatches typed DeploymentDO read route inputs directly to generated handler effects", async () => {
    const service = deploymentTestService({
      getActiveDeployment: () => Effect.succeed(activeDeploymentStatus()),
      getPush: pushId => Effect.succeed(pushStatus(pushId)),
    });
    const healthRouteInput = await readRouteInput(
      DeploymentRoute.health,
      { method: "GET" },
      "DeploymentApiHealthRoute",
    );
    const healthResponse = await Effect.runPromise(dispatchDeploymentApiReadRouteInputDirect(
      healthRouteInput,
      service,
    ));
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });

    const activeRouteInput = await readRouteInput(
      DeploymentRoute.activeDeployment,
      { method: "GET" },
      "DeploymentApiActiveDeploymentRoute",
    );
    const activeResponse = await Effect.runPromise(dispatchDeploymentApiReadRouteInputDirect(
      activeRouteInput,
      service,
    ));
    expect(activeResponse.status).toBe(200);
    expect(await decodeActiveDeploymentStatusForTest(await activeResponse.json())).toMatchObject({
      activePushId: "active-push",
      schemaVersion: 0,
    });

    const pushRouteInput = await readRouteInput(
      `${DeploymentRoute.push}/push-direct-read-input`,
      { method: "GET" },
      "DeploymentApiGetPushRoute",
    );
    const pushResponse = await Effect.runPromise(dispatchDeploymentApiReadRouteInputDirect(
      pushRouteInput,
      service,
    ));
    expect(pushResponse.status).toBe(200);
    expect(await decodePushStatusForTest(await pushResponse.json())).toMatchObject({
      pushId: "push-direct-read-input",
      state: "analyzed",
    });

    const missingPushResponse = await Effect.runPromise(dispatchDeploymentApiReadRouteInputDirect(
      pushRouteInput,
      deploymentTestService({
        getPush: pushId => Effect.fail(new DeploymentPushNotFoundError({ pushId })),
      }),
    ));
    expect(missingPushResponse.status).toBe(404);
    expect(await decodeDeploymentErrorResponseForTest(await missingPushResponse.json())).toEqual({
      error: "Unknown push: push-direct-read-input",
    });
  });

  it("maps DeploymentDO route failures through a named response adapter effect", async () => {
    const protocolResponse = await Effect.runPromise(deploymentInternalRouteErrorToResponseEffect(
      new DeploymentProtocolValidationError({
        schema: "DeploymentGeneratedResponse",
        message: "Generated deployment response failed validation.",
        cause: null,
      }),
    ));
    expect(protocolResponse.status).toBe(400);
    await expect(protocolResponse.json()).resolves.toEqual({
      error: "Generated deployment response failed validation.",
    });
  });
});

interface RequestOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
}

function jsonRequest(path: string, options: RequestOptions): Request {
  return new Request(`https://deployment.test${path}`, {
    method: options.method,
    headers: { "content-type": "application/json" },
    ...(options.body === undefined
      ? {}
      : { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }),
  });
}

function runDeploymentRoute(
  request: Request,
  service: DeploymentServiceApi = deploymentTestService(),
): Promise<Response> {
  return runDeploymentDurableObjectRoute(
    routeDeploymentDurableObject(request).pipe(
      Effect.provideService(DeploymentService, DeploymentService.of(service)),
    ),
  );
}

function sourcePackage() {
  return {
    modules: [{
      path: "__execution.ts",
      environment: "isolate" as const,
      sha256: "a".repeat(64),
    }],
    functions: [],
    execution: "__execution.ts",
  };
}

type MutationRouteInputTag =
  | "DeploymentApiStartAnalyzedPushRoute"
  | "DeploymentApiFinishPushRoute"
  | "DeploymentApiAbandonPushRoute";

type ReadRouteInputTag =
  | "DeploymentApiHealthRoute"
  | "DeploymentApiActiveDeploymentRoute"
  | "DeploymentApiGetPushRoute";

async function mutationRouteInput<Tag extends MutationRouteInputTag>(
  path: string,
  options: RequestOptions,
  tag: Tag,
): Promise<DeploymentApiMutationRouteInput> {
  const routeInput = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(path, options)));
  if (routeInput?._tag !== tag) {
    throw new Error(`Expected ${tag}.`);
  }
  return routeInput;
}

async function readRouteInput<Tag extends ReadRouteInputTag>(
  path: string,
  options: RequestOptions,
  tag: Tag,
): Promise<DeploymentApiReadRouteInput> {
  const routeInput = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(path, options)));
  if (routeInput?._tag !== tag) {
    throw new Error(`Expected ${tag}.`);
  }
  return routeInput;
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

function activeDeploymentStatus(): ActiveDeploymentStatus {
  return {
    activePushId: "active-push",
    activatedAt: 3,
    schemaVersion: 0,
    executionArtifactRef: {
      runtime: "dynamic-worker",
      artifactId: "artifact-active",
      sourcePackageHash: "b".repeat(64),
      executionModule: "__execution.ts",
    },
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
  };
}

function deploymentAnalysis(): DeploymentAnalysis {
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

function deploymentCodegenAnalysis(): DeploymentCodegenAnalysis {
  return {
    schema: {
      version: 0,
      tables: [],
      indexes: [],
    },
    functions: [],
  };
}
