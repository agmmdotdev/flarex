import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1,
  POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
} from "../src/artifactRuntime/PointMutationInternalCallExactRuntimeHost";
import {
  pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1,
  pointMutationInternalCallExactRuntimePlatformSourceV1,
  pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1,
} from "../src/artifactRuntime/PointMutationInternalCallExactRuntimeWorkerSource";
import { POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationInternalCallExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1 } from
  "../src/artifactRuntime/PointMutationInternalCallRuntimeKernel.generated";
import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "../src/artifactRuntime/FunctionApiCore.generated";
import { requirePointMutationArgumentSemanticSizeV1 } from
  "flarex-protocol/point-mutation-start";
import {
  TransactionArtifactIdV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

describe("point mutation internal-call exact runtime", () => {
  it("keeps caught child-mutation writes and nested reads on one journal sequence", async () => {
    const runtimeHash = "a".repeat(64);
    const artifact = Object.freeze({
      runtime: "dynamic-worker" as const,
      artifactId: TransactionArtifactIdV1Schema.make(
        `artifact_${runtimeHash.slice(0, 32)}`,
      ),
      sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(runtimeHash),
      executionModule: TransactionExecutionModuleV1Schema.make(
        "flarexCandidateBoundMutationInternalCallRuntimeTarget/execution-v1.js",
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
      handlerKind: "query" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    }), Object.freeze({
      functionOrdinal: 2n,
      functionPath: "orders:mutateInternal",
      artifactExecutionModule: "orders.js",
      exportName: "mutateInternal",
      handlerKind: "mutation" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    })]);
    const configuration = pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1({
      moduleTime: Date.UTC(2026, 7, 3),
      runtimeTargetSha256Hex: runtimeHash,
      artifact,
      function: root,
      rootFunctionOrdinal: 0n,
      internalFunctionCatalog: catalog,
    });
    const bridge = pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1({
      root: {
        artifactExecutionModule: "orders.js",
        exportName: "update",
        functionPath: "orders:update",
      },
      internalFunctionCatalog: catalog,
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
        executionId: "execution-sap06-a3",
        logScopeId: "log-sap06-a3",
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
          contents: `${POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch() {
  const request = ${request};
  request.context.randomSeed = new Uint8Array(request.context.randomSeed);
  const operations = [];
  const settledOperations = [];
  const documents = new Map();
  let nextDocument = 0;
  const journal = {
    resolvePointTable() {
      return {
        async runPointOperation(operation) {
          operations.push([operation.kind, String(operation.syscallSequence)]);
          if (operation.kind === "insert") {
            if (operation.fields.status === "invalid") {
              const error = new Error("The resulting document failed the active schema validator.");
              Object.defineProperty(error, "name", {
                value: "ApplicationRevisionSyscallDocumentValidationV1Error",
              });
              throw error;
            }
            nextDocument += 1;
            const documentId = "1:00000000-0000-4000-8000-" + String(nextDocument).padStart(12, "0");
            const document = Object.freeze({ _id: documentId, _creationTime: 100, ...operation.fields });
            documents.set(documentId, document);
            settledOperations.push([operation.kind, String(operation.syscallSequence)]);
            return Object.freeze({ kind: "inserted", documentId, document });
          }
          if (operation.kind === "patch") {
            const current = documents.get(operation.documentId);
            const next = { ...current };
            for (const [field, value] of Object.entries(operation.patch)) {
              if (value === undefined) delete next[field];
              else next[field] = value;
            }
            const document = Object.freeze(next);
            documents.set(operation.documentId, document);
            settledOperations.push([operation.kind, String(operation.syscallSequence)]);
            return Object.freeze({ kind: "unit", operation: "patch" });
          }
          if (operation.kind === "replace") {
            const current = documents.get(operation.documentId);
            const document = Object.freeze({ _id: current._id, _creationTime: current._creationTime, ...operation.fields });
            documents.set(operation.documentId, document);
            settledOperations.push([operation.kind, String(operation.syscallSequence)]);
            return Object.freeze({ kind: "unit", operation: "replace" });
          }
          if (operation.kind === "delete") {
            documents.delete(operation.documentId);
            settledOperations.push([operation.kind, String(operation.syscallSequence)]);
            return Object.freeze({ kind: "unit", operation: "delete" });
          }
          if (operation.kind === "get") {
            const document = documents.get(operation.documentId);
            settledOperations.push([operation.kind, String(operation.syscallSequence)]);
            return document === undefined
              ? Object.freeze({ kind: "missing", document: null })
              : Object.freeze({ kind: "present", document });
          }
          throw new Error("unexpected journal operation");
        },
      };
    },
  };
  try {
    const result = await Reflect.apply(
      FlarexPointMutationInternalCallExactRuntimeV1.prototype.run,
      {},
      [request, journal],
    );
    return Response.json({ value: result.value, operations, settledOperations });
  } catch (error) {
    return Response.json({ error: error?.name, message: error?.message, cause: error?.cause?.message }, { status: 422 });
  }
} };`,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: configuration,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: bridge,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1,
          contents: pointMutationInternalCallExactRuntimePlatformSourceV1(),
        },
        {
          type: "ESModule",
          path: "orders.js",
          contents: `
import { errorCode, errorCreate, errorData, errorMessage } from "flarex:platform";
export async function update(ctx) {
  if (Object.keys(ctx).join(",") !== "auth,db,runQuery,runMutation" || "scheduler" in ctx || "storage" in ctx) {
    throw new Error("invalid mutation context shape");
  }
  if (Object.keys(ctx.db).join(",") !== "get,insert,patch,replace,delete" || "query" in ctx.db || "normalizeId" in ctx.db || "system" in ctx.db) {
    throw new Error("invalid mutation database shape");
  }
  if (await ctx.auth.getUserIdentity() !== null) throw new Error("invalid anonymous identity");
  let id;
  try {
    await ctx.runMutation({ _path: "orders:mutateInternal" }, {});
  } catch (error) {
    if (errorCode(error) !== "DECLARED" || errorMessage(error) !== "declared child" || errorData(error).reason !== "test") {
      throw error;
    }
    id = errorData(error).id;
  }
  try {
    await ctx.runMutation({ _path: "orders:mutateInternal" }, { invalid: true });
  } catch (error) {
    if (error.name !== "ApplicationRevisionSyscallDocumentValidationV1Error") {
      throw error;
    }
  }
  return await ctx.runQuery({ _path: "orders:readInternal" }, { id });
}
export async function mutateInternal(ctx, args) {
  const id = await ctx.db.insert("orders", { status: args.invalid ? "invalid" : "open" });
  if (args.invalid) return id;
  await ctx.db.patch(id, { status: "patched" });
  await ctx.db.replace(id, { status: "open" });
  const temporaryId = await ctx.db.insert("orders", { status: "temporary" });
  await ctx.db.delete(temporaryId);
  throw errorCreate("DECLARED", "declared child", { reason: "test", id });
}
export async function readInternal(ctx, args) {
  if (Object.keys(ctx).join(",") !== "auth,db,runQuery" || "runMutation" in ctx || "scheduler" in ctx || "storage" in ctx) {
    throw new Error("invalid internal query context shape");
  }
  if (Object.keys(ctx.db).join(",") !== "get" || "insert" in ctx.db || "query" in ctx.db || "normalizeId" in ctx.db || "system" in ctx.db) {
    throw new Error("invalid internal query database shape");
  }
  return await ctx.db.get(args.id);
}`,
        },
      ],
    });
    try {
      const response = await runtime.dispatchFetch("https://sap06-a3.test/");
      const body = await response.json();
      expect({ status: response.status, body }).toEqual({ status: 200, body: {
        value: {
          _id: "1:00000000-0000-4000-8000-000000000001",
          _creationTime: 100,
          status: "open",
        },
        operations: [
          ["insert", "1"],
          ["patch", "2"],
          ["replace", "3"],
          ["insert", "4"],
          ["delete", "5"],
          ["insert", "6"],
          ["get", "6"],
        ],
        settledOperations: [
          ["insert", "1"],
          ["patch", "2"],
          ["replace", "3"],
          ["insert", "4"],
          ["delete", "5"],
          ["get", "6"],
        ],
      } });
    } finally {
      await runtime.dispose();
    }
  });

  it("does not expose mutation capability to an internal query", async () => {
    const runtimeHash = "b".repeat(64);
    const artifact = Object.freeze({
      runtime: "dynamic-worker" as const,
      artifactId: TransactionArtifactIdV1Schema.make(
        `artifact_${runtimeHash.slice(0, 32)}`,
      ),
      sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
        runtimeHash,
      ),
      executionModule: TransactionExecutionModuleV1Schema.make(
        "flarexCandidateBoundMutationInternalCallRuntimeTarget/execution-v1.js",
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
      handlerKind: "query" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    }), Object.freeze({
      functionOrdinal: 2n,
      functionPath: "orders:mutateInternal",
      artifactExecutionModule: "orders.js",
      exportName: "mutateInternal",
      handlerKind: "mutation" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    })]);
    const configuration = pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1({
      moduleTime: Date.UTC(2026, 7, 6),
      runtimeTargetSha256Hex: runtimeHash,
      artifact,
      function: root,
      rootFunctionOrdinal: 0n,
      internalFunctionCatalog: catalog,
    });
    const bridge = pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1({
      root: {
        artifactExecutionModule: "orders.js",
        exportName: "update",
        functionPath: "orders:update",
      },
      internalFunctionCatalog: catalog,
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
        executionId: "execution-fac04-forbidden",
        logScopeId: "log-fac04-forbidden",
        randomSeed: Array.from(new Uint8Array(32).fill(9)),
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
          contents: `${POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch() {
  const request = ${request};
  request.context.randomSeed = new Uint8Array(request.context.randomSeed);
  const journal = { resolvePointTable() { throw new Error("unexpected database access"); } };
  try {
    const result = await Reflect.apply(
      FlarexPointMutationInternalCallExactRuntimeV1.prototype.run,
      {},
      [request, journal],
    );
    return Response.json({ value: result.value });
  } catch (error) {
    return Response.json({
      error: error?.name,
      terminalError: error?.cause?.name,
      terminalReason: error?.cause?.reason,
    }, { status: 422 });
  }
} };`,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: configuration,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: bridge,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1,
          contents: pointMutationInternalCallExactRuntimePlatformSourceV1(),
        },
        {
          type: "ESModule",
          path: "orders.js",
          contents: `
export async function update(ctx) {
  return await ctx.runQuery({ _path: "orders:readInternal" }, {});
}
export async function readInternal(ctx) {
  if (Object.keys(ctx).join(",") !== "auth,db,runQuery" || "runMutation" in ctx) {
    throw new Error("invalid internal query context shape");
  }
  if (Object.keys(ctx.db).join(",") !== "get" || "insert" in ctx.db) {
    throw new Error("invalid internal query database shape");
  }
  return { status: "query-only" };
}
export function mutateInternal() {
  return { status: "unreachable" };
}`,
        },
      ],
    });
    try {
      const response = await runtime.dispatchFetch("https://fac04.test/");
      await expect(response.json()).resolves.toEqual({
        value: { status: "query-only" },
      });
      expect(response.status).toBe(200);
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
        "flarexCandidateBoundMutationInternalCallRuntimeTarget/execution-v1.js",
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
      handlerKind: "query" as const,
      argsValidator: Object.freeze({ type: "any" as const }),
      returnsValidator: null,
    })]);
    const configuration = pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1({
      moduleTime: Date.UTC(2026, 7, 3),
      runtimeTargetSha256Hex: runtimeHash,
      artifact,
      function: root,
      rootFunctionOrdinal: 0n,
      internalFunctionCatalog: catalog,
    });
    const bridge = pointMutationInternalCallExactRuntimeExecutionBridgeSourceV1({
      root: {
        artifactExecutionModule: "orders.js",
        exportName: "update",
        functionPath: "orders:update",
      },
      internalFunctionCatalog: catalog,
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
            contents: `${POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch() {
  const request = ${request};
  request.context.randomSeed = new Uint8Array(request.context.randomSeed);
  try {
    await Reflect.apply(FlarexPointMutationInternalCallExactRuntimeV1.prototype.run, {}, [request, { resolvePointTable() { throw new Error("not reached"); } }]);
    return new Response("unexpected", { status: 200 });
  } catch (error) {
    return Response.json({ name: error?.name, message: error?.message }, { status: 422 });
  }
} };`,
          },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_CONFIG_MODULE_V1, contents: configuration },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_CALL_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1, contents: bridge },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_MODULE_V1, contents: POINT_MUTATION_INTERNAL_CALL_RUNTIME_KERNEL_SOURCE_V1 },
          { type: "ESModule", path: FUNCTION_API_CORE_MODULE_V1, contents: FUNCTION_API_CORE_SOURCE_V1 },
          { type: "ESModule", path: POINT_MUTATION_INTERNAL_CALL_PLATFORM_MODULE_V1, contents: pointMutationInternalCallExactRuntimePlatformSourceV1() },
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
