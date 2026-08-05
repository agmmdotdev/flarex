import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "../src/artifactRuntime/FunctionApiCore.generated";
import {
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_INTERNAL_QUERY_PLATFORM_MODULE_V1,
  POINT_MUTATION_INTERNAL_QUERY_RUNTIME_KERNEL_MODULE_V1,
} from "../src/artifactRuntime/PointMutationInternalQueryExactRuntimeHost";
import {
  pointMutationInternalQueryExactRuntimeExecutionBridgeSourceV1,
  pointMutationInternalQueryExactRuntimePlatformSourceV1,
  pointMutationInternalQueryExactRuntimeWorkerConfigurationSourceV1,
} from "../src/artifactRuntime/PointMutationInternalQueryExactRuntimeWorkerSource";
import { POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationInternalQueryExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_INTERNAL_QUERY_RUNTIME_KERNEL_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationInternalQueryRuntimeKernel.generated";
import { requirePointMutationArgumentSemanticSizeV1 } from
  "flarex-protocol/point-mutation-start";
import {
  TransactionArtifactIdV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

describe("point mutation internal-query exact runtime", () => {
  it("runs a child read through the root mutation journal and keeps one sequence", async () => {
    const runtimeHash = "a".repeat(64);
    const artifact = Object.freeze({
      runtime: "dynamic-worker" as const,
      artifactId: TransactionArtifactIdV1Schema.make(
        `artifact_${runtimeHash.slice(0, 32)}`,
      ),
      sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(runtimeHash),
      executionModule: TransactionExecutionModuleV1Schema.make(
        "flarexCandidateBoundMutationInternalQueryRuntimeTarget/execution-v1.js",
      ),
    });
    const root = Object.freeze({
      path: TransactionFunctionPathV1Schema.make("orders:update"),
      executionModule: artifact.executionModule,
      kind: "mutation" as const,
      visibility: "public" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    });
    const catalog = Object.freeze([Object.freeze({
      functionOrdinal: 1n,
      functionPath: "orders:readInternal",
      artifactExecutionModule: "orders.js",
      exportName: "readInternal",
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    })]);
    const configuration = pointMutationInternalQueryExactRuntimeWorkerConfigurationSourceV1({
      moduleTime: Date.UTC(2026, 7, 3),
      runtimeTargetSha256Hex: runtimeHash,
      artifact,
      function: root,
      rootFunctionOrdinal: 0n,
      internalQueryCatalog: catalog,
    });
    const bridge = pointMutationInternalQueryExactRuntimeExecutionBridgeSourceV1({
      root: {
        artifactExecutionModule: "orders.js",
        exportName: "update",
        functionPath: "orders:update",
      },
      internalQueryCatalog: catalog,
    });
    const normalized = normalizeFlarexValueV1({});
    const request = JSON.stringify({
      format: "flarex.point-mutation-exact-runtime",
      version: 1,
      artifact,
      function: root,
      auth: { kind: "anonymous" },
      arguments: {},
      argumentArraySemanticBytes: requirePointMutationArgumentSemanticSizeV1(
        normalized.semanticSizeBytes,
      ),
      tables: [{ tableId: 1, logicalName: "orders" }],
      context: {
        executionId: "execution-sap06-a2",
        logScopeId: "log-sap06-a2",
        randomSeed: Array.from(new Uint8Array(32).fill(7)),
        executionTime: 100,
        initialCreationTimeCursor: 100,
      },
    });
    const runtime = new Miniflare({
      compatibilityDate: "2026-06-18",
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: `${POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch() {
  const request = ${request};
  request.context.randomSeed = new Uint8Array(request.context.randomSeed);
  const operations = [];
  let document;
  const journal = {
    resolvePointTable() {
      return {
        async runPointOperation(operation) {
          operations.push([operation.kind, String(operation.syscallSequence)]);
          if (operation.kind === "insert") {
            document = Object.freeze({ _id: "1:00000000-0000-4000-8000-000000000001", _creationTime: 100, ...operation.fields });
            return Object.freeze({ kind: "inserted", documentId: document._id, document });
          }
          if (operation.kind === "get") {
            return Object.freeze({ kind: "present", document });
          }
          throw new Error("unexpected journal operation");
        },
      };
    },
  };
  try {
    const result = await Reflect.apply(
      FlarexPointMutationInternalQueryExactRuntimeV1.prototype.run,
      {},
      [request, journal],
    );
    return Response.json({ value: result.value, operations });
  } catch (error) {
    return Response.json({ error: error?.name, message: error?.message, cause: error?.cause?.message }, { status: 422 });
  }
} };`,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: configuration,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: bridge,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_QUERY_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_INTERNAL_QUERY_RUNTIME_KERNEL_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_QUERY_PLATFORM_MODULE_V1,
          contents: pointMutationInternalQueryExactRuntimePlatformSourceV1(),
        },
        {
          type: "ESModule",
          path: "orders.js",
          contents: `
import { errorCode, errorCreate, errorData, errorMessage } from "flarex:platform";
export async function update(ctx) {
  try {
    await ctx.runQuery({ _path: "orders:readInternal" }, {});
  } catch (error) {
    if (errorCode(error) !== "DECLARED" || errorMessage(error) !== "declared child" || errorData(error).reason !== "test") {
      throw error;
    }
  }
  const id = await ctx.db.insert("orders", { status: "open" });
  return await ctx.runQuery({ _path: "orders:readInternal" }, { id });
}
export async function readInternal(ctx, args) {
  if (args.id === undefined) throw errorCreate("DECLARED", "declared child", { reason: "test" });
  return await ctx.db.get(args.id);
}`,
        },
      ],
    });
    try {
      const response = await runtime.dispatchFetch("https://sap06-a2.test/");
      const body = await response.json();
      expect({ status: response.status, body }).toEqual({ status: 200, body: {
        value: {
          _id: "1:00000000-0000-4000-8000-000000000001",
          _creationTime: 100,
          status: "open",
        },
        operations: [["insert", "1"], ["get", "2"]],
      } });
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects request function metadata that differs from the configured target", async () => {
    const runtimeHash = "b".repeat(64);
    const artifact = Object.freeze({
      runtime: "dynamic-worker" as const,
      artifactId: TransactionArtifactIdV1Schema.make(
        `artifact_${runtimeHash.slice(0, 32)}`,
      ),
      sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(runtimeHash),
      executionModule: TransactionExecutionModuleV1Schema.make(
        "flarexCandidateBoundMutationInternalQueryRuntimeTarget/execution-v1.js",
      ),
    });
    const root = Object.freeze({
      path: TransactionFunctionPathV1Schema.make("orders:update"),
      executionModule: artifact.executionModule,
      kind: "mutation" as const,
      visibility: "public" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    });
    const catalog = Object.freeze([Object.freeze({
      functionOrdinal: 1n,
      functionPath: "orders:readInternal",
      artifactExecutionModule: "orders.js",
      exportName: "readInternal",
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    })]);
    const configuration = pointMutationInternalQueryExactRuntimeWorkerConfigurationSourceV1({
      moduleTime: Date.UTC(2026, 7, 3),
      runtimeTargetSha256Hex: runtimeHash,
      artifact,
      function: root,
      rootFunctionOrdinal: 0n,
      internalQueryCatalog: catalog,
    });
    const bridge = pointMutationInternalQueryExactRuntimeExecutionBridgeSourceV1({
      root: {
        artifactExecutionModule: "orders.js",
        exportName: "update",
        functionPath: "orders:update",
      },
      internalQueryCatalog: catalog,
    });
    const normalized = normalizeFlarexValueV1({});
    const baseRequest = {
      format: "flarex.point-mutation-exact-runtime",
      version: 1,
      artifact,
      function: root,
      auth: { kind: "anonymous" },
      arguments: {},
      argumentArraySemanticBytes: requirePointMutationArgumentSemanticSizeV1(
        normalized.semanticSizeBytes,
      ),
      tables: [{ tableId: 1, logicalName: "orders" }],
      context: {
        executionId: "execution-function-pin",
        logScopeId: "log-function-pin",
        randomSeed: Array.from(new Uint8Array(32).fill(9)),
        executionTime: 100,
        initialCreationTimeCursor: 100,
      },
    };
    const requestFunctions = [
      { ...root, path: "orders:other" },
      { ...root, argsValidator: { type: "object", value: {} } },
      { ...root, returnsValidator: { type: "string" } },
    ];
    for (const requestFunction of requestFunctions) {
      const request = JSON.stringify({ ...baseRequest, function: requestFunction });
      const runtime = new Miniflare({
        compatibilityDate: "2026-06-18",
        modules: [
          {
            type: "ESModule",
            path: "worker.js",
            contents: `${POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch() {
  const request = ${request};
  request.context.randomSeed = new Uint8Array(request.context.randomSeed);
  try {
    await Reflect.apply(FlarexPointMutationInternalQueryExactRuntimeV1.prototype.run, {}, [request, { resolvePointTable() { throw new Error("not reached"); } }]);
    return new Response("unexpected", { status: 200 });
  } catch (error) {
    return Response.json({ name: error?.name, message: error?.message }, { status: 422 });
  }
} };`,
          },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1, contents: configuration },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1, contents: bridge },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_QUERY_RUNTIME_KERNEL_MODULE_V1, contents: POINT_MUTATION_INTERNAL_QUERY_RUNTIME_KERNEL_SOURCE_V1 },
          { type: "ESModule", path: FUNCTION_API_CORE_MODULE_V1, contents: FUNCTION_API_CORE_SOURCE_V1 },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_QUERY_PLATFORM_MODULE_V1, contents: pointMutationInternalQueryExactRuntimePlatformSourceV1() },
          { type: "ESModule", path: "orders.js", contents: "export function update() { return null; } export function readInternal() { return null; }" },
        ],
      });
      try {
        const response = await runtime.dispatchFetch("https://function-pin.test/");
        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
          name: "Error",
          message: "Exact-runtime function does not match the configured target.",
        }));
      } finally {
        await runtime.dispose();
      }
    }
  });
});
