import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DECLARATIVE_V2_APPLICATION_ERROR_ADMISSION_SOURCE_V1,
} from "@flarex/analysis/internal/declarative-v2-verifier-v1";

import {
  POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
  pointMutationExactRuntimeWorkerConfigurationSource,
  pointMutationExactRuntimeWorkerExecutionBridgeSource,
} from "../src/artifactRuntime";
import {
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";
import {
  POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1,
} from "../src/artifactRuntime/PointMutationRuntimeKernel.generated";
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
import {
  requirePointMutationArgumentSemanticSizeV1,
} from "flarex-protocol/point-mutation-start";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

const POINT_MUTATION_APPLICATION_ERROR_PLATFORM_SOURCE_V1 =
  applicationErrorPlatformSourceV1({
    runtimeKernelModulePath: `../${POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1}`,
    captureExportName: "capturePointMutationCoreApplicationErrorDataV1",
    captureProjectionExportName: "captureCoreApplicationErrorV1",
    invalid: { kind: "nativeError" },
  });

describe("point mutation exact-runtime workerd globals", () => {
  let runtime: Miniflare;

  beforeAll(() => {
    const exactRuntimeConfigurationSource =
      pointMutationExactRuntimeWorkerConfigurationSource({
      executionModule: "_flarex/execution.js",
      moduleTime: Date.UTC(2026, 6, 24),
      moduleRandomSeedHex: "a".repeat(64),
      });
    runtime = new Miniflare({
      compatibilityDate: "2026-06-18",
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: `${POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default {
  fetch() {
    const blocked = (operation) => {
      try {
        operation();
        return false;
      } catch {
        return true;
      }
    };
    const inheritedTimerBlocked = (name) => {
      let prototype = Object.getPrototypeOf(globalThis);
      while (prototype !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (descriptor !== undefined) {
          return blocked(() =>
            Reflect.apply(descriptor.value, globalThis, [() => undefined, 0])
          );
        }
        prototype = Object.getPrototypeOf(prototype);
      }
      return false;
    };
    return Response.json({
      setTimeout: blocked(() => setTimeout(() => undefined, 0)),
      inheritedSetTimeout: inheritedTimerBlocked("setTimeout"),
      setInterval: blocked(() => setInterval(() => undefined, 0)),
      inheritedSetInterval: inheritedTimerBlocked("setInterval"),
      fetch: blocked(() => fetch("https://example.com")),
      messageChannel: blocked(() => new MessageChannel()),
      webSocketPair: blocked(() => new WebSocketPair()),
      file: blocked(() => new File([], "ambient-time.txt")),
      webAssemblyCompile: blocked(() =>
        WebAssembly.compile(new Uint8Array())
      ),
      cache: blocked(() => caches.default.match("https://example.com")),
      cryptoDigest: blocked(() =>
        crypto.subtle.digest("SHA-256", new Uint8Array())
      ),
    });
  },
};`,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: exactRuntimeConfigurationSource,
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerExecutionBridgeSource(
            "_flarex/execution.js",
          ),
        },
        {
          type: "ESModule",
          path: POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
          contents: POINT_MUTATION_APPLICATION_ERROR_PLATFORM_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
          contents: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
        },
        {
          type: "ESModule",
          path: "_flarex/execution.js",
          contents: `
let timerWasBlocked = false;
try {
  setTimeout(() => undefined, 0);
} catch {
  timerWasBlocked = true;
}
if (!timerWasBlocked) {
  throw new Error("Application module evaluated before timer hardening.");
}
if (Date.now() !== ${Date.UTC(2026, 6, 24)}) {
  throw new Error("Application module evaluated before deterministic time.");
}
export default {};`,
        },
      ],
    });
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("neutralizes own and inherited foreign-completion capabilities", async () => {
    const response = await runtime.dispatchFetch("https://exact-runtime.test/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      setTimeout: true,
      inheritedSetTimeout: true,
      setInterval: true,
      inheritedSetInterval: true,
      fetch: true,
      messageChannel: true,
      webSocketPair: true,
      file: true,
      webAssemblyCompile: true,
      cache: true,
      cryptoDigest: true,
    });
  });

  it.each([
    {
      label: "missing function",
      path: "orders:missing",
      functionSource: `{
        isMutation: true,
        isPublic: true,
        _handler: () => null,
      }`,
      argumentsValue: {},
      argsValidator: { type: "object", value: {} },
      expectedName: "PointMutationExactRuntimeWorkerDefinitionV1Error",
    },
    {
      label: "invalid function metadata",
      path: "orders:complete",
      functionSource: `{
        isMutation: true,
        isInternal: true,
        _handler: () => null,
      }`,
      argumentsValue: {},
      argsValidator: { type: "object", value: {} },
      expectedName: "PointMutationExactRuntimeWorkerDefinitionV1Error",
    },
    {
      label: "invalid arguments",
      path: "orders:complete",
      functionSource: `{
        isMutation: true,
        isPublic: true,
        _handler: () => null,
      }`,
      argumentsValue: { status: 42 },
      argsValidator: {
        type: "object",
        value: {
          status: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
      expectedName: "PointMutationExactRuntimeInvalidRequestV1Error",
    },
  ] as const)(
    "preserves the $label contract classification through workerd",
    async (scenario) => {
      await expect(runContractFailureScenario(scenario)).resolves.toMatchObject({
        name: scenario.expectedName,
        portableName: "PointMutationRuntimeContractV1Error",
      });
    },
  );

  it("propagates the public FlarexError after the mutation journal settles", async () => {
    await expect(runContractFailureScenario({
      path: "orders:complete",
      executionImports: 'import { FlarexError } from "flarex/values";',
      functionSource: `{
        isMutation: true,
        isPublic: true,
        _handler: () => { throw new FlarexError("CLOSED", "closed", { orderId: "order-1" }); },
      }`,
      argumentsValue: {},
      argsValidator: { type: "object", value: {} },
    })).resolves.toMatchObject({
      name: "applicationError",
      error: {
        code: "CLOSED",
        message: "closed",
        data: { orderId: "order-1" },
      },
    });
  });

  it("uses the shared auth facade and returns a fresh identity per call", async () => {
    await expect(runContractFailureScenario({
      path: "orders:complete",
      functionSource: `{
        isMutation: true,
        isPublic: true,
        _handler: async (context) => {
          const first = await context.auth.getUserIdentity();
          first.role = "changed";
          const second = await context.auth.getUserIdentity();
          return {
            same: first === second,
            firstRole: first.role,
            secondRole: second.role,
            contextKeys: Object.keys(context),
            dbKeys: Object.keys(context.db),
          };
        },
      }`,
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "token-clone",
          subject: "user-clone",
          issuer: "https://auth.example.com",
          role: "admin",
        },
      },
      argumentsValue: {},
      argsValidator: { type: "object", value: {} },
    })).resolves.toEqual({
      name: "success",
      result: {
        format: "flarex.point-mutation-exact-runtime-result",
        version: 1,
        value: {
          same: false,
          firstRole: "changed",
          secondRole: "admin",
          contextKeys: ["auth", "db"],
          dbKeys: [
            "get",
            "insert",
            "patch",
            "replace",
            "delete",
            "queryIndexRange",
          ],
        },
      },
    });
  });

  it("uses the protocol-owned runtime value semantics in generated Workerd code", async () => {
    await expect(runContractFailureScenario({
      path: "orders:complete",
      functionSource: `{
        isMutation: true,
        isPublic: true,
        _handler: () => ({ kept: "value", omitted: undefined }),
      }`,
      argumentsValue: {},
      argsValidator: { type: "object", value: {} },
    })).resolves.toEqual({
      name: "success",
      result: {
        format: "flarex.point-mutation-exact-runtime-result",
        version: 1,
        value: { kept: "value" },
      },
    });
  });

  it("executes the exact analyzer-admitted caught FlarexError source", async () => {
    await expect(runContractFailureScenario({
      path: "orders:complete",
      functionSource: "",
      applicationModuleSource:
        DECLARATIVE_V2_APPLICATION_ERROR_ADMISSION_SOURCE_V1,
      argumentsValue: {},
      argsValidator: { type: "object", value: {} },
    })).resolves.toEqual({
      name: "success",
      result: {
        format: "flarex.point-mutation-exact-runtime-result",
        version: 1,
        value: ["ORDER_CLOSED", "Order is closed.", null],
      },
    });
  });
});

