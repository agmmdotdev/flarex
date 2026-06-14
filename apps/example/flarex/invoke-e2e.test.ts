import { Miniflare } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { functionMetadata } from "./_generated/functionMetadata";
import { createBackendHarness, type BackendHarness } from "../../backend/test/backendHarness";
import type { DeploymentSchema } from "../../backend/src/types";

let backend: BackendHarness;
let app: Miniflare;
let appPersistPath: string;

const deploymentId = "example-e2e";
const partitionKey = "user:2:u1";

beforeAll(async () => {
  backend = await createBackendHarness();
  await deployExampleMetadata();

  appPersistPath = await mkdtemp(join(tmpdir(), "flarex-example-miniflare-"));
  app = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: await bundleGeneratedWorker(),
      },
    ],
    compatibilityDate: "2026-06-14",
    bindings: { FLAREX_DEPLOYMENT_ID: deploymentId },
    serviceBindings: {
      FLAREX_BACKEND: async (request: Request) =>
        backend.mf.dispatchFetch(request.url, {
          method: request.method,
          headers: Array.from(request.headers.entries()),
          body: await request.text(),
        }),
    },
    durableObjectsPersist: appPersistPath,
    durableObjects: {
      CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
    },
  });
});

afterAll(async () => {
  await app?.dispose();
  if (appPersistPath) await rm(appPersistPath, { recursive: true, force: true });
  await backend?.dispose();
});

describe("generated Worker invoke", () => {
  it("executes app functions through backend execution sessions", async () => {
    const complete = await invokeGeneratedWorker("lessons:complete", {
      userId: "2:u1",
      lessonId: "intro",
    });
    expect(complete).toMatchObject({ committedTs: 1 });
    expect(complete.writes).toHaveLength(1);
    expect(complete.writes[0]).toMatchObject({
      tableId: 1,
      value: { userId: "2:u1", lessonId: "intro", completed: true },
    });

    const list = await invokeGeneratedWorker("lessons:list", { userId: "2:u1" });
    expect(list.value).toEqual([
      expect.objectContaining({
        userId: "2:u1",
        lessonId: "intro",
        completed: true,
      }),
    ]);
    expect(list.readSet).toEqual({
      indexes: [
        expect.objectContaining({
          indexId: 1,
        }),
      ],
    });
  });

  it("rejects bad IDs before backend execution starts", async () => {
    const response = await app.dispatchFetch("http://flarex.example/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "lessons:list",
        partitionKey,
        args: { userId: "1:not-a-user" },
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "$args.userId: Expected an ID for table users, got an ID for table lessonProgress.",
    });
  });
});

async function invokeGeneratedWorker(path: string, args: unknown): Promise<any> {
  const response = await app.dispatchFetch("http://flarex.example/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, partitionKey, args }),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

async function deployExampleMetadata(): Promise<void> {
  await putBackend(`/deployments/${deploymentId}/schema`, exampleDeploymentSchema());
  await putBackend(`/deployments/${deploymentId}/functions`, { functions: functionMetadata });
}

async function putBackend(path: string, body: unknown): Promise<void> {
  const response = await backend.mf.dispatchFetch(`http://flarex.test${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
}

function exampleDeploymentSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "lessonProgress",
        validator: {
          type: "object",
          value: {
            userId: { fieldType: { type: "id", tableName: "users" }, optional: false },
            lessonId: { fieldType: { type: "string" }, optional: false },
            completed: { fieldType: { type: "boolean" }, optional: false },
          },
        },
        placement: { kind: "colocateWith", table: "users", field: "userId" },
      },
      {
        tableId: 2,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
        placement: { kind: "partitionBy", field: "_id" },
      },
    ],
    indexes: [
      {
        indexId: 1,
        tableId: 1,
        name: "by_user",
        fields: ["userId"],
      },
    ],
  };
}

async function bundleGeneratedWorker(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: { entry: "flarex/_generated/worker.ts", formats: ["es"], fileName: "worker" },
      rollupOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (!worker || worker.type !== "chunk") {
    throw new Error("Worker bundle was not emitted.");
  }
  return worker.code;
}
