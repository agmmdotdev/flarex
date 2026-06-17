import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { afterAll, describe, expect, it } from "vitest";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "../src/artifactStore";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  Env,
  InvokeRequest,
  PushSourcePackage,
  PushStatus,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

describe("backend artifact runtime route", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("loads the active R2 source package before routing public invoke to the runtime binding", async () => {
    const runtimeCalls: Array<{
      artifactId: string | null;
      sourcePackageHash: string | null;
      body: unknown;
    }> = [];
    const harness = await createBackendHarness({
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_ARTIFACT_RUNTIME: async request => {
          runtimeCalls.push({
            artifactId: request.headers.get("x-flarex-artifact-id"),
            sourcePackageHash: request.headers.get("x-flarex-source-package-hash"),
            body: await request.json(),
          });
          return Response.json({
            value: {
              runtime: "artifact",
              path: (runtimeCalls[0]?.body as { request?: InvokeRequest }).request?.path,
            },
          });
        },
      },
    });
    harnesses.push(harness);

    const sourcePackage = testSourcePackage();
    const start = await startPush(harness, "artifact-runtime-route", {
      sourcePackage,
      analysis: testAnalysis(),
    });
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await new R2BackendExecutionArtifactStore(bucket as unknown as R2BucketLike)
      .put(sourcePackage);
    const finish = await finishPush(harness, "artifact-runtime-route", start.pushId);
    expect(finish.state).toBe("activated");

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/artifact-runtime-route/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      value: { runtime: "artifact", path: "users:get" },
    });

    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    expect(runtimeCalls).toEqual([
      {
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId: "artifact-runtime-route",
          ref,
          sourcePackage,
          request: {
            path: "users:get",
            kind: "query",
            partitionKey: "user:1",
            args: { id: "1:user" },
          },
        },
      },
    ]);
  });
});

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

function testAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "users:get",
          kind: "query",
          args: { type: "object", value: {} },
          returns: null,
        },
      ],
    },
  };
}

function testSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "users.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const get = {};",
      },
    ],
    functions: ["users.js"],
    execution: "_flarex/execution.js",
  };
}