async function runContractFailureScenario(
  scenario: Readonly<{
    readonly path: string;
    readonly functionSource: string;
    readonly executionImports?: string;
    readonly applicationModuleSource?: string;
    readonly auth?: unknown;
    readonly argumentsValue: Readonly<Record<string, unknown>>;
    readonly argsValidator: unknown;
  }>,
): Promise<unknown> {
  const exactRuntimeConfigurationSource =
    pointMutationExactRuntimeWorkerConfigurationSource({
      executionModule: "_flarex/execution.js",
      moduleTime: Date.UTC(2026, 6, 24),
      moduleRandomSeedHex: "a".repeat(64),
    });
  const normalizedArguments = normalizeFlarexValueV1(
    scenario.argumentsValue,
  );
  const serializedRequest = JSON.stringify({
    format: "flarex.point-mutation-exact-runtime",
    version: 1,
    artifact: {
      runtime: "dynamic-worker",
      artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    function: {
      path: scenario.path,
      executionModule: "_flarex/execution.js",
      kind: "mutation",
      visibility: "public",
      argsValidator: scenario.argsValidator,
      returnsValidator: null,
    },
    auth: scenario.auth === undefined
      ? { kind: "anonymous" }
      : scenario.auth,
    arguments: scenario.argumentsValue,
    argumentArraySemanticBytes:
      requirePointMutationArgumentSemanticSizeV1(
        normalizedArguments.semanticSizeBytes,
      ),
    tables: [{ tableId: 1, logicalName: "orders" }],
    context: {
      executionId: "execution-1",
      logScopeId: "log-scope-1",
      randomSeed: Array.from(new Uint8Array(32).fill(5)),
      executionTime: 100,
      initialCreationTimeCursor: 100,
    },
  });
  const worker = new Miniflare({
    compatibilityDate: "2026-06-18",
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: `${POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default {
  async fetch() {
    const input = ${serializedRequest};
    input.context.randomSeed = new Uint8Array(input.context.randomSeed);
    try {
      const result = await Reflect.apply(
        FlarexPointMutationExactRuntimeV1.prototype.run,
        {},
        [input, {
          resolvePointTable() {
            throw new Error("journal must not open");
          },
        }],
      );
      return result.kind === "applicationError"
        ? Response.json({ name: "applicationError", error: result.error })
        : Response.json({ name: "success", result: result.result });
    } catch (error) {
      return Response.json({
        name: error?.name,
        message: error?.message,
        portableName: error?.cause?.name,
      });
    }
  },
};`,
      },
      {
        type: "ESModule",
        path: POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
        contents: exactRuntimeConfigurationSource,
      },
      {
        type: "ESModule",
        path: POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        contents: pointMutationExactRuntimeWorkerExecutionBridgeSource(
          "_flarex/execution.js",
        ),
      },
      {
        type: "ESModule",
        path: POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
        contents: POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: FUNCTION_API_CORE_MODULE_V1,
        contents: FUNCTION_API_CORE_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
        contents: POINT_MUTATION_APPLICATION_ERROR_PLATFORM_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
        contents: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: "_flarex/execution.js",
        contents: `import { ${scenario.applicationModuleSource === undefined
          ? "complete"
          : "getThing"} } from "../orders.js";
export default {
  orders: {
    complete: ${scenario.applicationModuleSource === undefined
      ? "complete"
      : "{ isMutation: true, isPublic: true, _handler: getThing }"},
  },
};`,
      },
      {
        type: "ESModule",
        path: "orders.js",
        contents: scenario.applicationModuleSource ??
          `${scenario.executionImports ?? ""}
export const complete = ${scenario.functionSource};`,
      },
    ],
  });
  try {
    const response = await worker.dispatchFetch(
      "https://exact-runtime.test/contract",
    );
    return await response.json();
  } finally {
    await worker.dispose();
  }
}
