import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import {
  buildPointQueryInternalCallExactRuntimeWorkerDefinitionV1,
  POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1,
} from
  "../src/artifactRuntime/PointQueryInternalCallExactRuntimeHost";

describe("point-query internal-call exact runtime in workerd", () => {
  it("preserves a genuine call-cycle terminal envelope", async () => {
    const artifact = {
      runtime: "dynamic-worker" as const,
      artifactId: `artifact_${"c".repeat(32)}`,
      sourcePackageHash: "c".repeat(64),
      executionModule: "root.js",
    };
    const rootFunction = {
      path: "orders:get",
      executionModule: "root.js",
      kind: "query" as const,
      visibility: "public" as const,
      argsValidator: { type: "any" as const },
      returnsValidator: null,
    };
    const definition = buildPointQueryInternalCallExactRuntimeWorkerDefinitionV1({
      artifact,
      compatibilityDate: "2026-06-11",
      runtimeTargetSha256Hex: "aa".repeat(32),
      function: rootFunction,
      snapshotCommitSeq: 7n,
      functionPath: rootFunction.path,
      rootFunctionOrdinal: 0n,
      artifactExecutionModule: "root.js",
      exportName: "get",
      internalQueryCatalog: [{
        functionOrdinal: 1n,
        functionPath: "orders:internal",
        artifactExecutionModule: "internal.js",
        exportName: "internal",
        argsValidator: { type: "any" },
        returnsValidator: null,
      }],
      sourceModules: [{
        path: "root.js",
        source: 'export async function get(ctx,a){' +
          'if(Object.keys(ctx).join(",")!=="auth,db,runQuery"||"runMutation" in ctx||"scheduler" in ctx||"storage" in ctx)throw new Error("invalid query context shape");' +
          'if(Object.keys(ctx.db).join(",")!=="get"||"insert" in ctx.db||"query" in ctx.db||"normalizeId" in ctx.db||"system" in ctx.db)throw new Error("invalid query database shape");' +
          'if(await ctx.auth.getUserIdentity()!==null)throw new Error("invalid anonymous identity");' +
          'return await ctx.runQuery({_path:"orders:internal"},a)}',
      }, {
        path: "internal.js",
        source: 'export async function internal(ctx,a){return await ctx.runQuery({_path:"orders:internal"},a)}',
      }],
    });
    const argumentsValue = {};
    const request = {
      format: "flarex.point-query-exact-runtime",
      version: 1,
      runtimeTargetSha256: Array.from(new Uint8Array(32).fill(0xaa)),
      artifact,
      function: rootFunction,
      auth: { kind: "anonymous" },
      arguments: argumentsValue,
      argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue).semanticSizeBytes,
      tables: [],
      context: {
        executionId: "cycle-1",
        randomSeed: Array(32).fill(3),
        executionTime: 100,
        snapshotCommitSeq: "7",
      },
    };
    const runtime = new Miniflare({
      compatibilityDate: definition.compatibilityDate,
      modules: [{
        type: "ESModule",
        path: "dispatch.js",
        contents: `import { FlarexPointQueryInternalCallExactRuntimeV1 } from "./${POINT_QUERY_INTERNAL_CALL_EXACT_RUNTIME_MAIN_MODULE_V1}";
export default { async fetch() {
  const request = ${JSON.stringify(request)};
  request.runtimeTargetSha256 = new Uint8Array(request.runtimeTargetSha256);
  request.context.randomSeed = new Uint8Array(request.context.randomSeed);
  request.context.snapshotCommitSeq = BigInt(request.context.snapshotCommitSeq);
  const capability = { revalidate: async () => undefined, readPointDocument: async () => ({ kind: "missing" }) };
  try {
    const result = await Reflect.apply(FlarexPointQueryInternalCallExactRuntimeV1.prototype.run, {}, [request, capability]);
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ ok: false, name: error?.name, message: error?.message });
  }
} };`,
      }, ...Object.entries(definition.modules).map(([path, contents]) => ({
        type: "ESModule" as const,
        path,
        contents,
      }))],
    });
    try {
      const response = await runtime.dispatchFetch("https://query-runtime.test/");
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        name: "PointQueryInternalCallExactRuntimeTerminalV1Error",
      });
    } finally {
      await runtime.dispose();
    }
  });
});
