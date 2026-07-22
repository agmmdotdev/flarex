/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const UPLOAD_ID = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";
const CEILINGS = budget(20, 100_000);
const ADMISSION = budget(1, 10_000);

describe("source artifact v2 DeploymentDO and R2 integration", () => {
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
        UPLOADS: { className: "SourceArtifactUploadTestDO", useSQLite: true },
      },
      r2Buckets: ["ARTIFACTS"],
    });
  }, 60_000);

  afterAll(async () => {
    await mf.dispose();
  });

  it("persists a gap-free upload across independent requests and publishes root last", async () => {
    const finalized = await completeUpload(UPLOAD_ID, "first");
    expect(finalized.state).toBe("finalized");
    const replay = await invoke("freshFinalize", command(
      10,
      "first-finalize",
      {},
      UPLOAD_ID,
    ));
    expect(replay).toEqual(finalized);
    const bucket = await mf.getR2Bucket("ARTIFACTS");
    const listed = await bucket.list({ prefix: "source-artifact-v2/" });
    const keys = listed.objects.map(object => object.key);
    expect(keys.some(key => key.includes("/source-block/"))).toBe(true);
    expect(keys.some(key => key.includes("/module/"))).toBe(true);
    expect(keys.some(key => key.includes("/completed-root/"))).toBe(true);
    expect(keys.some(key => key.includes("/upload-selector/"))).toBe(false);
  });

  it("converges immediate replay and rejects conflicting overlap without another object", async () => {
    const uploadId = "218f22e2-58cc-7b2a-91d8-f3f3401a0874";
    const replay = await completeUpload(uploadId, "conflict");
    expect(replay.state).toBe("finalized");
    const bucket = await mf.getR2Bucket("ARTIFACTS");
    const before = (await bucket.list({ prefix: "source-artifact-v2/" })).objects.length;
    const response = await rawInvoke("finalize", command(10, "conflict-finalize", {
      admission: budget(1, 9_999),
    }, uploadId));
    expect(response.status).toBe(409);
    expect((await bucket.list({ prefix: "source-artifact-v2/" })).objects).toHaveLength(before);
  });

  it("keeps abandoned attempts inert and creates no root", async () => {
    const uploadId = "118f22e2-58cc-7b2a-91d8-f3f3401a0874";
    await invoke("beginUpload", {
      uploadId,
      commandId: "begin-abandon",
      ceilings: CEILINGS,
      admission: ADMISSION,
    });
    const result = await invoke("abandon", {
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "abandon",
      admission: ADMISSION,
    });
    expect(result.state).toBe("abandoned");
    expect(result.completedRootDigest).toBeNull();
  });

  it("reconciles an applied SQLite transaction whose response is lost", async () => {
    const uploadId = "318f22e2-58cc-7b2a-91d8-f3f3401a0874";
    const recovered = await invoke("beginUploadCommittedResponseLoss", {
      uploadId,
      commandId: "lossy-begin",
      ceilings: CEILINGS,
      admission: ADMISSION,
    });
    expect(recovered.mutationFence).toBe(2);
    const replay = await invoke("beginUpload", {
      uploadId,
      commandId: "lossy-begin",
      ceilings: CEILINGS,
      admission: ADMISSION,
    });
    expect(replay).toEqual(recovered);
  });

  it("rejects malformed durable frontier evidence as stored corruption", async () => {
    const uploadId = "418f22e2-58cc-7b2a-91d8-f3f3401a0874";
    await completeUpload(uploadId, "corrupt");
    expect((await rawInvoke("corruptModuleFrontier", { uploadId })).status).toBe(200);
    expect((await rawInvoke("freshFinalize", command(
      10,
      "corrupt-finalize",
      {},
      uploadId,
    ))).status).toBe(409);
  });

  async function completeUpload(
    uploadId: string,
    prefix: string,
  ): Promise<Record<string, unknown>> {
    expect((await invoke("beginUpload", {
      uploadId,
      commandId: `${prefix}-begin`,
      ceilings: CEILINGS,
      admission: ADMISSION,
    })).mutationFence).toBe(2);
    expect((await invoke("beginModule", command(2, `${prefix}-module`, {
      path: "functions/main.js",
      roles: 9,
      environment: "isolate",
    }, uploadId))).mutationFence).toBe(4);
    expect((await invoke("appendBlock", command(4, `${prefix}-block`, {
      kind: "source",
      blockIndex: 0,
      bytes: [...new TextEncoder().encode("export default {};")],
    }, uploadId))).mutationFence).toBe(7);
    expect((await invoke("closeModule", command(
      7,
      `${prefix}-close`,
      {},
      uploadId,
    ))).mutationFence).toBe(10);
    return await invoke("finalize", command(10, `${prefix}-finalize`, {}, uploadId));
  }

  async function invoke(operation: string, input: unknown): Promise<Record<string, unknown>> {
    const response = await rawInvoke(operation, input);
    expect(response.status).toBe(200);
    const body = await response.json() as { success: Record<string, unknown> };
    return body.success;
  }

  async function rawInvoke(operation: string, input: unknown) {
    return await mf.dispatchFetch("https://source-artifact.test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
  }
});

function command(
  expectedFence: number,
  commandId: string,
  extra: Record<string, unknown> = {},
  uploadId = UPLOAD_ID,
) {
  return {
    uploadId,
    generation: 1,
    expectedFence,
    commandId,
    admission: ADMISSION,
    ...extra,
  };
}

function budget(calls: number, amount: number) {
  return {
    calls,
    blockBytes: amount,
    modules: amount,
    sourceMaps: amount,
    canonicalBytes: amount,
    frameBytes: amount,
    hashBytes: amount,
    timeMilliseconds: amount,
  };
}

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
        entry: join(backendDir, "test/sourceArtifactV2.workerd.worker.ts"),
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
    name: "flarex-source-artifact-test-resolution",
    resolveId(id) {
      if (id === "flarex" || id.startsWith("flarex/")) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
