/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("point-mutation exact-runtime executor runner in workerd", () => {
  let runtime: Miniflare;

  beforeAll(async () => {
    runtime = new Miniflare({
      compatibilityDate: "2026-06-14",
      modules: [{
        type: "ESModule",
        path: "runner.js",
        contents: await bundleWorker(),
      }],
    });
  }, 120_000);

  afterAll(async () => {
    if (runtime !== undefined) await runtime.dispose();
  });

  it("projects only strict authenticated evidence and disposes the host response", async () => {
    const result = await scenario("/projection");
    expect(result).toMatchObject({
      disposed: 1,
      value: {
        artifact: {
          runtime: "dynamic-worker",
          executionModule: "flarex/users.ts",
        },
        function: {
          path: "users:create",
          executionModule: "flarex/users.ts",
          kind: "mutation",
          visibility: "public",
        },
        auth: { kind: "anonymous" },
        arguments: { name: "Ada" },
        tables: [{ tableId: 1, logicalName: "users" }],
        context: {
          executionId: "execution_p02c2",
          logScopeId: "log_p02c2",
          randomSeed: new Array(32).fill(7),
        },
      },
    });
  });

  it("reconstructs the Convex user identity only from verified bearer evidence", async () => {
    expect(await scenario("/verified-bearer")).toMatchObject({
      disposed: 1,
      value: {
        auth: {
          kind: "user",
          user: {
            tokenIdentifier: "https://issuer.example|subject-1",
            issuer: "https://issuer.example",
            subject: "subject-1",
          },
        },
      },
    });
  });

  it("fails closed before the binding for unsupported trusted-dev evidence", async () => {
    expect(await scenario("/trusted-dev")).toMatchObject({
      calls: 0,
      outcome: {
        kind: "failure",
        tag: "PointMutationExactRuntimeRunnerHostV1Error",
        reason: "requestProjectionInvalid",
      },
    });
  });

  it("separates user-code failure from bounded host failure", async () => {
    expect(await scenario("/user-failure")).toMatchObject({
      kind: "failure",
      tag: "PointMutationOccUserCodeV1Error",
    });
    expect(await scenario("/host-failure")).toEqual({
      kind: "failure",
      tag: "PointMutationExactRuntimeRunnerHostV1Error",
      reason: "workerLoadFailed",
    });
  });

  it("strictly rejects excess host response data and still disposes it", async () => {
    expect(await scenario("/invalid-response")).toMatchObject({
      disposed: 1,
      outcome: {
        kind: "failure",
        tag: "PointMutationExactRuntimeRunnerHostV1Error",
        reason: "invalidHostResponse",
      },
    });
  });

  it("types only adapter-proven transport failures and preserves other rejections as defects", async () => {
    expect(await scenario("/transport")).toMatchObject({
      identityPreserved: false,
      outcome: {
        kind: "failure",
        tag: "PointMutationExactRuntimeRunnerHostV1Error",
        reason: "transportFailed",
      },
    });
    expect(await scenario("/defect")).toEqual({
      identityPreserved: true,
      outcome: {
        kind: "defect",
        message: "remote defect",
      },
    });
  });

  it("gives the retained local journal cause precedence over user failure", async () => {
    expect(await scenario("/journal-precedence")).toEqual({
      identityPreserved: true,
      outcome: {
        kind: "failure",
        tag: "InvalidPointMutationJournalCapabilityV1Error",
      },
    });
  });

  it("preserves interruption and closes late journal admission", async () => {
    expect(await scenario("/interruption")).toEqual({
      interrupted: true,
      admissionStayedOpen: true,
      interruptionWaitedForHost: true,
      lateCallRejected: true,
    });
  });

  async function scenario(path: string): Promise<unknown> {
    const response = await runtime.dispatchFetch(`https://runner.test${path}`);
    if (response.status !== 200) {
      throw new Error(
        `Runner scenario ${path} failed with ${response.status}: ${
          await response.text()
        }`,
      );
    }
    return response.json();
  }
});

async function bundleWorker(): Promise<string> {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(
          testDirectory,
          "pointMutationExactRuntimeRunner.worker.ts",
        ),
        formats: ["es"],
        fileName: "runner",
      },
      rolldownOptions: {
        external: ["cloudflare:workers"],
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []
  );
  const worker = chunks.find(
    chunk =>
      chunk.type === "chunk" &&
      chunk.fileName === "runner.js",
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Exact-runtime runner Worker bundle was not emitted.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-p02c2-workspace-package-resolution",
    resolveId(id) {
      if (
        id === "@flarex/executor/point-mutation-exact-runtime-runner" ||
        id === "@flarex/executor/point-mutation-exact-runtime-binding"
      ) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
