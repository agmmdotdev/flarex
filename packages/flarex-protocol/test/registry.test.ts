import { describe, expect, it } from "vitest";
import { RegistryRoute } from "../src/registry";

describe("registry protocol routes", () => {
  it("exports the stable RegistryDO route paths", () => {
    expect(RegistryRoute).toEqual({
      health: "/health",
      deployments: "/deployments",
    });
  });
});
