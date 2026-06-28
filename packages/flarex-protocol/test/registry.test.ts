import { describe, expect, it } from "vitest";
import {
  parseDeploymentRecord,
  parseCreateDeploymentRequest,
  parseRegistryHealthResponse,
  parseRegistryStorageErrorResponse,
  RegistryApi,
  RegistryRoute,
} from "../src/registry";

describe("registry protocol routes", () => {
  it("exports the stable RegistryDO route paths", () => {
    expect(RegistryRoute).toEqual({
      health: "/health",
      deployments: "/deployments",
    });
  });

  it("describes the current RegistryDO routes as an HttpApi contract", () => {
    const group = RegistryApi.groups.registry;

    expect(group.topLevel).toBe(true);
    expect(group.endpoints.health.path).toBe(RegistryRoute.health);
    expect(group.endpoints.health.method).toBe("GET");
    expect(group.endpoints.listDeployments.path).toBe(RegistryRoute.deployments);
    expect(group.endpoints.listDeployments.method).toBe("GET");
    expect(group.endpoints.createDeployment.path).toBe(RegistryRoute.deployments);
    expect(group.endpoints.createDeployment.method).toBe("POST");
  });

  it("parses registry health and deployment bodies used by the HttpApi contract", () => {
    expect(parseRegistryHealthResponse({
      service: "flarex-registry",
      status: "ok",
    })).toEqual({
      service: "flarex-registry",
      status: "ok",
    });

    expect(parseCreateDeploymentRequest({
      deploymentId: "deployment_1",
      slug: "demo",
    })).toEqual({
      deploymentId: "deployment_1",
      slug: "demo",
    });

    expect(parseDeploymentRecord({
      deploymentId: "deployment_1",
      slug: "demo",
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 0,
    })).toEqual({
      deploymentId: "deployment_1",
      slug: "demo",
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 0,
    });
  });

  it("parses the declared registry storage error body", () => {
    expect(parseRegistryStorageErrorResponse({
      error: "Registry storage error.",
    })).toEqual({
      error: "Registry storage error.",
    });

    expect(() => parseRegistryStorageErrorResponse({ error: "raw database message" }))
      .toThrow("Registry storage error response did not match the registry protocol.");
  });
});
