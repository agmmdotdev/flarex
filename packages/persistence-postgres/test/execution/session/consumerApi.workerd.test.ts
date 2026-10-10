/// <reference types="node" />

import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("loads the actual Session consumer API in Workerd and refuses copied recovery evidence", async () => {
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
    throw new Error("Session consumer Worker was not emitted");
  }
  const renderedModules = Object.entries(worker.modules)
    .filter(([, module]) => module.renderedLength > 0)
    .map(([id]) => id.replaceAll("\\", "/"));
  expect(renderedModules.some(id => id.endsWith("/execution/session/api.ts"))).toBe(true);
  expect(renderedModules.filter(id =>
    /(?:\/database\/|\/installation\/|\/execution\/session\/(?:construction|activation|durableActivation|finiteActivation|attemptLoad|attemptKernel|terminalization|target)\.|\/execution\/claims\/(?:acquisition|renewal)\.|\/node_modules\/.*(?:drizzle|postgres|pglite)|node:crypto)/.test(id))).toEqual([]);
  const runtime = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: [{ type: "ESModule", path: "worker.js", contents: worker.code }],
  });
  try {
    await runtime.ready;
    const response = await runtime.dispatchFetch("https://session.test/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exports: [
        "PointMutationExecutionClaimAcquisitionInputV1Error",
        "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
        "PointMutationExecutionClaimAcquisitionStaleV1Error",
        "PointMutationSessionActivationPersistenceV1Error",
        "PointMutationSessionActivationV1Error",
        "PointMutationSessionAttemptLoadV1Error",
        "PointMutationSessionAttemptTerminalizationPersistenceV1Error",
        "PointMutationSessionAttemptTerminalizationV1Error",
        "readFiniteRecoveryAttempt",
      ],
      recovery: {
        tag: "PointMutationExecutionClaimAcquisitionInputV1Error",
        reason: "invalidSelector",
      },
      getters: 0,
    });
  } finally {
    await runtime.dispose();
  }
}, 120_000);
