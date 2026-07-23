/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Semantic Artifact V1 DeploymentDO SQLite and R2", () => {
  let mf: Miniflare;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: [{
        type: "ESModule",
        path: "worker.js",
        contents: await bundleWorker(),
      }],
      compatibilityDate: "2026-06-14",
      durableObjects: {
        SEMANTIC: { className: "SemanticArtifactTestDO", useSQLite: true },
      },
      r2Buckets: ["ARTIFACTS"],
    });
  }, 60_000);

  afterAll(async () => {
    await mf.dispose();
  });

  it("creates the additive schema with the local RESTRICT source FK", async () => {
    const response = await invoke("schema");
    expect(response.table).toEqual([{ name: "semantic_artifact_upload_attempts_v1" }]);
    expect(response.foreignKeys).toContainEqual(expect.objectContaining({
      table: "source_artifact_upload_attempts_v2",
      on_delete: "RESTRICT",
    }));
  });

  it("round-trips canonical attempt evidence and the distinct immutable namespace", async () => {
    const response = await invoke("roundtrip");
    expect(response).toEqual({
      semanticUploadId: "semantic-upload",
      objectKey: expect.stringMatching(/^semantic-artifact-v1\/block\/[0-9a-f]{64}$/),
      body: "semantic bytes\n",
    });
    const bucket = await mf.getR2Bucket("ARTIFACTS");
    const objects = await bucket.list({ prefix: "semantic-artifact-v1/" });
    expect(objects.objects).toHaveLength(1);
  });

  it("admits stored attempt bytes metadata-first at the exact ceiling", async () => {
    expect(await invoke("budget")).toEqual({
      storedBytes: expect.any(Number),
      exact: true,
      oneLess: true,
      exactWrite: true,
      oneLessWrite: true,
    });
  });

  it("reads only exact finalized source-correlation scalars after metadata admission", async () => {
    expect(await invoke("source")).toEqual({
      exact: true,
      oneLess: true,
    });
  });

  it("fails closed when a normalized column drifts from the canonical attempt frame", async () => {
    const response = await invoke("corrupt");
    expect(response).toEqual({ failed: true });
  });

  it("upgrades an existing DeploymentDO schema additively and idempotently", async () => {
    expect(await invoke("upgrade")).toEqual({ version: "1" });
    expect((await invoke("schema")).table).toEqual([
      { name: "semantic_artifact_upload_attempts_v1" },
    ]);
  });

  async function invoke(operation: string): Promise<Record<string, unknown>> {
    const response = await mf.dispatchFetch("https://semantic.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation }),
    });
    expect(response.status).toBe(200);
    return await response.json() as Record<string, unknown>;
  }
});

async function bundleWorker(): Promise<string> {
  const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(backendDir, "test/semanticArtifactV1.workerd.worker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") throw new Error("Worker bundle missing.");
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-semantic-artifact-test-resolution",
    resolveId(id) {
      if (
        id === "flarex" || id.startsWith("flarex/") ||
        id === "flarex-protocol" || id.startsWith("flarex-protocol/")
      ) return fileURLToPath(import.meta.resolve(id));
      return undefined;
    },
  };
}
