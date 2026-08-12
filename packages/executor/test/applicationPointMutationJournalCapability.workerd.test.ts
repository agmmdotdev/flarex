/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Application point-mutation journal capability", () => {
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

  it("serializes flat calls onto the existing journal sequence", async () => {
    const response = await runtime.dispatchFetch("https://journal.test/");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      close: "success",
      maximumActive: 1,
      lateName: "FlarexApplicationJournalCapabilityStopped",
      validationName: "ApplicationRevisionSyscallDocumentValidationV1Error",
      validAfterValidation: "1:00000000-0000-4000-8000-000000000001",
      results: [
        { kind: "present", document: { name: "Ada" } },
        { documents: [{ name: "Ada" }], isDone: true },
        "1:00000000-0000-4000-8000-000000000001",
        null,
        null,
        null,
      ],
      operations: [
        { kind: "insert", syscallSequence: "1" },
        { kind: "get", syscallSequence: "2" },
        { kind: "indexRange", syscallSequence: "3" },
        { kind: "insert", syscallSequence: "4" },
        { kind: "patch", syscallSequence: "5" },
        { kind: "replace", syscallSequence: "6" },
        { kind: "delete", syscallSequence: "7" },
      ],
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
        entry: join(directory, "applicationPointMutationJournalCapability.worker.ts"),
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
    throw new Error("Application journal Worker bundle was not emitted.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-application-journal-workspace-package-resolution",
    resolveId(id) {
      if (id ===
        "@flarex/executor/internal/application-point-mutation-journal-capability") {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
