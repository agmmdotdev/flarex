import { afterEach, describe, expect, it, vi } from "vitest";
import { createMinimalFlarexProject } from "./fixtures";

const fsMockState = vi.hoisted(() => ({
  failDefaultPersistCleanup: false,
}));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (target: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      const normalizedTarget = String(target).replaceAll("\\", "/");
      if (
        fsMockState.failDefaultPersistCleanup &&
        normalizedTarget.endsWith("/.flarex/dev")
      ) {
        throw new Error("mock default persist cleanup failed");
      }
      return actual.rm(target, options);
    },
  };
});

describe("Flarex dev runtime disposal", () => {
  afterEach(() => {
    fsMockState.failDefaultPersistCleanup = false;
  });

  it("reports default persist cleanup failures during normal dispose", async () => {
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const root = await createMinimalFlarexProject("flarex-dev-dispose-");
    const { createFlarexDevRuntime } = await import("../src/dev");
    const runtime = await createFlarexDevRuntime({
      root,
      deploymentId: "dev-runtime-dispose-failure",
    });

    try {
      fsMockState.failDefaultPersistCleanup = true;
      await expect(runtime.dispose()).rejects.toThrow(
        "mock default persist cleanup failed",
      );
    } finally {
      fsMockState.failDefaultPersistCleanup = false;
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 60000);
});
