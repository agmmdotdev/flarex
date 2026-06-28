import { describe, expect, it } from "vitest";
import { ProtocolValidationError, RegistryRoute } from "flarex-protocol/registry";
import { HttpError } from "../src/http";
import {
  parseRegistryCreateDeploymentRouteRequest,
  readRegistryCreateDeploymentRouteRequest,
  registryApiRequestForRoute,
} from "../src/registry/HttpApiRouteBoundary";

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

    expect(apiRequest).not.toBeNull();
    expect(apiRequest?.method).toBe("POST");
    expect(apiRequest?.headers.get("content-type")).toBe("application/json");
    await expect(apiRequest?.json()).resolves.toEqual({
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
    expect(parseRegistryCreateDeploymentRouteRequest({
      deploymentId: "deployment-c",
      slug: "slug-c",
    })).toEqual({
      deploymentId: "deployment-c",
      slug: "slug-c",
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

    await expect(
      registryApiRequestForRoute(new Request(`https://registry.test${RegistryRoute.deployments}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId: 123 }),
      })),
    ).rejects.toBeInstanceOf(ProtocolValidationError);
  });

  it("leaves fallback routes on the existing plain RegistryDO responses", async () => {
    await expect(registryApiRequestForRoute(new Request(
      `https://registry.test${RegistryRoute.health}`,
      { method: "POST" },
    ))).resolves.toBeNull();
    await expect(registryApiRequestForRoute(new Request(
      "https://registry.test/not-found",
    ))).resolves.toBeNull();
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
}
