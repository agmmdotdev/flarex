import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  pointMutationExactRuntimeWorkerConfigurationSource,
  pointMutationExactRuntimeWorkerExecutionBridgeSource,
} from "../src/artifactRuntime";
import {
  POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1,
} from "../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";

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
});
