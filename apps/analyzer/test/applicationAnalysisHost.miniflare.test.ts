import { Miniflare } from "miniflare";
import { isNonArrayRecord } from "@flarex/utils/records";
import { afterEach, describe, expect, it } from "vitest";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type {
  ApplicationAnalysisSourceBundle,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT,
  makeApplicationAnalysisWorkerDefinition,
} from "../src/ApplicationAnalysisHost";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
});

describe("Application Analysis Worker Loader Miniflare parity", () => {
  it("cold-loads the untouched application module twice with no outbound binding", async () => {
    const definition = makeApplicationAnalysisWorkerDefinition(sourceBundle(
      `import { query } from "flarex/server";
import { v } from "flarex/values";
export default {
  users: {
    get: query({
      args: { id: v.id("users") },
      returns: v.null(),
      handler: async () => null,
    }),
  },
};`,
    `import { definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  users: definePartitionTable({ name: v.string() }),
});`));
    const miniflare = makeMiniflare(definition);
    const response = await miniflare.dispatchFetch("https://analysis.invalid/");
    const body = decodeColdLoadPair(await response.json());

    expect(response.status).toBe(200);
    if (body.first.kind !== "analyzed") {
      throw new Error(`First Miniflare cold load failed: ${JSON.stringify(body.first)}`);
    }
    if (
      typeof body.first.canonicalManifest !== "string" ||
      typeof body.second.canonicalManifest !== "string"
    ) throw new Error("Miniflare cold load omitted its canonical manifest.");
    expect(body.first.kind).toBe("analyzed");
    expect(body.second.kind).toBe("analyzed");
    expect(body.first.canonicalManifest).toBe(body.second.canonicalManifest);
    expect(JSON.parse(body.first.canonicalManifest)).toMatchObject({
      schema: { tables: [{ name: "users" }] },
    });
  });

  it("classifies import-time fetch under real Worker Loader linkage", async () => {
    const definition = makeApplicationAnalysisWorkerDefinition(sourceBundle(
      `await fetch("https://example.com/");
export default {};`,
    ));
    const miniflare = makeMiniflare(definition);
    const response = await miniflare.dispatchFetch("https://analysis.invalid/");
    const body = decodeColdLoadPair(await response.json());

    expect(body.first).toMatchObject({
      kind: "rejected",
      failureCode: "forbidden_import_effect",
    });
  });

  it("does not leak server-only registrations through the values shim", async () => {
    const definition = makeApplicationAnalysisWorkerDefinition(sourceBundle(
      `import { query } from "flarex/values";
export default { leaked: { query } };`,
    ));
    const miniflare = makeMiniflare(definition);
    const response = await miniflare.dispatchFetch("https://analysis.invalid/");
    const body = decodeColdLoadPair(await response.json());

    expect(body.first).toMatchObject({
      kind: "rejected",
      failureCode: "module_import_failed",
    });
  });
});

function makeMiniflare(definition: WorkerLoaderWorkerCode): Miniflare {
  const source = `export default {
  async fetch(_request, env) {
    const definition = ${JSON.stringify(definition)};
    const firstWorker = env.LOADER.load(definition);
    const secondWorker = env.LOADER.load(definition);
    const firstStub = firstWorker.getEntrypoint(${JSON.stringify(APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT)});
    const secondStub = secondWorker.getEntrypoint(${JSON.stringify(APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT)});
    try {
      const first = await firstStub.analyze();
      const second = await secondStub.analyze();
      return Response.json({ first, second });
    } finally {
      firstStub[Symbol.dispose]?.();
      secondStub[Symbol.dispose]?.();
    }
  },
};`;
  const instance = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script: source,
    workerLoaders: { LOADER: {} },
  });
  instances.push(instance);
  return instance;
}

interface MiniflareColdLoadOutcome {
  readonly kind: string;
  readonly canonicalManifest?: unknown;
  readonly failureCode?: unknown;
  readonly diagnostics?: unknown;
}

function decodeColdLoadPair(value: unknown): Readonly<{
  readonly first: MiniflareColdLoadOutcome;
  readonly second: MiniflareColdLoadOutcome;
}> {
  if (
    !isNonArrayRecord(value) ||
    !isNonArrayRecord(value.first) ||
    typeof value.first.kind !== "string" ||
    !isNonArrayRecord(value.second) ||
    typeof value.second.kind !== "string"
  ) throw new Error("Miniflare returned an invalid cold-load pair.");
  return Object.freeze({
    first: Object.freeze({
      kind: value.first.kind,
      canonicalManifest: value.first.canonicalManifest,
      failureCode: value.first.failureCode,
      diagnostics: value.first.diagnostics,
    }),
    second: Object.freeze({
      kind: value.second.kind,
      canonicalManifest: value.second.canonicalManifest,
      failureCode: value.second.failureCode,
      diagnostics: value.second.diagnostics,
    }),
  });
}

function sourceBundle(
  source: string,
  schemaSource?: string,
): ApplicationAnalysisSourceBundle {
  const sourceBytes = new TextEncoder().encode(source);
  const module = Object.freeze({
    path: "functions.js",
    roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
    sourceSha256: "b".repeat(64),
    sourceByteLength: sourceBytes.byteLength,
    source,
  });
  const schemaModule = schemaSource === undefined
    ? undefined
    : Object.freeze({
      path: "schema.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
      sourceSha256: "c".repeat(64),
      sourceByteLength: new TextEncoder().encode(schemaSource).byteLength,
      source: schemaSource,
    });
  const modules = schemaModule === undefined
    ? [module]
    : [module, schemaModule];
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256: "a".repeat(64),
      executionModulePath: module.path,
      schemaModulePath: schemaModule?.path ?? null,
      modules: Object.freeze(modules.map(value => Object.freeze({
        path: value.path,
        roles: value.roles,
        sourceSha256: value.sourceSha256,
        sourceByteLength: value.sourceByteLength,
      }))),
    }),
    modules: Object.freeze(modules),
  });
}
