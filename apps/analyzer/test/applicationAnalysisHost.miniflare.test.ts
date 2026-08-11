import { Miniflare } from "miniflare";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Result } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  produceStandardApplicationSource,
} from "@flarex/standard-application-definition/application-source";
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
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

  it("cold-analyzes the generated Standard Application execution and schema modules", async () => {
    const prepared = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
      programBudgetInput: {
        maximumModules: 1,
        maximumFunctions: 1,
        maximumIdentifierUtf8Bytes: 1_024,
        maximumValidatorNodes: 64,
        maximumValidatorDepth: 16,
        maximumValidatorStringUtf8Bytes: 1_024,
      },
      programInput: {
        format: "flarex.declarative-program/v1",
        version: 1,
        schema: {
          tables: [{
            logicalName: "users",
            definition: {
              kind: "appDocument",
              definitionVersion: 1,
              documentType: {
                type: "object",
                value: {
                  name: {
                    fieldType: { type: "string" },
                    optional: false,
                  },
                },
              },
            },
          }],
          indexes: [],
        },
        modules: [{
          modulePath: "users",
          functions: [{
            exportName: "get",
            kind: "query",
            visibility: "public",
            argsValidator: { type: "object", value: {} },
            returnsValidator: { type: "null" },
          }],
        }],
      },
      materializationBudgetInput: {
        maximumModules: 1,
        maximumEntryBindings: 1,
        maximumSourceBytes: 4_096,
        maximumSourceMapBytes: 0,
        maximumBytesMaterialized: 32_768,
        maximumSemanticRecords: 32,
        maximumSemanticRecordBytes: 8_192,
        maximumSemanticStreamBytes: 32_768,
      },
      graphInput: {
        modules: [{
          path: "functions/users.js",
          roles: ["function", "execution"],
          sourceBytes: new TextEncoder().encode(
            "export async function get() { return null; }\n",
          ),
          sourceMapBytes: null,
        }],
        functionEntries: [{
          logicalModulePath: "users",
          artifactModulePath: "functions/users.js",
        }],
        executionPath: "functions/users.js",
        schemaPath: null,
        authPath: null,
      },
    }));
    const produced = Result.getOrThrow(
      produceStandardApplicationSource(prepared),
    );
    const modules = produced.modules.map((module, ordinal) => Object.freeze({
      path: module.path,
      roles: module.roles,
      sourceSha256: (ordinal + 1).toString(16).repeat(64),
      sourceByteLength: module.sourceBytes.byteLength,
      source: new TextDecoder().decode(module.sourceBytes),
    }));
    const bundle: ApplicationAnalysisSourceBundle = Object.freeze({
      sourceArtifact: Object.freeze({
        rootSha256: "f".repeat(64),
        executionModulePath: produced.executionPath,
        schemaModulePath: produced.schemaPath,
        modules: Object.freeze(modules.map(module => Object.freeze({
          path: module.path,
          roles: module.roles,
          sourceSha256: module.sourceSha256,
          sourceByteLength: module.sourceByteLength,
        }))),
      }),
      modules: Object.freeze(modules),
    });
    const miniflare = makeMiniflare(
      makeApplicationAnalysisWorkerDefinition(bundle),
    );
    const response = await miniflare.dispatchFetch("https://analysis.invalid/");
    const body = decodeColdLoadPair(await response.json());

    expect(body.first.kind).toBe("analyzed");
    expect(body.second.kind).toBe("analyzed");
    if (typeof body.first.canonicalManifest !== "string") {
      throw new Error("Generated Standard source omitted its manifest.");
    }
    expect(JSON.parse(body.first.canonicalManifest)).toMatchObject({
      schema: { tables: [{ name: "users" }] },
      functions: [{
        path: "users:get",
        kind: "query",
        visibility: "public",
      }],
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
    const first = await firstStub.analyze();
    try {
      const second = await secondStub.analyze();
      try {
        return Response.json({ first, second });
      } finally {
        second[Symbol.dispose]?.();
      }
    } finally {
      first[Symbol.dispose]?.();
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
