import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFlarexDevRuntime, type FlarexDevRuntime } from "../src/dev";
import { createMinimalFlarexProject } from "./fixtures";

type MiniflareWebSocket = {
  accept(): void;
  send(message: string): void;
  close(): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
    options?: { once?: boolean },
  ): void;
  addEventListener(
    type: "error",
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ): void;
};

let runtime: FlarexDevRuntime;
let persistDir: string;

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedTypecheckOptions = {
  typescriptCliPath: "node_modules/typescript/bin/tsc",
  cwd: workspaceRoot,
  compilerOptions: {
    paths: {
      flarex: ["packages/flarex/src/index.ts"],
      "flarex/*": ["packages/flarex/src/*"],
    },
  },
};

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), "flarex-dev-runtime-"));
  runtime = await createFlarexDevRuntime({
    root: resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/example"),
    deploymentId: "dev-runtime-test",
    persistDir,
    typecheckGeneratedOutput: generatedTypecheckOptions,
  });
});

afterAll(async () => {
  await runtime?.dispose();
  if (persistDir) await rm(persistDir, { recursive: true, force: true });
});

describe("Flarex dev runtime", () => {
  it("fails startup before activation when generated output typecheck fails", async () => {
    const failedPersistDir = await mkdtemp(join(tmpdir(), "flarex-dev-typecheck-failure-"));
    try {
      await expect(createFlarexDevRuntime({
        root: resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/example"),
        deploymentId: "dev-runtime-typecheck-failure",
        persistDir: failedPersistDir,
        typecheckGeneratedOutput: {
          ...generatedTypecheckOptions,
          typescriptCliPath: "node_modules/typescript/bin/not-tsc.js",
        },
      })).rejects.toThrow("Generated output typecheck failed.");
    } finally {
      await rm(failedPersistDir, { recursive: true, force: true });
    }
  }, 60000);

  it("cleans the default dev persist directory after startup typecheck failure", async () => {
    const root = await createMinimalFlarexProject("flarex-dev-typecheck-cleanup-");
    try {
      await expect(createFlarexDevRuntime({
        root,
        deploymentId: "dev-runtime-typecheck-cleanup",
        typecheckGeneratedOutput: {
          ...generatedTypecheckOptions,
          typescriptCliPath: "node_modules/typescript/bin/not-tsc.js",
        },
      })).rejects.toThrow("Generated output typecheck failed.");

      await expect(pathExists(join(root, ".flarex/dev"))).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);

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

  it("deploys local metadata through the backend push lifecycle", async () => {
    const response = await runtime.fetch(new Request("http://localhost/__flarex_dev/push"));
    expect(response.ok).toBe(true);
    const push = await response.json() as {
      pushId: string;
      state: string;
      analysis: {
        schema: { tables: Array<{ name: string }> };
        functions: { functions: Array<{ path: string; kind: string }> };
      };
      codegenAnalysis: {
        schema: { tables: Array<{ name: string }> };
        functions: Array<{
          moduleName: string;
          functions: Array<{ exportName: string; kind: string }>;
        }>;
      };
    };
    expect(push.pushId).toEqual(expect.any(String));
    expect(push.state).toBe("activated");
    expect(push.analysis.schema.tables.map(table => table.name)).toContain("lessonProgress");
    expect(push.analysis.functions.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "lessons:complete", kind: "mutation" }),
        expect.objectContaining({ path: "lessons:list", kind: "query" }),
      ]),
    );
    expect(push.codegenAnalysis.schema.tables.map(table => table.name)).toContain("lessonProgress");
    expect(push.codegenAnalysis.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleName: "lessons",
          functions: expect.arrayContaining([
            expect.objectContaining({ exportName: "complete", kind: "mutation" }),
            expect.objectContaining({ exportName: "list", kind: "query" }),
          ]),
        }),
      ]),
    );
  });

  it("exposes the active deployment execution artifact reference", async () => {
    const response = await runtime.fetch(new Request("http://localhost/__flarex_dev/deployment"));
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      activePushId: expect.any(String),
      executionArtifactRef: {
        runtime: "dynamic-worker",
        artifactId: expect.stringMatching(/^artifact_[a-f0-9]{32}$/),
        sourcePackageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        executionModule: expect.any(String),
      },
    });
  });

  it("proxies invoke through the backend artifact runtime path", async () => {
    const response = await runtime.fetch(
      new Request("http://localhost/__flarex_dev/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "lessons:complete",
          partitionKey: "2:u1",
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

  it("executes /sync mutations through the local Postgres executor transport", async () => {
    const postgresPersistDir = await mkdtemp(join(tmpdir(), "flarex-dev-postgres-"));
    const postgresRuntime = await createFlarexDevRuntime({
      root: resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/example"),
      deploymentId: "dev-runtime-postgres-sync",
      executorTransport: "postgres",
      projectId: "project_dev_runtime_postgres_sync",
      executorToken: "executor-secret",
      liveQueryDeliveryToken: "delivery-secret",
      persistDir: postgresPersistDir,
      typecheckGeneratedOutput: generatedTypecheckOptions,
    });

    try {
      const ws = await openDevSync(postgresRuntime);
      ws.send(JSON.stringify({
        type: "ModifyQuerySet",
        baseVersion: 0,
        newVersion: 1,
        modifications: [
          {
            type: "Add",
            queryId: 1,
            udfPath: "lessons:list",
            args: [{ userId: "2:u1" }],
            partitionKey: "2:u1",
          },
        ],
      }));
      await expect(nextJsonMessage(ws)).resolves.toMatchObject({
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 1,
            value: [],
          },
        ],
      });

      const postMutationMessages = collectJsonMessages(ws, 2);
      ws.send(JSON.stringify({
        type: "Mutation",
        requestId: 1,
        udfPath: "lessons:complete",
        args: [{ userId: "2:u1", lessonId: "executor-sync" }],
        partitionKey: "2:u1",
      }));

      await expect(postMutationMessages).resolves.toEqual([
        expect.objectContaining({
          type: "MutationResponse",
          requestId: 1,
          success: true,
        }),
        expect.objectContaining({
          type: "Transition",
          modifications: expect.arrayContaining([
            expect.objectContaining({
              type: "QueryUpdated",
              queryId: 1,
              value: expect.arrayContaining([
                expect.objectContaining({
                  userId: "2:u1",
                  lessonId: "executor-sync",
                  completed: true,
                }),
              ]),
            }),
          ]),
        }),
      ]);
      ws.close();
    } finally {
      await postgresRuntime.dispose();
      await rm(postgresPersistDir, { recursive: true, force: true });
    }
  }, 60000);
});

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    },
  );
}

async function openDevSync(runtime: FlarexDevRuntime): Promise<MiniflareWebSocket> {
  const response = await runtime.fetch(
    new Request("http://localhost/__flarex_dev/sync", {
      headers: {
        Upgrade: "websocket",
        "x-flarex-session": "postgres-sync-session",
      },
    }),
  );
  expect(response.status).toBe(101);
  const webSocket = (response as Response & { webSocket?: unknown }).webSocket;
  expect(webSocket).toBeDefined();
  const ws = webSocket as MiniflareWebSocket;
  ws.accept();
  return ws;
}

function collectJsonMessages(ws: MiniflareWebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket messages.")),
      5000,
    );
    ws.addEventListener("message", event => {
      messages.push(JSON.parse(String(event.data)));
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
    ws.addEventListener("error", event => {
      clearTimeout(timeout);
      reject(event);
    }, { once: true });
  });
}

function nextJsonMessage(ws: MiniflareWebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message.")),
      5000,
    );
    ws.addEventListener("message", event => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
    ws.addEventListener("error", event => {
      clearTimeout(timeout);
      reject(event);
    }, { once: true });
  });
}
