/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
  APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
} from "flarex-protocol/internal/application-revision-syscall-validation-v1";

describe("point-mutation journal RPC adapter in workerd", () => {
  let runtime: Miniflare;

  beforeAll(async () => {
    const [provider, caller] = await Promise.all([
      bundleWorker("pointMutationJournalRpc.worker.ts", "provider"),
      bundleWorker("pointMutationJournalRpcCaller.worker.ts", "caller"),
    ]);
    runtime = new Miniflare({
      workers: [
        {
          name: "journal-rpc-caller",
          compatibilityDate: "2026-06-14",
          routes: ["journal-rpc.test/*"],
          modules: [{
            type: "ESModule",
            path: "caller.js",
            contents: caller,
          }],
          serviceBindings: {
            JOURNAL: {
              name: "journal-rpc-provider",
              entrypoint: "PointMutationJournalRpcTestProvider",
            },
          },
        },
        {
          name: "journal-rpc-provider",
          compatibilityDate: "2026-06-14",
          routes: [],
          modules: [{
            type: "ESModule",
            path: "provider.js",
            contents: provider,
          }],
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (runtime !== undefined) await runtime.dispose();
  });

  it("returns nested disposable stubs and disposes the child fail-closed", async () => {
    const result = await scenario("/success");

    expect(result).toMatchObject({
      disposal: { parent: "function", table: "function" },
      disposedChild: true,
      result: {
        kind: "missing",
        document: null,
      },
      state: {
        closeFinished: false,
        closeStarted: false,
        operationCalls: 1,
        pointSyscallSequenceType: "bigint",
        tableIdentityPreserved: true,
      },
    });
  });

  it("returns a disposable index stub and preserves its private capability", async () => {
    const result = await scenario("/indexed-success");

    expect(result).toMatchObject({
      disposal: { parent: "function", table: "function", index: "function" },
      disposedIndex: true,
      result: {
        kind: "indexRangePage",
        documents: [{ status: "open" }],
        isDone: true,
      },
      state: {
        indexCalls: 1,
        indexSyscallSequenceType: "bigint",
        indexIdentityPreserved: true,
        operationCalls: 0,
        tableIdentityPreserved: true,
      },
    });
  });

  it("keeps persistence rejection envelopes local and stops the remote capability", async () => {
    const result = await scenario("/result-rejected");

    expect(result).toMatchObject([
      {
        local: {
          kind: "failure",
          tag: "PointMutationJournalResultRejectedV1Error",
          resultKind: "rejected",
          reason: "invalidDocument",
        },
        remote: {
          rejected: true,
          name: "FlarexJournalRpcStopped",
          message: "The journal RPC capability is unavailable.",
        },
      },
      {
        local: {
          kind: "failure",
          tag: "PointMutationJournalResultRejectedV1Error",
          resultKind: "sequenceRejected",
          reason: "sequenceGap",
        },
        remote: {
          rejected: true,
          name: "FlarexJournalRpcStopped",
          message: "The journal RPC capability is unavailable.",
        },
      },
      {
        local: {
          kind: "failure",
          tag: "PointMutationJournalResultRejectedV1Error",
          resultKind: "stateRejected",
          reason: "journalSealed",
        },
        remote: {
          rejected: true,
          name: "FlarexJournalRpcStopped",
          message: "The journal RPC capability is unavailable.",
        },
      },
    ]);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    for (const entry of result) {
      expect(errorStack(entry, "remote")).not.toContain("provider.js");
      expect(errorStack(entry, "remote")).not.toContain("journalSealed");
    }
  });

  it("redacts the remote rejection and re-emits the original local failure", async () => {
    const result = await scenario("/failure");

    expect(result).toMatchObject({
      local: {
        kind: "failure",
        identity: "first",
        tag: "InvalidPointMutationJournalCapabilityV1Error",
      },
      localAgain: {
        kind: "failure",
        identity: "first",
        tag: "InvalidPointMutationJournalCapabilityV1Error",
      },
      remote: {
        rejected: true,
        name: "FlarexJournalRpcStopped",
        message: "The journal RPC capability is unavailable.",
      },
    });
    expect(errorStack(result, "remote")).not.toContain("provider.js");
    expect(errorStack(result, "remote")).not.toContain("private journal");
  });

  it("returns document validation to user code without poisoning the journal", async () => {
    const result = await scenario("/validation-failure");

    expect(result).toMatchObject({
      invalid: {
        rejected: true,
        name: APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_NAME_V1,
        message:
          APPLICATION_REVISION_SYSCALL_DOCUMENT_VALIDATION_ERROR_MESSAGE_V1,
      },
      valid: { kind: "missing", document: null },
      local: { kind: "success" },
      state: { operationCalls: 2, tableIdentityPreserved: true },
    });
  });

  it("keeps a validation-named non-C03-V failure terminal", async () => {
    const result = await scenario("/validation-lookalike");

    expect(result).toMatchObject({
      local: {
        kind: "failure",
        identity: "unknown",
        tag: "InvalidPointMutationJournalCapabilityV1Error",
      },
      remote: {
        rejected: true,
        name: "FlarexJournalRpcStopped",
        message: "The journal RPC capability is unavailable.",
      },
    });
  });

  it("closes the parent and every existing child without invoking the journal", async () => {
    const result = await scenario("/late");

    expect(result).toMatchObject({
      lateChild: {
        rejected: true,
        name: "FlarexJournalRpcStopped",
      },
      lateParent: {
        rejected: true,
        name: "FlarexJournalRpcStopped",
      },
      local: { kind: "success" },
      state: {
        closeFinished: true,
        closeStarted: true,
        operationCalls: 0,
      },
    });
  });

  it("closes admission before draining an already-admitted call", async () => {
    const result = await scenario("/drain");

    expect(result).toMatchObject({
      beforeRelease: {
        closeFinished: false,
        closeStarted: true,
        operationCalls: 1,
      },
      late: {
        rejected: true,
        name: "FlarexJournalRpcStopped",
      },
      local: { kind: "success" },
      result: {
        kind: "missing",
        document: null,
      },
      afterRelease: {
        closeFinished: true,
        closeStarted: true,
        operationCalls: 1,
      },
    });
  });

  it("selects the earliest admitted failure even when it settles last", async () => {
    const result = await scenario("/ordering");

    expect(result).toMatchObject({
      local: {
        kind: "failure",
        identity: "first",
        tag: "InvalidPointMutationJournalCapabilityV1Error",
      },
      remote: [
        {
          rejected: true,
          name: "FlarexJournalRpcStopped",
        },
        {
          rejected: true,
          name: "FlarexJournalRpcStopped",
        },
      ],
    });
  });

  it.each([
    ["/defect", { kind: "defect", identity: "original" }],
    ["/interruption", { kind: "interruption" }],
  ])("preserves the local terminal cause for %s", async (path, local) => {
    const result = await scenario(path);

    expect(result).toMatchObject({
      local,
      remote: {
        rejected: true,
        name: "FlarexJournalRpcStopped",
      },
    });
    expect(errorStack(result, "remote")).not.toContain("provider.js");
  });

  async function scenario(path: string): Promise<unknown> {
    const response = await runtime.dispatchFetch(`https://journal-rpc.test${path}`);
    expect(response.status).toBe(200);
    return response.json();
  }
});

function errorStack(value: unknown, field: string): string {
  if (typeof value !== "object" || value === null) return "";
  const nested = Reflect.get(value, field);
  if (typeof nested !== "object" || nested === null) return "";
  const stack = Reflect.get(nested, "stack");
  return typeof stack === "string" ? stack : "";
}

async function bundleWorker(
  source: string,
  outputName: string,
): Promise<string> {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(testDirectory, source),
        formats: ["es"],
        fileName: outputName,
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
      chunk.fileName === `${outputName}.js`,
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error(`${outputName} Worker bundle was not emitted.`);
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-p02b-workspace-package-resolution",
    resolveId(id) {
      if (id === "@flarex/executor/point-mutation-journal-rpc") {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
