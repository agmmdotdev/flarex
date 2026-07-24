import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pointMutationExactRuntimeWorkerSource } from "../src/artifactRuntime";

describe("point mutation exact-runtime workerd globals", () => {
  let runtime: Miniflare;

  beforeAll(() => {
    const exactRuntimeSource = pointMutationExactRuntimeWorkerSource({
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
          contents: `${exactRuntimeSource}
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
          path: "_flarex/execution.js",
          contents: "export default {};",
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
