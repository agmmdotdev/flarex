import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeDeploymentRecordEffect,
  decodeListDeploymentsResponseEffect,
  decodeRegistryHealthResponseEffect,
  decodeRegistryStorageErrorResponseEffect,
  ProtocolValidationError,
  RegistryRoute,
} from "flarex-protocol/registry";
import { RequestJsonError } from "../src/http";
import {
  decodeRegistryApiRouteInput,
  decodeRegistryCreateDeploymentRouteRequest,
  registryRouteErrorToHttpErrorEffect,
} from "../src/registry/HttpApiRouteBoundary";
import {
  dispatchRegistryApiRouteInputDirect,
  registryInternalRouteErrorToResponseEffect,
  routeRegistryDurableObject,
  runRegistryDurableObjectRoute,
} from "../src/registry/InternalRouteBoundary";
import { RegistryService, type RegistryServiceApi } from "../src/registry/Service";
import { RegistrySqlError } from "../src/registry/Store";

async function decodeDeploymentRecordForTest(value: unknown) {
  return await Effect.runPromise(decodeDeploymentRecordEffect(value));
}

async function decodeListDeploymentsResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeListDeploymentsResponseEffect(value));
}

async function decodeRegistryHealthResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeRegistryHealthResponseEffect(value));
}

async function decodeRegistryStorageErrorResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeRegistryStorageErrorResponseEffect(value));
}

