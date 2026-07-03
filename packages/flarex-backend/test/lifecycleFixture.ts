import {
  parseActiveDeploymentStatus,
  parseFinishPushResponse,
  parsePushStatus,
} from "flarex-protocol/deployment";
import type {
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentFunctionMetadata,
  InvokeRequest,
  PushSourcePackage,
  StartPushRequest,
} from "../src/types";
import type { BackendHarness } from "./backendHarness";

export type LifecycleQueryInvokeRequest = InvokeRequest & {
  readonly kind: "query";
};

export async function startSourceOnlyPush(
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
  await assertResponseOk(response, "start source-only push");
  return parsePushStatus(await response.json());
}

export async function finishPush(
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
  await assertResponseOk(response, "finish push");
  return parseFinishPushResponse(await response.json());
}

export async function getActiveDeployment(
  harness: BackendHarness,
  deploymentId: string,
): Promise<ReturnType<typeof parseActiveDeploymentStatus>> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/deployment`,
  );
  await assertResponseOk(response, "get active deployment");
  return parseActiveDeploymentStatus(await response.json());
}

export function testLifecycleInvokeRequest(): LifecycleQueryInvokeRequest {
  return {
    path: "users:get",
    kind: "query",
    partitionKey: "1:user",
    args: { id: "1:user" },
  };
}

export function testLifecycleSourcePackage(): PushSourcePackage {
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

export function testLifecycleAnalysis(): DeploymentAnalysis {
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
      functions: [getFunction],
    },
  };
}

export function testLifecycleCodegenAnalysis(): DeploymentCodegenAnalysis {
  const analysis = testLifecycleAnalysis();
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

type DispatchResponse = {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
};

async function assertResponseOk(response: DispatchResponse, operation: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${operation} failed with ${response.status}: ${await response.text()}`);
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
