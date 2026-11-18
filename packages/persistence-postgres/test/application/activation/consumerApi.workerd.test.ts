/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("loads the actual Activation consumer API in Workerd and refuses copied selection authority", async () => {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(dirname(fileURLToPath(import.meta.url)), "consumerApi.worker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []);
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Activation consumer Worker was not emitted");
  }
  const renderedModules = Object.entries(worker.modules)
    .filter(([, module]) => module.renderedLength > 0)
    .map(([id]) => id.replaceAll("\\", "/"));
  expect(renderedModules.some(id => id.endsWith("/application/applicationActivationApi.ts"))).toBe(true);
  expect(renderedModules.filter(id =>
    /(?:\/database\/|\/installation\/|\/application\/activation\/(?:repository|bindingPreparation|bindingAcceptance|currentBinding|standaloneBinding|finitePreparation|activationPersistence|readBindingPublication|databaseBoundary)\.|\/application\/readiness\/(?:repository|preparation|acceptance|persistence|databaseBoundary)\.|\/node_modules\/.*(?:drizzle|postgres|pglite)|node:crypto)/.test(id))).toEqual([]);
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "worker.js", contents: worker.code }],
  });
  try {
    await runtime.ready;
    const response = await runtime.dispatchFetch("https://activation.test/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exports: ["ApplicationActivationError", "claimApplicationActiveSelection"],
      claim: {
        tag: "ApplicationActivationError",
        operation: "validateSelection",
        reason: "invalidComposition",
      },
      getters: 0,
    });
  } finally {
    await runtime.dispose();
  }
}, 120_000);
