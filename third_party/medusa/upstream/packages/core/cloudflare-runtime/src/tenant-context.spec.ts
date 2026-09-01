import { describe, expect, it } from "vitest"

import {
  createPartitionAddress,
  createProjectionDatabaseAddress,
  createProjectionScope,
  createTenantRuntimeContext,
  TenantRuntimeContextError,
} from "."

describe("Cloudflare tenant runtime context", () => {
  it("creates a default local context", () => {
    expect(createTenantRuntimeContext()).toEqual({
      tenantId: "local",
      deploymentId: "local",
      environment: "development",
      deploymentVersion: "dev",
    })
  })

  it("normalizes context fields before creating addresses", () => {
    const context = createTenantRuntimeContext({
      tenantId: "tenant_a",
      deploymentId: "storefront",
      environment: "prod",
      deploymentVersion: "v1",
    })

    expect(
      createPartitionAddress(context, {
        family: "cart",
        key: "cart_123",
      }).name
    ).toBe("partition:tenant_a:storefront:prod:v1:cart:cart_123")

    expect(
      createProjectionScope(context, {
        name: "catalog",
      }).key
    ).toBe("projection:tenant_a:storefront:prod:v1:catalog")

    expect(
      createProjectionDatabaseAddress(context, {
        name: "index",
      }).key
    ).toBe("projection-db:tenant_a:storefront:prod:v1:index")
  })

  it("keeps tenant partition and projection scopes separate", () => {
    const tenantA = createTenantRuntimeContext({
      tenantId: "tenant_a",
      deploymentId: "storefront",
    })
    const tenantB = createTenantRuntimeContext({
      tenantId: "tenant_b",
      deploymentId: "storefront",
    })

    expect(
      createPartitionAddress(tenantA, {
        family: "cart",
        key: "cart_123",
      }).name
    ).not.toBe(
      createPartitionAddress(tenantB, {
        family: "cart",
        key: "cart_123",
      }).name
    )

    expect(createProjectionScope(tenantA, { name: "catalog" }).key).not.toBe(
      createProjectionScope(tenantB, { name: "catalog" }).key
    )

    expect(
      createProjectionDatabaseAddress(tenantA, { name: "index" }).key
    ).not.toBe(createProjectionDatabaseAddress(tenantB, { name: "index" }).key)
  })

  it("rejects unsupported address delimiters", () => {
    expect(() =>
      createTenantRuntimeContext({
        tenantId: "tenant:bad",
      })
    ).toThrow(TenantRuntimeContextError)
  })
})
