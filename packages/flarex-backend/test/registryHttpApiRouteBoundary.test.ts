import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ProtocolValidationError, RegistryRoute } from "flarex-protocol/registry";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeRegistryApiRequestForRoute,
  decodeRegistryCreateDeploymentRouteRequest,
  parseRegistryCreateDeploymentRouteRequest,
  parseRegistryCreateDeploymentRouteRequestEffect,
  readRegistryCreateDeploymentRouteRequest,
  registryApiRequestForRoute,
} from "../src/registry/HttpApiRouteBoundary";
import {
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
    expect(parseRegistryCreateDeploymentRouteRequest({
      deploymentId: "deployment-c",
      slug: "slug-c",
    })).toEqual({
      deploymentId: "deployment-c",
      slug: "slug-c",
    });
    await expect(Effect.runPromise(parseRegistryCreateDeploymentRouteRequestEffect({
      deploymentId: "deployment-parser-effect",
    }))).resolves.toEqual({
      deploymentId: "deployment-parser-effect",
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
    await expect(Effect.runPromise(parseRegistryCreateDeploymentRouteRequestEffect({
      deploymentId: 123,
    }))).rejects.toBeInstanceOf(ProtocolValidationError);
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
