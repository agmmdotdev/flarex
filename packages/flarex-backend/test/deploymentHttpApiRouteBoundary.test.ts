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
  decodeDeploymentApiRequestForRoute,
  decodeDeploymentAnalyzedStartPushRouteRequest,
  decodeDeploymentAnalyzedStartPushRoutePayload,
  decodeDeploymentAbandonPushRouteRequest,
  decodeDeploymentAbandonPushRoutePayload,
  decodeDeploymentFinishPushRouteRequest,
  decodeDeploymentFinishPushRoutePayload,
  deploymentApiRequestForRoute,
  parseDeploymentAnalyzedStartPushRouteRequest,
  parseDeploymentAnalyzedStartPushRouteRequestEffect,
  parseDeploymentAbandonPushRouteRequest,
  parseDeploymentAbandonPushRouteRequestEffect,
  parseDeploymentFinishPushRouteRequest,
  parseDeploymentFinishPushRouteRequestEffect,
  readDeploymentAnalyzedStartPushRouteRequest,
  readDeploymentAbandonPushRouteRequest,
  readDeploymentFinishPushRouteRequest,
} from "../src/deployment/HttpApiRouteBoundary";
import {
  routeDeploymentDurableObject,
  runDeploymentDurableObjectRoute,
} from "../src/deployment/InternalRouteBoundary";

describe("deploymentApiRequestForRoute", () => {
  it("forwards all read routes to the generated DeploymentApi handler", async () => {
    await expectApiRequest(DeploymentRoute.health, { method: "GET" });
    await expectApiRequest(DeploymentRoute.activeDeployment, { method: "GET" });
    await expectApiRequest(`${DeploymentRoute.push}/push-read`, { method: "GET" });
  });

  it("canonicalizes analyzed start-push requests after compatibility parsing", async () => {
    const body = {
      sourcePackage: sourcePackage(),
      analysis: { schema: {}, functions: {} },
      diagnostics: [{ level: "warn", message: "generated warning" }],
    };
    const apiRequest = await expectApiRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body,
    });
    const effectApiRequest = await expectEffectApiRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body,
    });

    const parsedBody: unknown = await apiRequest.json();
    expect(parseAnalyzedStartPushRequest(parsedBody)).toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
    await expect(effectApiRequest.json()).resolves.toMatchObject({
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
    await expect(readDeploymentAnalyzedStartPushRouteRequest(jsonRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body,
    }))).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
    expect(parseDeploymentAnalyzedStartPushRouteRequest(body)).toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
    await expect(Effect.runPromise(decodeDeploymentAnalyzedStartPushRoutePayload(body))).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
    await expect(Effect.runPromise(parseDeploymentAnalyzedStartPushRouteRequestEffect(body))).resolves.toMatchObject({
      sourcePackage: sourcePackage(),
      analysis: body.analysis,
      diagnostics: body.diagnostics,
    });
  });

  it("canonicalizes finish and abandon mutation requests after compatibility parsing", async () => {
    const finish = await expectApiRequest(
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
    await expect(
      readDeploymentFinishPushRouteRequest(jsonRequest(
        `${DeploymentRoute.push}/push-finish-helper/${DeploymentPushAction.finish}`,
        {
          method: "POST",
          body: { activate: false },
        },
      )),
    ).resolves.toEqual({ activate: false });
    expect(parseDeploymentFinishPushRouteRequest({
      activate: true,
    })).toEqual({ activate: true });
    await expect(Effect.runPromise(decodeDeploymentFinishPushRoutePayload({
      activate: false,
    }))).resolves.toEqual({ activate: false });
    await expect(Effect.runPromise(parseDeploymentFinishPushRouteRequestEffect({
      activate: false,
    }))).resolves.toEqual({ activate: false });

    const abandon = await expectApiRequest(
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
    await expect(
      readDeploymentAbandonPushRouteRequest(jsonRequest(
        `${DeploymentRoute.push}/push-abandon-helper/${DeploymentPushAction.abandon}`,
        {
          method: "POST",
          body: { reason: "helper parsed reason" },
        },
      )),
    ).resolves.toEqual({ reason: "helper parsed reason" });
    expect(parseDeploymentAbandonPushRouteRequest({
      reason: "pure parser reason",
    })).toEqual({ reason: "pure parser reason" });
    await expect(Effect.runPromise(decodeDeploymentAbandonPushRoutePayload({
      reason: "effect parser reason",
    }))).resolves.toEqual({ reason: "effect parser reason" });
    await expect(Effect.runPromise(parseDeploymentAbandonPushRouteRequestEffect({
      reason: "effect parser reason",
    }))).resolves.toEqual({ reason: "effect parser reason" });
  });

  it("maps compatibility parser failures before generated handler routing", async () => {
    await expect(deploymentApiRequestForRoute(jsonRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
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
    await expect(deploymentApiRequestForRoute(jsonRequest(DeploymentRoute.startAnalyzedPush, {
      method: "POST",
      body: { sourcePackage: 123 },
    }))).rejects.toMatchObject({
      status: 400,
      message: "A push without analysis must include an error message.",
    });
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
    await expect(Effect.runPromise(parseDeploymentAnalyzedStartPushRouteRequestEffect({
      sourcePackage: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(deploymentApiRequestForRoute(jsonRequest(
      `${DeploymentRoute.push}/push-finish-malformed/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
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

    await expect(deploymentApiRequestForRoute(jsonRequest(
      `${DeploymentRoute.push}/push-finish/${DeploymentPushAction.finish}`,
      {
        method: "POST",
        body: { activate: "yes" },
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Finish push activate flag must be a boolean.",
    });
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
    await expect(Effect.runPromise(parseDeploymentFinishPushRouteRequestEffect({
      activate: "yes",
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);

    await expect(deploymentApiRequestForRoute(jsonRequest(
      `${DeploymentRoute.push}/push-abandon/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: { reason: 123 },
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Abandon push reason must be a string.",
    });
    await expect(deploymentApiRequestForRoute(jsonRequest(
      `${DeploymentRoute.push}/push-abandon-malformed/${DeploymentPushAction.abandon}`,
      {
        method: "POST",
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
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
    await expect(Effect.runPromise(parseDeploymentAbandonPushRouteRequestEffect({
      reason: 123,
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("leaves non-API routes and fallback health methods on DeploymentDO", async () => {
    await expect(deploymentApiRequestForRoute(jsonRequest(DeploymentRoute.health, {
      method: "POST",
      body: {},
    }))).resolves.toBeNull();
    await expect(deploymentApiRequestForRoute(jsonRequest(`${DeploymentRoute.push}/push-read`, {
      method: "POST",
      body: {},
    }))).resolves.toBeNull();
    await expect(deploymentApiRequestForRoute(jsonRequest("/not-found", {
      method: "GET",
    }))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeDeploymentApiRequestForRoute(jsonRequest("/not-found", {
      method: "GET",
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
});

interface RequestOptions {
  readonly method: "GET" | "POST";
  readonly body?: unknown;
}

async function expectApiRequest(path: string, options: RequestOptions): Promise<Request> {
  const apiRequest = await deploymentApiRequestForRoute(jsonRequest(path, options));
  if (apiRequest === null) {
    throw new Error(`Expected ${options.method} ${path} to route to DeploymentApi.`);
  }
  expect(apiRequest.url).toBe(`https://deployment.test${path}`);
  expect(apiRequest.method).toBe(options.method);
  return apiRequest;
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
