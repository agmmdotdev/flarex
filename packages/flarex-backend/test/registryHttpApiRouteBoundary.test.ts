import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ProtocolValidationError, RegistryRoute } from "flarex-protocol/registry";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeRegistryApiRequestForRoute,
  decodeRegistryCreateDeploymentRouteRequest,
  readRegistryCreateDeploymentRouteRequest,
  registryApiRequestForRoute,
  registryRouteErrorToHttpErrorEffect,
} from "../src/registry/HttpApiRouteBoundary";
import {
  registryInternalRouteErrorToResponseEffect,
  RegistryRouteOperationError,
  routeRegistryDurableObject,
  runRegistryDurableObjectRoute,
} from "../src/registry/InternalRouteBoundary";

describe("registry HttpApi route boundary", () => {
  it("forwards registry read routes to the generated handler", async () => {
    await expectRouteForwarded("GET", RegistryRoute.health);
    await expectRouteForwarded("GET", RegistryRoute.deployments);
  });

  it("pre-parses create deployment bodies into canonical generated-handler requests", async () => {
    const request = new Request(`https://registry.test${RegistryRoute.deployments}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deploymentId: "deployment-a", slug: "slug-a" }),
    });

    const apiRequest = await registryApiRequestForRoute(request);
    const effectApiRequest = await Effect.runPromise(decodeRegistryApiRequestForRoute(jsonRequest({
      deploymentId: "deployment-a",
      slug: "slug-a",
    })));

    expect(apiRequest).not.toBeNull();
    expect(apiRequest?.method).toBe("POST");
    expect(apiRequest?.headers.get("content-type")).toBe("application/json");
    await expect(apiRequest?.json()).resolves.toEqual({
      deploymentId: "deployment-a",
      slug: "slug-a",
    });
    await expect(effectApiRequest?.json()).resolves.toEqual({
      deploymentId: "deployment-a",
      slug: "slug-a",
    });

    await expect(
      readRegistryCreateDeploymentRouteRequest(jsonRequest({
        deploymentId: "deployment-b",
      })),
    ).resolves.toEqual({
      deploymentId: "deployment-b",
    });
    await expect(Effect.runPromise(
      decodeRegistryCreateDeploymentRouteRequest(jsonRequest({
        deploymentId: "deployment-effect",
        slug: "effect-slug",
      })),
    )).resolves.toEqual({
      deploymentId: "deployment-effect",
      slug: "effect-slug",
    });
  });

  it("keeps malformed JSON and schema failures at the Durable Object boundary", async () => {
    await expect(
      registryApiRequestForRoute(new Request(`https://registry.test${RegistryRoute.deployments}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })),
    ).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    } satisfies Partial<HttpError>);
    await expect(Effect.runPromise(decodeRegistryCreateDeploymentRouteRequest(new Request(
      `https://registry.test${RegistryRoute.deployments}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodeRegistryApiRequestForRoute(new Request(
      `https://registry.test${RegistryRoute.deployments}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);

    await expect(
      registryApiRequestForRoute(new Request(`https://registry.test${RegistryRoute.deployments}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId: 123 }),
      })),
    ).rejects.toBeInstanceOf(ProtocolValidationError);
    await expect(Effect.runPromise(decodeRegistryCreateDeploymentRouteRequest(jsonRequest({
      deploymentId: 123,
    })))).rejects.toBeInstanceOf(ProtocolValidationError);
    await expect(Effect.runPromise(decodeRegistryApiRequestForRoute(jsonRequest({
      deploymentId: 123,
    })))).rejects.toBeInstanceOf(ProtocolValidationError);
  });

  it("maps Registry route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    await expect(Effect.runPromise(Effect.flip(
      registryRouteErrorToHttpErrorEffect(jsonError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new ProtocolValidationError({
      schema: "CreateDeploymentRequest",
      message: "Create deployment request must include optional string deploymentId and slug fields.",
      cause: null,
    });
    await expect(Effect.runPromise(Effect.flip(
      registryRouteErrorToHttpErrorEffect(protocolError),
    ))).resolves.toBe(protocolError);
  });

  it("leaves fallback routes on the existing plain RegistryDO responses", async () => {
    await expect(registryApiRequestForRoute(new Request(
      `https://registry.test${RegistryRoute.health}`,
      { method: "POST" },
    ))).resolves.toBeNull();
    await expect(registryApiRequestForRoute(new Request(
      "https://registry.test/not-found",
    ))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeRegistryApiRequestForRoute(new Request(
      "https://registry.test/not-found",
    )))).resolves.toBeNull();
  });

  it("maps RegistryDO adapter route failures at one Effect edge", async () => {
    const malformed = await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        new Request(`https://registry.test${RegistryRoute.deployments}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const invalid = await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        jsonRequest({ deploymentId: 123 }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Create deployment request must include optional string deploymentId and slug fields.",
    });

    const handlerFailure = await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        new Request(`https://registry.test${RegistryRoute.deployments}`, {
          method: "GET",
        }),
        async () => {
          throw new Error("registry handler failed");
        },
      ),
    );
    expect(handlerFailure.status).toBe(500);
    await expect(handlerFailure.json()).resolves.toEqual({
      error: "registry handler failed",
    });

    const handlerProtocolFailure = await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        new Request(`https://registry.test${RegistryRoute.deployments}`, {
          method: "GET",
        }),
        async () => {
          throw new ProtocolValidationError({
            schema: "RegistryGeneratedResponse",
            message: "Generated registry response failed validation.",
            cause: new Error("invalid generated registry response"),
          });
        },
      ),
    );
    expect(handlerProtocolFailure.status).toBe(400);
    await expect(handlerProtocolFailure.json()).resolves.toEqual({
      error: "Generated registry response failed validation.",
    });

    const health = await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        new Request(`https://registry.test${RegistryRoute.health}`, {
          method: "POST",
        }),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      service: "flarex-registry",
      status: "ok",
    });

    const notFound = await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        new Request("https://registry.test/not-found"),
        async () => Response.json({ ok: true }),
      ),
    );
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({
      error: "Not found.",
    });
  });

  it("maps RegistryDO route failures through a named response adapter effect", async () => {
    const protocolResponse = await Effect.runPromise(registryInternalRouteErrorToResponseEffect(
      new ProtocolValidationError({
        schema: "RegistryGeneratedResponse",
        message: "Generated registry response failed validation.",
        cause: null,
      }),
    ));
    expect(protocolResponse.status).toBe(400);
    await expect(protocolResponse.json()).resolves.toEqual({
      error: "Generated registry response failed validation.",
    });

    const operationResponse = await Effect.runPromise(registryInternalRouteErrorToResponseEffect(
      new RegistryRouteOperationError({
        operation: "http-api",
        status: 503,
        message: "Registry handler unavailable.",
        cause: new Error("Registry handler unavailable."),
      }),
    ));
    expect(operationResponse.status).toBe(503);
    await expect(operationResponse.json()).resolves.toEqual({
      error: "Registry handler unavailable.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request(`https://registry.test${RegistryRoute.deployments}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectRouteForwarded(method: string, pathname: string): Promise<void> {
  const request = new Request(`https://registry.test${pathname}`, { method });

  await expect(registryApiRequestForRoute(request)).resolves.toBe(request);
  await expect(Effect.runPromise(decodeRegistryApiRequestForRoute(request))).resolves.toBe(request);
}
