import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import {
  EDGE_ACTION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  EDGE_ACTION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  EDGE_ACTION_RUNTIME_KERNEL_MODULE_V1,
} from "../src/artifactRuntime/EdgeActionExactRuntimeHost";
import {
  EDGE_ACTION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "../src/artifactRuntime/EdgeActionExactRuntimeWorkerCore.generated";
import {
  edgeActionExactRuntimeExecutionBridgeSourceV1,
  edgeActionExactRuntimeWorkerConfigurationSourceV1,
} from "../src/artifactRuntime/EdgeActionExactRuntimeWorkerSource";
import {
  EDGE_ACTION_RUNTIME_KERNEL_SOURCE_V1,
} from "../src/artifactRuntime/EdgeActionRuntimeKernel.generated";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";

describe("edge-action exact runtime in workerd", () => {
  it("executes a candidate action with authenticated query and mutation callbacks", async () => {
    await expect(runScenario(`async (context, args) => {
      const query = await context.runQuery("orders:get", { id: args.id });
      const mutation = await context.runMutation("orders:update", { id: args.id });
      const user = await context.auth.getUserIdentity();
      return { query, mutation, subject: user.subject };
    }`)).resolves.toEqual({
      ok: true,
      calls: ["runQuery:1:orders:get", "runMutation:2:orders:update"],
      result: {
        format: "flarex.edge-action-exact-runtime-result",
        version: 1,
        value: {
          query: { found: true },
          mutation: { committed: true },
          subject: "user-1",
        },
      },
    });
  });

  it("pins time/random, rejects nondeterministic crypto, and admits one run", async () => {
    const response = await runScenario(`async () => {
      let cryptoDenied = false;
      try { crypto.randomUUID(); } catch { cryptoDenied = true; }
      return { now: Date.now(), random: Math.random(), cryptoDenied };
    }`, true);
    expect(response).toMatchObject({
      ok: true,
      secondRunName: "EdgeActionExactRuntimeInvalidRequestV1Error",
      result: { value: { now: 1234, cryptoDenied: true } },
    });
  });
});

async function runScenario(handler: string, secondRun = false): Promise<unknown> {
  const args = { id: "order-1" };
  const artifact = {
    runtime: "dynamic-worker" as const,
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    executionModule: "flarexCandidateBoundEdgeActionRuntime/execution-v1.js",
  };
  const functionProjection = {
    path: "orders:place",
    executionModule: artifact.executionModule,
    kind: "action" as const,
    visibility: "public" as const,
    argsValidator: { type: "any" as const },
    returnsValidator: null,
  };
  const request = {
    format: "flarex.edge-action-exact-runtime",
    version: 1,
    exactRuntimeProfile: "edge-action-exact-runtime-v1",
    syscallAbiIdentity: "flarex.system/edge-action-syscall-abi/v1",
    artifact,
    function: functionProjection,
    auth: {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "issuer",
      },
    },
    arguments: args,
    argumentSemanticBytes: normalizeFlarexValueV1(args).semanticSizeBytes,
    context: {
      executionId: "execution-1",
      invocationId: "invocation-1",
      executionGeneration: "1n",
      executionTime: 1234,
      executionDeadline: 31_234,
      randomSeed: Array(32).fill(3),
      runtimeTargetSha256: Array(32).fill(0xaa),
      hostPolicySha256: Array(32).fill(0xbb),
    },
  };
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: `${EDGE_ACTION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default {
  async fetch() {
    const request = ${JSON.stringify(request)};
    request.context.executionGeneration = 1n;
    request.context.randomSeed = new Uint8Array(request.context.randomSeed);
    request.context.runtimeTargetSha256 = new Uint8Array(request.context.runtimeTargetSha256);
    request.context.hostPolicySha256 = new Uint8Array(request.context.hostPolicySha256);
    const calls = [];
    const callback = {
      invoke(operation) {
        calls.push(operation.kind + ":" + operation.ordinal + ":" + operation.functionPath);
        return operation.kind === "runQuery"
          ? { found: true }
          : { committed: true };
      },
    };
    try {
      const result = await Reflect.apply(
        FlarexEdgeActionExactRuntimeV1.prototype.run,
        {},
        [request, callback],
      );
      let secondRunName;
      if (${secondRun}) {
        try {
          await Reflect.apply(
            FlarexEdgeActionExactRuntimeV1.prototype.run,
            {},
            [request, callback],
          );
        } catch (error) { secondRunName = error?.name; }
      }
      return Response.json({ ok: true, result, calls, secondRunName });
    } catch (error) {
      return Response.json({ ok: false, name: error?.name, calls });
    }
  },
};`,
      },
      {
        type: "ESModule",
        path: EDGE_ACTION_EXACT_RUNTIME_CONFIG_MODULE_V1,
        contents: edgeActionExactRuntimeWorkerConfigurationSourceV1({
          runtimeTargetSha256Hex: "aa".repeat(32),
          hostPolicySha256Hex: "bb".repeat(32),
          artifact,
          function: functionProjection,
          moduleTime: 1234,
          maximumArgumentBytes: 1_048_576,
          maximumResultBytes: 1_048_576,
          maximumSyscalls: 64,
          maximumCallbackArgumentBytes: 1_048_576,
          maximumCallbackResultBytes: 1_048_576,
        }),
      },
      {
        type: "ESModule",
        path: EDGE_ACTION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
        contents: edgeActionExactRuntimeExecutionBridgeSourceV1(
          "orders.js",
          "place",
          "orders:place",
        ),
      },
      {
        type: "ESModule",
        path: EDGE_ACTION_RUNTIME_KERNEL_MODULE_V1,
        contents: EDGE_ACTION_RUNTIME_KERNEL_SOURCE_V1,
      },
      {
        type: "ESModule",
        path: "orders.js",
        contents: `export const place = ${handler};`,
      },
    ],
  });
  try {
    const response = await runtime.dispatchFetch("https://edge-action.test/");
    return await response.json();
  } finally {
    await runtime.dispose();
  }
}
