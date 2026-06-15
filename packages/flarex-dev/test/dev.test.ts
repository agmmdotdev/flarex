import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFlarexDevRuntime, type FlarexDevRuntime } from "../src/dev";

let runtime: FlarexDevRuntime;
let persistDir: string;

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), "flarex-dev-runtime-"));
  runtime = await createFlarexDevRuntime({
    root: resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/example"),
    deploymentId: "dev-runtime-test",
    persistDir,
  });
});

afterAll(async () => {
  await runtime?.dispose();
  if (persistDir) await rm(persistDir, { recursive: true, force: true });
});

describe("Flarex dev runtime", () => {
  it("exposes health for the generated app and backend", async () => {
    const response = await runtime.fetch(new Request("http://localhost/__flarex_dev/health"));
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      service: "flarex-dev",
      status: "ok",
      deploymentId: "dev-runtime-test",
      backend: { service: "flarex-backend", status: "ok" },
      app: { service: "flarex", status: "ok" },
    });
  });

  it("proxies invoke through the generated Worker path", async () => {
    const response = await runtime.fetch(
      new Request("http://localhost/__flarex_dev/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "lessons:complete",
          partitionKey: "user:2:u1",
          args: { userId: "2:u1", lessonId: "dev-runtime" },
        }),
      }),
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      committedTs: 1,
      writes: [
        expect.objectContaining({
          tableId: 1,
          value: { userId: "2:u1", lessonId: "dev-runtime", completed: true },
        }),
      ],
    });
  });
});
