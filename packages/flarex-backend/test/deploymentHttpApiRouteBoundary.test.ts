import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  DeploymentProtocolValidationError,
  DeploymentPushAction,
  DeploymentRoute,
  parseAnalyzedStartPushRequest,
} from "flarex-protocol/deployment";
import { RequestJsonError } from "../src/http";
import {
  deploymentApiRouteInputToRequest,
  decodeDeploymentApiRequestForRoute,
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
  deploymentInternalRouteErrorToResponseEffect,
  DeploymentRouteOperationError,
  routeDeploymentDurableObject,
  runDeploymentDurableObjectRoute,
} from "../src/deployment/InternalRouteBoundary";

describe("deployment HttpApi route boundary", () => {
  it("forwards all read routes to the generated DeploymentApi handler", async () => {
    await expectEffectApiRequest(DeploymentRoute.health, { method: "GET" });
    await expectEffectApiRequest(DeploymentRoute.activeDeployment, { method: "GET" });
    await expectEffectApiRequest(`${DeploymentRoute.push}/push-read`, { method: "GET" });
  });

  it("decodes DeploymentDO API routes to typed route inputs before request compatibility", async () => {
    const health = await Effect.runPromise(decodeDeploymentApiRouteInput(jsonRequest(
      DeploymentRoute.health,
      { method: "GET" },
    )));
    expect(health).toMatchObject({ _tag: "DeploymentApiReadRoute" });
    if (health?._tag !== "DeploymentApiReadRoute") {
      throw new Error("Expected read route input.");
    }
    expect(deploymentApiRouteInputToRequest(health).url).toBe(
      `https://deployment.test${DeploymentRoute.health}`,
    );

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
    await expect(deploymentApiRouteInputToRequest(start).json()).resolves.toMatchObject({
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
    const apiRequest = await expectEffectApiRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body,
    });

    const parsedBody: unknown = await apiRequest.json();
    expect(parseAnalyzedStartPushRequest(parsedBody)).toMatchObject({
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
    const finish = await expectEffectApiRequest(
      `${DeploymentRoute.push}/push-finish/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: true },
      },
    );
    await expect(finish.json()).resolves.toEqual({ activate: true });
    const effectFinish = await expectEffectApiRequest(
      `${DeploymentRoute.push}/push-finish-effect-request/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: true },
      },
    );
    await expect(effectFinish.json()).resolves.toEqual({ activate: true });

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

    const abandon = await expectEffectApiRequest(
      `${DeploymentRoute.push}/push-abandon/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: "generated output failed" },
      },
    );
    await expect(abandon.json()).resolves.toEqual({ reason: "generated output failed" });
    const effectAbandon = await expectEffectApiRequest(
      `${DeploymentRoute.push}/push-abandon-effect-request/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: "generated output failed" },
      },
    );
    await expect(effectAbandon.json()).resolves.toEqual({ reason: "generated output failed" });

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
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(
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
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(
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
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(
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
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(
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
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(
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
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest("/not-found", {
      method: "GET",
    })))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(DeploymentRoute.health, {
      method: "POST",
      body: {},
    })))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(`${DeploymentRoute.push}/push-read`, {
      method: "POST",
      body: {},
    })))).resolves.toBeNull();
  });

  it("maps DeploymentDO adapter route failures at one Effect edge", async () => {
    const malformed = await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        jsonRequest(DeploymentRoute.startAnalyzedPush, {
          method: "POST",
          body: "{",
        }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const invalid = await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        jsonRequest(DeploymentRoute.startAnalyzedPush, {
          method: "POST",
          body: { sourcePackage: 123 },
        }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "A push without analysis must include an error message.",
    });

    const handlerFailure = await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        jsonRequest(`${DeploymentRoute.push}/push-handler-failure`, {
          method: "GET",
        }),
        async () => {
          throw new Error("deployment handler failed");
        },
      ),
    );
    expect(handlerFailure.status).toBe(500);
    await expect(handlerFailure.json()).resolves.toEqual({
      error: "deployment handler failed",
    });

    const handlerProtocolFailure = await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        jsonRequest(`${DeploymentRoute.push}/push-handler-protocol-failure`, {
          method: "GET",
        }),
        async () => {
          throw new DeploymentProtocolValidationError({
            schema: "DeploymentGeneratedResponse",
            message: "Generated deployment response failed validation.",
            cause: new Error("invalid generated deployment response"),
          });
        },
      ),
    );
    expect(handlerProtocolFailure.status).toBe(400);
    await expect(handlerProtocolFailure.json()).resolves.toEqual({
      error: "Generated deployment response failed validation.",
    });

    const health = await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        jsonRequest(DeploymentRoute.health, {
          method: "POST",
        }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });

    const notFound = await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        jsonRequest("/not-found", {
          method: "GET",
        }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: "Not found.",
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

    const operationResponse = await Effect.runPromise(deploymentInternalRouteErrorToResponseEffect(
      new DeploymentRouteOperationError({
        operation: "http-api",
        status: 503,
        message: "Deployment handler unavailable.",
        cause: new Error("Deployment handler unavailable."),
      }),
    ));
    expect(operationResponse.status).toBe(503);
    await expect(operationResponse.json()).resolves.toEqual({
      error: "Deployment handler unavailable.",
    });
  });
});

interface RequestOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
}

async function expectEffectApiRequest(path: string, options: RequestOptions): Promise<Request> {
  const apiRequest = await Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest(path, options)));
  if (apiRequest === null) {
    throw new Error(`Expected ${options.method} ${path} to route to DeploymentApi.`);
  }
  expect(apiRequest.url).toBe(`https://deployment.test${path}`);
  expect(apiRequest.method).toBe(options.method);
  return apiRequest;
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
