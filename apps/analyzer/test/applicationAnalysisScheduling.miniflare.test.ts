import { isNonArrayRecord } from "@flarex/utils/records";
import { Miniflare } from "miniflare";
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

describe("Application Analysis scheduling ownership", () => {
  it("keeps a real import-time timer forbidden", async () => {
    const body = await analyzeTwice(sourceBundle(
      `setTimeout(() => undefined, 0);
export default {};`,
    ));

    expect(body.first).toMatchObject({
      kind: "rejected",
      failureCode: "forbidden_import_effect",
    });
    expect(body.second).toMatchObject({
      kind: "rejected",
      failureCode: "forbidden_import_effect",
    });
  });

  it("does not classify analyzer-owned yielding as an application timer", async () => {
    const fields = Array.from(
      { length: 1_024 },
      (_, index) => `field${index}: v.string()`,
    ).join(",\n");
    const body = await analyzeTwice(sourceBundle(
      `import { query } from "flarex/server";
export default {
  records: {
    get: query({ handler: async () => null }),
  },
};`,
      `import { definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  records: definePartitionTable({
${fields}
  }),
});`,
    ));

    expect(body.first.kind).toBe("analyzed");
    expect(body.second.kind).toBe("analyzed");
    expect(body.first.canonicalManifest).toBe(body.second.canonicalManifest);
  });
});

interface ColdLoadOutcome {
  readonly kind: string;
  readonly canonicalManifest?: unknown;
  readonly failureCode?: unknown;
}

async function analyzeTwice(
  bundle: ApplicationAnalysisSourceBundle,
): Promise<Readonly<{
  readonly first: ColdLoadOutcome;
  readonly second: ColdLoadOutcome;
}>> {
  const definition = makeApplicationAnalysisWorkerDefinition(bundle);
  const script = `export default {
  async fetch(_request, env) {
    const definition = ${JSON.stringify(definition)};
    const firstWorker = env.LOADER.load(definition);
    const secondWorker = env.LOADER.load(definition);
    const firstStub = firstWorker.getEntrypoint(${JSON.stringify(APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT)});
    const secondStub = secondWorker.getEntrypoint(${JSON.stringify(APPLICATION_ANALYSIS_COLD_LOAD_ENTRYPOINT)});
    const first = await firstStub.analyze();
    try {
      const second = await secondStub.analyze();
      try { return Response.json({ first, second }); }
      finally { second[Symbol.dispose]?.(); }
    } finally {
      first[Symbol.dispose]?.();
    }
  },
};`;
  const instance = new Miniflare({
    compatibilityDate: "2026-06-14",
    modules: true,
    script,
    workerLoaders: { LOADER: {} },
  });
  instances.push(instance);
  const response = await instance.dispatchFetch("https://analysis.invalid/");
  const value: unknown = await response.json();
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
    }),
    second: Object.freeze({
      kind: value.second.kind,
      canonicalManifest: value.second.canonicalManifest,
      failureCode: value.second.failureCode,
    }),
  });
}

function sourceBundle(
  source: string,
  schemaSource?: string,
): ApplicationAnalysisSourceBundle {
  const execution = sourceModule(
    "functions.js",
    SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
    "b".repeat(64),
    source,
  );
  const schema = schemaSource === undefined
    ? undefined
    : sourceModule(
      "schema.js",
      SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
      "c".repeat(64),
      schemaSource,
    );
  const modules = schema === undefined ? [execution] : [execution, schema];
  return Object.freeze({
    sourceArtifact: Object.freeze({
      rootSha256: "a".repeat(64),
      executionModulePath: execution.path,
      schemaModulePath: schema?.path ?? null,
      modules: Object.freeze(modules.map(module => Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceSha256: module.sourceSha256,
        sourceByteLength: module.sourceByteLength,
      }))),
    }),
    modules: Object.freeze(modules),
  });
}

function sourceModule(
  path: string,
  roles: number,
  sourceSha256: string,
  source: string,
) {
  return Object.freeze({
    path,
    roles,
    sourceSha256,
    sourceByteLength: new TextEncoder().encode(source).byteLength,
    source,
  });
}
