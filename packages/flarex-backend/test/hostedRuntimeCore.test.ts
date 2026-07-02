import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  parseActiveDeploymentStatus,
  parseFinishPushResponse,
  parsePushStatus,
} from "flarex-protocol/deployment";
import {
  type ExecutionArtifactInvokePayload,
} from "../src/artifactRuntime";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "../src/artifactStore";
import { decodeExecutionArtifactInvokePayloadBody } from "../src/artifactRuntime/Requests";
import type {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentFunctionMetadata,
  PushSourcePackage,
  StartPushRequest,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

describe("hosted runtime core", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("pushes source through analyzer, persists R2 artifact, activates, and invokes the runtime binding", async () => {
    const deploymentId = "hosted-runtime-core";
    const sourcePackage = testSourcePackage();
    const analyzerRequests: unknown[] = [];
    const runtimeCalls: Array<{
      readonly authorization: string | null;
      readonly artifactId: string | null;
      readonly sourcePackageHash: string | null;
      readonly body: ExecutionArtifactInvokePayload;
    }> = [];

    const harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
        FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
        FLAREX_PROJECT_ID: "project-hosted",
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_ANALYZER: async request => {
          analyzerRequests.push(await request.json());
          return Response.json({
            analysis: testAnalysis(),
            codegenAnalysis: testCodegenAnalysis(),
            diagnostics: [{ level: "log", message: "hosted analysis ok" }],
          });
        },
        FLAREX_ARTIFACT_RUNTIME: async request => {
          const body = await decodeRuntimePayload(await request.json());
          runtimeCalls.push({
            authorization: request.headers.get("authorization"),
            artifactId: request.headers.get("x-flarex-artifact-id"),
            sourcePackageHash: request.headers.get("x-flarex-source-package-hash"),
            body,
          });
          return Response.json({
            value: {
              runtime: "hosted",
              path: requestPathFromRuntimePayload(body),
            },
          });
        },
      },
    });
    harnesses.push(harness);

    const started = await startSourceOnlyPush(harness, deploymentId, {
      sourcePackage,
    });
    expect(started).toMatchObject({
      state: "analyzed",
      diagnostics: [{ level: "log", message: "hosted analysis ok" }],
      codegenAnalysis: testCodegenAnalysis(),
    });
    expect(analyzerRequests).toEqual([{ deploymentId, sourcePackage }]);

    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await expect(
      new R2BackendExecutionArtifactStore(r2BucketLike(bucket)).get(ref),
    ).resolves.toEqual(sourcePackage);

    const finish = await finishPush(harness, deploymentId, started.pushId);
    expect(finish.result).toBe("activated");

    const active = await getActiveDeployment(harness, deploymentId);
    expect(active.executionArtifactRef).toEqual(ref);

    const invoke = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/invoke`,
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
    expect(invoke.ok).toBe(true);
    await expect(invoke.json()).resolves.toEqual({
      value: { runtime: "hosted", path: "users:get" },
    });

    expect(runtimeCalls).toEqual([
      {
        authorization: "Bearer runtime-secret",
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId,
          ref,
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

async function startSourceOnlyPush(
  harness: BackendHarness,
  deploymentId: string,
  body: StartPushRequest,
): Promise<ReturnType<typeof parsePushStatus>> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return parsePushStatus(await response.json());
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<ReturnType<typeof parseFinishPushResponse>> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  expect(response.ok).toBe(true);
  return parseFinishPushResponse(await response.json());
}

async function getActiveDeployment(
  harness: BackendHarness,
  deploymentId: string,
): Promise<ReturnType<typeof parseActiveDeploymentStatus>> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/deployment`,
  );
  expect(response.ok).toBe(true);
  return parseActiveDeploymentStatus(await response.json());
}

function decodeRuntimePayload(value: unknown): Promise<ExecutionArtifactInvokePayload> {
  return Effect.runPromise(decodeExecutionArtifactInvokePayloadBody(value));
}

function requestPathFromRuntimePayload(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("request" in value) ||
    typeof value.request !== "object" ||
    value.request === null ||
    !("path" in value.request) ||
    typeof value.request.path !== "string"
  ) {
    return "unknown";
  }
  return value.request.path;
}

function r2BucketLike(value: unknown): R2BucketLike {
  if (!isR2BucketLike(value)) {
    throw new Error("Miniflare ARTIFACTS bucket does not implement the R2 artifact store API.");
  }
  return value;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    typeof value.put === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
  );
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

function testAnalysis(): DeploymentAnalysis {
  const getFunction = testGetFunction();
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
        getFunction,
      ],
    },
  };
}

function testCodegenAnalysis(): DeploymentCodegenAnalysis {
  const analysis = testAnalysis();
  const getFunction = testGetFunction();
  return {
    schema: {
      ...analysis.schema,
      tables: analysis.schema.tables.map(table => ({ ...table, state: "active" })),
    },
    functions: [
      {
        moduleName: "users",
        functions: [
          {
            moduleName: "users",
            exportName: "get",
            kind: "query",
            visibility: "public",
            args: getFunction.args,
            returns: null,
            partition: getFunction.partition,
          },
        ],
      },
    ],
  };
}

function testGetFunction(): DeploymentFunctionMetadata & {
  readonly args: NonNullable<DeploymentFunctionMetadata["args"]>;
  readonly partition: NonNullable<DeploymentFunctionMetadata["partition"]>;
} {
  return {
    path: "users:get",
    kind: "query",
    visibility: "public",
    args: {
      type: "object",
      value: {
        id: { fieldType: { type: "id", tableName: "users" }, optional: false },
      },
    },
    returns: null,
    partition: {
      type: "partition",
      table: "users",
      selector: "byId",
      partitionField: "_id",
      argField: "id",
    },
  };
}
