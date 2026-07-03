import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  decodeDeploymentRecordEffect,
  decodeListDeploymentsResponseEffect,
  RegistryRoute,
} from "flarex-protocol/registry";
import type { DeploymentRecord, Env } from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

let harness: BackendHarness;

async function decodeDeploymentRecordForTest(value: unknown) {
  return await Effect.runPromise(decodeDeploymentRecordEffect(value));
}

async function decodeListDeploymentsResponseForTest(value: unknown) {
  return await Effect.runPromise(decodeListDeploymentsResponseEffect(value));
}

beforeAll(async () => {
  harness = await createBackendHarness();
  await harness.mf.getBindings<Env>();
});

afterAll(async () => {
  await harness.dispose();
});

describe("registry deployment routes", () => {
  it("creates and lists deployments", async () => {
    const created = await postDeployment({
      deploymentId: "registry-create-list",
      slug: "registry-create-list-slug",
    });

    expect(created).toMatchObject({
      deploymentId: "registry-create-list",
      slug: "registry-create-list-slug",
      schemaVersion: 0,
    });
    expect(created.createdAt).toEqual(expect.any(Number));
    expect(created.updatedAt).toEqual(expect.any(Number));

    const deployments = await listDeployments();
    expect(deployments).toContainEqual(
      expect.objectContaining({
        deploymentId: "registry-create-list",
        slug: "registry-create-list-slug",
        schemaVersion: 0,
      }),
    );
  });

  it("rejects invalid JSON before schema decoding", async () => {
    const response = await harness.mf.dispatchFetch(registryUrl(RegistryRoute.deployments), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });
  });

  it("rejects schema-invalid create deployment bodies", async () => {
    const response = await postDeploymentRaw({
      deploymentId: 123,
      slug: "bad-body",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Create deployment request must include optional string deploymentId and slug fields.",
    });
  });

  it("updates an existing deployment id without duplicating list entries", async () => {
    await postDeployment({
      deploymentId: "registry-upsert",
      slug: "registry-upsert-a",
    });
    const updated = await postDeployment({
      deploymentId: "registry-upsert",
      slug: "registry-upsert-b",
    });

    expect(updated).toMatchObject({
      deploymentId: "registry-upsert",
      slug: "registry-upsert-b",
      schemaVersion: 0,
    });

    const deployments = await listDeployments();
    const matches = deployments.filter(deployment => deployment.deploymentId === "registry-upsert");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      deploymentId: "registry-upsert",
      slug: "registry-upsert-b",
      schemaVersion: 0,
    });
  });
});

async function postDeployment(body: unknown): Promise<DeploymentRecord> {
  const response = await postDeploymentRaw(body);
  expect(response.ok).toBe(true);
  return await decodeDeploymentRecordForTest(await response.json());
}

async function postDeploymentRaw(body: unknown) {
  return harness.mf.dispatchFetch(registryUrl(RegistryRoute.deployments), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listDeployments(): Promise<ReadonlyArray<DeploymentRecord>> {
  const response = await harness.mf.dispatchFetch(registryUrl(RegistryRoute.deployments));
  expect(response.ok).toBe(true);
  const body = await decodeListDeploymentsResponseForTest(await response.json());
  return body.deployments;
}

function registryUrl(pathname: string): string {
  return `http://flarex.test${pathname}`;
}
