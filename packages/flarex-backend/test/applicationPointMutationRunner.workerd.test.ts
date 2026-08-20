/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Application point-mutation runner", () => {
  let runtime: Miniflare;

  beforeAll(async () => {
    runtime = new Miniflare({
      compatibilityDate: "2026-06-14",
      modules: [{
        type: "ESModule",
        path: "worker.js",
        contents: await bundleWorker(),
      }],
    });
  }, 120_000);

  afterAll(async () => {
    if (runtime !== undefined) await runtime.dispose();
  });

  it("projects authenticated Application input and invokes the host afresh", async () => {
    const response = await runtime.dispatchFetch("https://runner.test/");
    if (response.status !== 200) {
      throw new Error(`Runner Worker failed: ${await response.text()}`);
    }
    const result = await response.json();
    expect(result).toMatchObject({
      first: { hostCall: 1 },
      second: { hostCall: 2 },
      legacyBearer: { hostCall: 4 },
      sourceReads: 4,
      hostCalls: 4,
      legacyTag: "ApplicationPointMutationRunnerHostV1Error",
      applicationError: {
        tag: "PointMutationOccApplicationErrorV1",
        code: "CLOSED",
      },
      runtimeHostMismatch: {
        tag: "ApplicationPointMutationRunnerHostV1Error",
        reason: "runtimeHostMismatch",
      },
    });
    expect(result).toHaveProperty("observed");
    const observed = Reflect.get(result as object, "observed");
    expect(observed).toHaveLength(4);
    expect(observed[0]).toMatchObject({
        format: "flarex.application-transaction-worker-request",
        version: 1,
        auth: {
          kind: "user",
          user: {
            tokenIdentifier: "opaque-runner-user-1",
            issuer: "https://issuer.example",
            subject: "user-1",
            name: "Ada",
          },
        },
        arguments: { name: "Ada" },
        tables: [{ tableId: 1, logicalName: "users" }],
        context: {
          mode: "write",
          executionId: "execution-1",
          logScopeId: "log-1",
          executionTime: 1_800_000_000_000,
          initialCreationTimeCursor: 1_800_000_000_000,
        },
    });
    expect(observed[3]).toMatchObject({
      auth: {
        kind: "user",
        user: {
          tokenIdentifier: "https://issuer.example|user-1",
          issuer: "https://issuer.example",
          subject: "user-1",
          name: "Ada",
        },
      },
    });
  });
});

async function bundleWorker(): Promise<string> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(directory, "applicationPointMutationRunner.worker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []
  );
  const worker = chunks.find(chunk =>
    chunk.type === "chunk" && chunk.fileName === "worker.js"
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Application runner Worker bundle was not emitted.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-application-runner-workspace-package-resolution",
    resolveId(id) {
      if (id === "flarex-backend/internal/application-point-mutation-runner" ||
        id === "@flarex/executor/internal/application-point-mutation-journal-capability" ||
        id === "@flarex/executor/internal/application-point-mutation-runner" ||
        id === "@flarex/executor/point-mutation-journal") {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
