import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  buildPointQueryExactRuntimeWorkerDefinitionV1,
  POINT_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_QUERY_RUNTIME_KERNEL_MODULE_V1,
  pointQueryExactRuntimeExecutionBridgeSourceV1,
  pointQueryExactRuntimeWorkerConfigurationSourceV1,
} from "../src/artifactRuntime";
import {
  POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "../src/artifactRuntime/PointQueryExactRuntimeWorkerCore.generated";
import {
  POINT_QUERY_RUNTIME_KERNEL_SOURCE_V1,
} from "../src/artifactRuntime/PointQueryRuntimeKernel.generated";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
  applicationErrorPlatformSourceV1,
} from "../src/artifactRuntime/ApplicationErrorExactRuntimeWorkerSource";
import {
  FUNCTION_API_CORE_MODULE_V1,
  FUNCTION_API_CORE_SOURCE_V1,
} from "../src/artifactRuntime/FunctionApiCore.generated";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

describe("point-query exact runtime in workerd", () => {
  it("installs one private error registry behind the public values facade", () => {
    const definition = buildPointQueryExactRuntimeWorkerDefinitionV1({
      artifact: {
        runtime: "dynamic-worker",
        artifactId: `artifact_${"b".repeat(32)}`,
        sourcePackageHash: "b".repeat(64),
        executionModule: "orders.js",
      },
      compatibilityDate: "2026-06-11",
      runtimeTargetSha256Hex: "a".repeat(64),
      function: {
        path: "orders:get",
        executionModule: "orders.js",
        kind: "query",
        visibility: "public",
        argsValidator: { type: "any" },
        returnsValidator: null,
      },
      snapshotCommitSeq: 7n,
      functionPath: "orders:get",
      artifactExecutionModule: "orders.js",
      exportName: "get",
      sourceModules: [{ path: "orders.js", source: "export function get(){}" }],
    });
    expect(Object.hasOwn(definition.modules, APPLICATION_ERROR_PLATFORM_MODULE_V1))
      .toBe(true);
    expect(Object.hasOwn(definition.modules, APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1))
      .toBe(true);
    expect(Object.hasOwn(definition.modules, FUNCTION_API_CORE_MODULE_V1))
      .toBe(true);
  });

  it("constructs the public FlarexError in the exact Worker registry", async () => {
    await expect(runScenario({
      imports: 'import { FlarexError } from "flarex/values";',
      handler: 'async () => { throw new FlarexError("CLOSED", "closed"); }',
      capability: "async () => ({ kind: 'missing' })",
    })).resolves.toMatchObject({
      ok: false,
      name: "FlarexError",
      message: "closed",
      readAttempts: 0,
    });
  });

  it("executes the exact query handler through its read capability", async () => {
    await expect(runScenario({
      handler: "async (context, { id }) => context.db.get(id)",
      capability: "async () => ({ kind: 'present', document: { status: 'open' } })",
    })).resolves.toEqual({
      ok: true,
      readAttempts: 1,
      result: {
        format: "flarex.point-query-exact-runtime-result",
        version: 1,
        value: { status: "open" },
      },
    });

    await expect(runScenario({
      handler: "async (context) => Object.keys(context.db)",
      capability: "async () => ({ kind: 'missing' })",
    })).resolves.toMatchObject({
      ok: true,
      result: { value: ["get"] },
    });

    await expect(runScenario({
      handler: "async (context) => Object.keys(context)",
      capability: "async () => ({ kind: 'missing' })",
    })).resolves.toMatchObject({
      ok: true,
      result: { value: ["auth", "db"] },
    });

    await expect(runScenario({
      handler: "async (context) => context.auth.getUserIdentity()",
      capability: "async () => ({ kind: 'missing' })",
    })).resolves.toMatchObject({
      ok: true,
      result: { value: null },
    });

    await expect(runScenario({
      handler: "async (context) => context.auth.getUserIdentity()",
      capability: "async () => ({ kind: 'missing' })",
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "token-1",
          subject: "user-1",
          issuer: "https://auth.example.com",
          role: "admin",
        },
      },
    })).resolves.toMatchObject({
      ok: true,
      result: { value: { subject: "user-1", role: "admin" } },
    });

    await expect(runScenario({
      handler: "async (context) => { const first = await context.auth.getUserIdentity(); first.role = 'changed'; const second = await context.auth.getUserIdentity(); return { same: first === second, firstRole: first.role, secondRole: second.role }; }",
      capability: "async () => ({ kind: 'missing' })",
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "token-clone",
          subject: "user-clone",
          issuer: "https://auth.example.com",
          role: "admin",
        },
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        value: {
          same: false,
          firstRole: "changed",
          secondRole: "admin",
        },
      },
    });

    await expect(runScenario({
      handler: "async (context) => { const user = await context.auth.getUserIdentity(); return { ownsName: Object.hasOwn(user, 'name') }; }",
      capability: "async () => ({ kind: 'missing' })",
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "token-2",
          subject: "user-2",
          issuer: "https://auth.example.com",
        },
      },
      authOwnUndefined: true,
    })).resolves.toMatchObject({
      ok: true,
      result: { value: { ownsName: true } },
    });
  });

  it("keeps caught host reads terminal and rejects forbidden writes", async () => {
    await expect(runScenario({
      handler: "async (context, args) => { try { await context.db.get(args.id); } catch {} return null; }",
      capability: "() => { throw new Error('read host unavailable'); }",
    })).resolves.toMatchObject({
      ok: false,
      name: "PointQueryExactRuntimeReadBoundaryV1Error",
    });

    await expect(runScenario({
      handler: "async (context) => { try { await context.db.get('invalid'); } catch {} return null; }",
      capability: "async () => { throw new Error('charged invalid read'); }",
    })).resolves.toMatchObject({
      ok: false,
      name: "PointQueryExactRuntimeReadBoundaryV1Error",
      readAttempts: 1,
    });

    await expect(runScenario({
      handler: "async () => null",
      capability: "async () => ({ kind: 'missing' })",
      revalidate: "async () => { throw new Error('superseded active revision'); }",
    })).resolves.toMatchObject({
      ok: false,
      name: "PointQueryExactRuntimeReadBoundaryV1Error",
      readAttempts: 0,
    });

    await expect(runScenario({
      handler: "async (context) => context.db.insert('orders', {})",
      capability: "async () => ({ kind: 'missing' })",
    })).resolves.toMatchObject({
      ok: false,
      name: "PointQueryExactRuntimeUserCodeV1Error",
    });

    await expect(runScenario({
      handler: "async () => null",
      capability: "async () => ({ kind: 'missing' })",
      runtimeTargetFill: 0xab,
    })).resolves.toMatchObject({
      ok: false,
      name: "PointQueryExactRuntimeInvalidRequestV1Error",
    });
  });

  it.each(["artifact", "function", "validator", "semanticBytes", "tables",
    "snapshot"] as const)("rejects %s contract drift", async requestMutation => {
    await expect(runScenario({
      handler: "async () => null",
      capability: "async () => ({ kind: 'missing' })",
      requestMutation,
    })).resolves.toMatchObject({
      ok: false,
      name: "PointQueryExactRuntimeInvalidRequestV1Error",
    });
  });

  it("accepts protocol-equivalent object key order", async () => {
    await expect(runScenario({
      handler: "async () => null",
      capability: "async () => ({ kind: 'missing' })",
      requestMutation: "keyOrder",
    })).resolves.toMatchObject({ ok: true, result: { value: null } });
  });
});