describe("registry HttpApi route boundary", () => {
  it("decodes registry read routes into typed route inputs", async () => {
    const healthRequest = new Request(`https://registry.test${RegistryRoute.health}`);
    const deploymentsRequest = new Request(`https://registry.test${RegistryRoute.deployments}`);

    await expect(Effect.runPromise(decodeRegistryApiRouteInput(healthRequest))).resolves.toEqual({
      _tag: "RegistryApiHealthRoute",
      request: healthRequest,
    });
    await expect(Effect.runPromise(decodeRegistryApiRouteInput(deploymentsRequest))).resolves.toEqual({
      _tag: "RegistryApiListDeploymentsRoute",
      request: deploymentsRequest,
    });
  });

  it("decodes create deployment bodies into typed direct-dispatch inputs", async () => {
    const request = jsonRequest({
      deploymentId: "deployment-a",
      slug: "slug-a",
    });

    await expect(Effect.runPromise(decodeRegistryApiRouteInput(request))).resolves.toMatchObject({
      _tag: "RegistryApiCreateDeploymentRoute",
      body: {
        deploymentId: "deployment-a",
        slug: "slug-a",
      },
    });

    await expect(Effect.runPromise(
      decodeRegistryCreateDeploymentRouteRequest(jsonRequest({
        deploymentId: "deployment-b",
      })),
    )).resolves.toEqual({
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
    await expect(Effect.runPromise(decodeRegistryCreateDeploymentRouteRequest(new Request(
      `https://registry.test${RegistryRoute.deployments}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodeRegistryApiRouteInput(new Request(
      `https://registry.test${RegistryRoute.deployments}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);

    await expect(Effect.runPromise(decodeRegistryCreateDeploymentRouteRequest(jsonRequest({
      deploymentId: 123,
    })))).rejects.toBeInstanceOf(ProtocolValidationError);
    await expect(Effect.runPromise(decodeRegistryApiRouteInput(jsonRequest({
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
    await expect(Effect.runPromise(decodeRegistryApiRouteInput(new Request(
      `https://registry.test${RegistryRoute.health}`,
      { method: "POST" },
    )))).resolves.toBeNull();
    await expect(Effect.runPromise(decodeRegistryApiRouteInput(new Request(
      "https://registry.test/not-found",
    )))).resolves.toBeNull();
  });

  it("dispatches Registry route inputs directly without a generated request bridge", async () => {
    const registry = registryService({
      createDeployment: request =>
        Effect.succeed({
          deploymentId: request.deploymentId ?? "generated-deployment",
          ...(request.slug === undefined ? {} : { slug: request.slug }),
          createdAt: 1,
          updatedAt: 1,
          schemaVersion: 0,
        }),
      listDeployments: () =>
        Effect.succeed({
          deployments: [{
            deploymentId: "listed-deployment",
            slug: "listed-slug",
            createdAt: 2,
            updatedAt: 2,
            schemaVersion: 0,
          }],
        }),
    });

    const health = await Effect.runPromise(dispatchRegistryApiRouteInputDirect({
      _tag: "RegistryApiHealthRoute",
      request: new Request(`https://registry.test${RegistryRoute.health}`),
    }, registry));
    expect(health.status).toBe(200);
    expect(await decodeRegistryHealthResponseForTest(await health.json())).toEqual({
      service: "flarex-registry",
      status: "ok",
    });

    const listed = await Effect.runPromise(dispatchRegistryApiRouteInputDirect({
      _tag: "RegistryApiListDeploymentsRoute",
      request: new Request(`https://registry.test${RegistryRoute.deployments}`),
    }, registry));
    expect(listed.status).toBe(200);
    expect(await decodeListDeploymentsResponseForTest(await listed.json())).toEqual({
      deployments: [{
        deploymentId: "listed-deployment",
        slug: "listed-slug",
        createdAt: 2,
        updatedAt: 2,
        schemaVersion: 0,
      }],
    });

    const created = await Effect.runPromise(dispatchRegistryApiRouteInputDirect({
      _tag: "RegistryApiCreateDeploymentRoute",
      url: new URL(`https://registry.test${RegistryRoute.deployments}`),
      body: {
        deploymentId: "created-deployment",
        slug: "created-slug",
      },
    }, registry));
    expect(created.status).toBe(200);
    expect(await decodeDeploymentRecordForTest(await created.json())).toEqual({
      deploymentId: "created-deployment",
      slug: "created-slug",
      createdAt: 1,
      updatedAt: 1,
      schemaVersion: 0,
    });
  });

  it("maps direct registry storage failures to the generated error response shape", async () => {
    const registry = registryService({
      createDeployment: () =>
        Effect.fail(new RegistrySqlError({
          operation: "createDeployment",
          cause: new Error("insert failed"),
        })),
      listDeployments: () =>
        Effect.fail(new RegistrySqlError({
          operation: "listDeployments",
          cause: new Error("list failed"),
        })),
    });

    const listed = await Effect.runPromise(dispatchRegistryApiRouteInputDirect({
      _tag: "RegistryApiListDeploymentsRoute",
      request: new Request(`https://registry.test${RegistryRoute.deployments}`),
    }, registry));
    expect(listed.status).toBe(500);
    expect(await decodeRegistryStorageErrorResponseForTest(await listed.json())).toEqual({
      error: "Registry storage error.",
    });

    const created = await Effect.runPromise(dispatchRegistryApiRouteInputDirect({
      _tag: "RegistryApiCreateDeploymentRoute",
      url: new URL(`https://registry.test${RegistryRoute.deployments}`),
      body: {
        deploymentId: "create-failure",
      },
    }, registry));
    expect(created.status).toBe(500);
    expect(await decodeRegistryStorageErrorResponseForTest(await created.json())).toEqual({
      error: "Registry storage error.",
    });
  });

  it("maps RegistryDO adapter route failures at one Effect edge", async () => {
    const registry = registryService({
      createDeployment: request =>
        Effect.succeed({
          deploymentId: request.deploymentId ?? "generated-deployment",
          ...(request.slug === undefined ? {} : { slug: request.slug }),
          createdAt: 1,
          updatedAt: 1,
          schemaVersion: 0,
        }),
      listDeployments: () => Effect.succeed({ deployments: [] }),
    });

    const malformed = await runRegistryRoute(new Request(`https://registry.test${RegistryRoute.deployments}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), registry);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const invalid = await runRegistryRoute(jsonRequest({ deploymentId: 123 }), registry);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Create deployment request must include optional string deploymentId and slug fields.",
    });

    const health = await runRegistryRoute(new Request(`https://registry.test${RegistryRoute.health}`, {
      method: "POST",
    }), registry);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      service: "flarex-registry",
      status: "ok",
    });

    const notFound = await runRegistryRoute(new Request("https://registry.test/not-found"), registry);
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
  });
});

function jsonRequest(body: unknown): Request {
  return new Request(`https://registry.test${RegistryRoute.deployments}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function runRegistryRoute(
  request: Request,
  registry: RegistryServiceApi,
): Promise<Response> {
  return runRegistryDurableObjectRoute(
    routeRegistryDurableObject(request).pipe(
      Effect.provideService(RegistryService, RegistryService.of(registry)),
    ),
  );
}

function registryService(overrides: {
  readonly createDeployment?: RegistryServiceApi["createDeployment"];
  readonly listDeployments?: RegistryServiceApi["listDeployments"];
}): RegistryServiceApi {
  return {
    createDeployment: overrides.createDeployment
      ?? (() =>
        Effect.succeed({
          deploymentId: "default-deployment",
          createdAt: 1,
          updatedAt: 1,
          schemaVersion: 0,
        })),
    listDeployments: overrides.listDeployments
      ?? (() => Effect.succeed({ deployments: [] })),
  };
}
