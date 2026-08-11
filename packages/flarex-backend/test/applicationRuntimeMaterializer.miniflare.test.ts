import { Miniflare } from "miniflare";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { afterEach, describe, expect, it } from "vitest";

import {
  APPLICATION_RUNTIME_COLD_ENTRYPOINT,
  makeApplicationRuntimeColdWorkerDefinition,
} from "../src/artifactRuntime/ApplicationRuntimeMaterializer";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("Application Runtime Worker Loader parity", () => {
  it("cold-loads the whole source graph and resolves the exact registration", async () => {
    const executionSource = [
      'import { query } from "flarex/server";',
      'import { v } from "flarex/values";',
      'import * as users from "../functions/users.js";',
      "const deterministicImport = Date.now() === 1700000000000 &&",
      "  Math.random() === 0.2921996123623103;",
      "export default { users: { get: query({",
      '  args: deterministicImport ? v.object({ id: v.id("users") }) :',
      '    v.object({ liveClock: v.string() }),',
      "  returns: v.null(),",
      "  handler: users.get,",
      "}) } };",
      "",
    ].join("\n");
    const handlerSource = [
      "Object.getPrototypeOf = () => { throw new Error('tampered getPrototypeOf'); };",
      "Object.getOwnPropertyDescriptor = () => undefined;",
      "Object.freeze = () => ({ kind: 'rejected', reason: 'tampered freeze' });",
      "export function get() { return null; }",
      "",
    ].join("\n");
    const modules = Object.freeze([Object.freeze({
      path: "_flarex/application.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "b".repeat(64),
      sourceByteLength: new TextEncoder().encode(executionSource).byteLength,
      source: executionSource,
    }), Object.freeze({
      path: "functions/users.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceSha256: "c".repeat(64),
      sourceByteLength: new TextEncoder().encode(handlerSource).byteLength,
      source: handlerSource,
    })]);
    const definition = makeApplicationRuntimeColdWorkerDefinition({
      source: Object.freeze({
        sourceArtifact: Object.freeze({
          rootSha256: "a".repeat(64),
          executionModulePath: "_flarex/application.js",
          schemaModulePath: null,
          modules: Object.freeze(modules.map(module => Object.freeze({
            path: module.path,
            roles: module.roles,
            sourceSha256: module.sourceSha256,
            sourceByteLength: module.sourceByteLength,
          }))),
        }),
        modules,
      }),
      function: {
        path: "users:get",
        moduleName: "users",
        exportName: "get",
        kind: "query",
        visibility: "public",
        args: {
          type: "object",
          value: {
            id: {
              fieldType: { type: "id", tableName: "users" },
              optional: false,
            },
          },
        },
        returns: { type: "null" },
        partition: null,
        entrySha256: "d".repeat(64),
      },
      compatibilityDate: "2026-06-14",
    });
    const response = await resolveDefinition(definition);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "resolved",
      path: "users:get",
      functionKind: "query",
      visibility: "public",
    });
  });

  it("rejects a caught forbidden import attempt through the sticky policy", async () => {
    const executionSource = [
      'import { query } from "flarex/server";',
      'import * as users from "../functions/users.js";',
      "export default { users: { get: query({ handler: users.get }) } };",
      "",
    ].join("\n");
    const handlerSource = [
      "try { fetch('https://forbidden.invalid/'); } catch {}",
      "export function get() { return null; }",
      "",
    ].join("\n");
    const modules = Object.freeze([Object.freeze({
      path: "_flarex/application.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: "e".repeat(64),
      sourceByteLength: new TextEncoder().encode(executionSource).byteLength,
      source: executionSource,
    }), Object.freeze({
      path: "functions/users.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceSha256: "f".repeat(64),
      sourceByteLength: new TextEncoder().encode(handlerSource).byteLength,
      source: handlerSource,
    })]);
    const definition = makeApplicationRuntimeColdWorkerDefinition({
      source: Object.freeze({
        sourceArtifact: Object.freeze({
          rootSha256: "9".repeat(64),
          executionModulePath: "_flarex/application.js",
          schemaModulePath: null,
          modules: Object.freeze(modules.map(module => Object.freeze({
            path: module.path,
            roles: module.roles,
            sourceSha256: module.sourceSha256,
            sourceByteLength: module.sourceByteLength,
          }))),
        }),
        modules,
      }),
      function: {
        path: "users:get",
        moduleName: "users",
        exportName: "get",
        kind: "query",
        visibility: "public",
        args: { type: "any" },
        returns: null,
        partition: null,
        entrySha256: "8".repeat(64),
      },
      compatibilityDate: "2026-06-14",
    });

    const response = await resolveDefinition(definition);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "rejected",
      reason: "forbiddenImportEffect",
    });
  });
});

async function resolveDefinition(
  definition: ReturnType<typeof makeApplicationRuntimeColdWorkerDefinition>,
): Promise<Readonly<{
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>> {
  const outerSource = `export default {
  async fetch(_request, env) {
    const worker = env.LOADER.load(${JSON.stringify(definition)});
    const stub = worker.getEntrypoint(${JSON.stringify(APPLICATION_RUNTIME_COLD_ENTRYPOINT)});
    const result = await stub.resolve();
    try {
      return Response.json(result);
    } finally {
      result[Symbol.dispose]?.();
    }
  },
};`;
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: outerSource,
    workerLoaders: { LOADER: {} },
  });
  instances.push(runtime);
  return runtime.dispatchFetch("https://runtime.test/");
}