async function runScenario(input: Readonly<{
  readonly imports?: string;
  readonly handler: string;
  readonly capability: string;
  readonly runtimeTargetFill?: number;
  readonly auth?: unknown;
  readonly authOwnUndefined?: boolean;
  readonly revalidate?: string;
  readonly requestMutation?:
    | "artifact" | "function" | "validator"
    | "semanticBytes" | "tables" | "snapshot" | "keyOrder";
}>): Promise<unknown> {
  const argumentsValue = { id: "1:00000000-0000-0000-0000-000000000001" };
  const configuredArtifact = {
    runtime: "dynamic-worker" as const,
    artifactId: `artifact_${"b".repeat(32)}`,
    sourcePackageHash: "b".repeat(64),
    executionModule: "orders.js",
  };
  const configuredFunction = {
    path: "orders:get", executionModule: "orders.js", kind: "query" as const,
    visibility: "public" as const,
    argsValidator: {
      type: "object" as const,
      value: {
        id: {
          fieldType: { type: "string" as const },
          optional: false,
        },
      },
    },
    returnsValidator: null,
  };
  const artifact = input.requestMutation === "artifact"
    ? { ...configuredArtifact, executionModule: "other.js" }
    : configuredArtifact;
  const functionProjection = input.requestMutation === "function"
    ? { ...configuredFunction, path: "orders:other" }
    : input.requestMutation === "validator"
    ? { ...configuredFunction, argsValidator: { type: "string" as const } }
    : input.requestMutation === "keyOrder"
    ? {
        returnsValidator: null,
        argsValidator: {
          value: {
            id: {
              optional: false,
              fieldType: { type: "string" as const },
            },
          },
          type: "object" as const,
        },
        visibility: "public" as const,
        kind: "query" as const,
        executionModule: "orders.js",
        path: "orders:get",
      }
    : configuredFunction;
  const tables = input.requestMutation === "tables"
    ? [{ tableId: 1, logicalName: "orders" },
      { tableId: 1, logicalName: "duplicate" }]
    : [{ tableId: 1, logicalName: "orders" }];
  const request = {
    format: "flarex.point-query-exact-runtime",
    version: 1,
    runtimeTargetSha256: Array.from(new Uint8Array(32).fill(
      input.runtimeTargetFill ?? 0xaa,
    )),
    artifact,
    function: functionProjection,
    auth: input.auth ?? { kind: "anonymous" },
    arguments: argumentsValue,
    argumentSemanticBytes: normalizeFlarexValueV1(argumentsValue).semanticSizeBytes +
      (input.requestMutation === "semanticBytes" ? 1 : 0),
    tables,
    context: {
      executionId: "query-1", randomSeed: Array(32).fill(3),
      executionTime: 100,
    },
  };
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-11",
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: `${POINT_QUERY_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default {
  async fetch() {
    const request = ${JSON.stringify(request)};
    request.runtimeTargetSha256 = new Uint8Array(request.runtimeTargetSha256);
    request.context.randomSeed = new Uint8Array(request.context.randomSeed);
    request.context.snapshotCommitSeq = ${input.requestMutation === "snapshot" ? "8n" : "7n"};
    if (${input.authOwnUndefined === true}) request.auth.user.name = undefined;
    let readAttempts = 0;
    const readPointDocument = ${input.capability};
    const capability = {
      revalidate: ${input.revalidate ?? "async () => undefined"},
      readPointDocument: (...args) => {
        readAttempts += 1;
        return Reflect.apply(readPointDocument, undefined, args);
      },
    };
    try {
      const result = await Reflect.apply(
        FlarexPointQueryExactRuntimeV1.prototype.run,
        {},
        [request, capability],
      );
      return Response.json({ ok: true, result, readAttempts });
    } catch (error) {
      return Response.json({
        ok: false,
        name: error?.name,
        message: error?.message,
        readAttempts,
      });
    }
  },
};`,
      },
      {
        type: "ESModule",
        path: POINT_QUERY_EXACT_RUNTIME_CONFIG_MODULE_V1,
        contents: pointQueryExactRuntimeWorkerConfigurationSourceV1({
          moduleTime: Date.UTC(2026, 5, 11),
          runtimeTargetSha256Hex: "aa".repeat(32),
          artifact: configuredArtifact,
          function: configuredFunction,
          snapshotCommitSeq: 7n,
        }),
      },
      {
        type: "ESModule",
        path: POINT_QUERY_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        contents: pointQueryExactRuntimeExecutionBridgeSourceV1(
          "orders.js", "get", "orders:get",
        ),
      },
      {
        type: "ESModule",
        path: POINT_QUERY_RUNTIME_KERNEL_MODULE_V1,
        contents: POINT_QUERY_RUNTIME_KERNEL_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: FUNCTION_API_CORE_MODULE_V1,
        contents: FUNCTION_API_CORE_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
        contents: applicationErrorPlatformSourceV1({
          runtimeKernelModulePath: `../${POINT_QUERY_RUNTIME_KERNEL_MODULE_V1}`,
          captureExportName: "capturePointQueryCoreApplicationErrorDataV1",
          invalid: { kind: "nativeError" },
        }),
      },
      {
        type: "ESModule",
        path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
        contents: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: "orders.js",
        contents: `${input.imports ?? ""}\nexport const get = ${input.handler};`,
      },
    ],
  });
  try {
    const response = await runtime.dispatchFetch("https://query-runtime.test/");
    return await response.json();
  } finally {
    await runtime.dispose();
  }
}
