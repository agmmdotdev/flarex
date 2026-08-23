import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { definePartitionTable, defineSchema, query } from "flarex/server";
import { v } from "flarex/values";
import { describe, expect, it } from "vitest";
import {
  runApplicationAnalysisColdLoad,
} from "../src/ApplicationAnalysisWorkerCore";
import {
  APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
  ApplicationAnalysisRejectionCodeV1,
} from
  "@flarex/analysis/application-analysis";

const ROOT = "a".repeat(64);
const SOURCE_DIGEST = "b".repeat(64);

describe("Application Analysis cold-load core", () => {
  it("lowers real loaded registration values to the canonical manifest", async () => {
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: () => Promise.resolve({
        default: {
          users: {
            get: query({
              args: { id: v.id("users") },
              returns: v.null(),
              handler: async () => null,
            }),
          },
        },
      }),
      loadSchema: null,
    });

    expect(outcome.kind).toBe("analyzed");
    if (outcome.kind !== "analyzed") throw new Error("expected analyzed outcome");
    expect(JSON.parse(outcome.canonicalManifest)).toMatchObject({
      version: 1,
      functions: [{
        path: "users:get",
        kind: "query",
        visibility: "public",
      }],
    });
  });

  it("emits manifest V2 for one valid relation-bearing schema", async () => {
    const schema = defineSchema({
      posts: definePartitionTable({ authorId: v.id("users") }),
      users: definePartitionTable({ name: v.string() }),
    });
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifactWithSchema(),
      loadExecution: () => Promise.resolve({ default: {} }),
      loadSchema: () => Promise.resolve({
        default: Object.freeze({
          tables: schema.tables,
          relations: Object.freeze([relationDeclaration()]),
        }),
      }),
    });

    expect(outcome.kind).toBe("analyzed");
    if (outcome.kind !== "analyzed") throw new Error("expected analyzed outcome");
    expect(JSON.parse(outcome.canonicalManifest)).toMatchObject({
      version: 2,
      schema: {
        version: 2,
        relations: [{
          relationOrdinal: 1,
          declaration: {
            source: { table: "posts", forwardName: "authorId" },
            target: { table: "users" },
          },
        }],
      },
    });
  });

  it("classifies unsupported relation shapes as invalid schema", async () => {
    const schema = defineSchema({
      posts: definePartitionTable({ authorId: v.id("users") }),
      users: definePartitionTable({ name: v.string() }),
    });
    const invalid = {
      ...relationDeclaration(),
      source: {
        table: "posts",
        path: [
          { kind: "field", name: "authorId" },
          { kind: "field", name: "nested" },
        ],
        forwardName: "authorId",
      },
    };
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifactWithSchema(),
      loadExecution: () => Promise.resolve({ default: {} }),
      loadSchema: () => Promise.resolve({
        default: { tables: schema.tables, relations: [invalid] },
      }),
    });

    expect(outcome).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.invalidSchema,
    });
  });

  it("classifies the relation-count ceiling as a limit", async () => {
    const schema = defineSchema({
      posts: definePartitionTable({ authorId: v.id("users") }),
      users: definePartitionTable({ name: v.string() }),
    });
    const relations = Array.from(
      { length: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS + 1 },
      relationDeclaration,
    );
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifactWithSchema(),
      loadExecution: () => Promise.resolve({ default: {} }),
      loadSchema: () => Promise.resolve({
        default: { tables: schema.tables, relations },
      }),
    });

    expect(outcome).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.limitExceeded,
    });
  });

  it("does not trust a foreign schema cause that resembles a relation limit", async () => {
    const schema = defineSchema({
      posts: definePartitionTable({ authorId: v.id("users") }),
      users: definePartitionTable({ name: v.string() }),
    });
    const definition = { tables: schema.tables };
    Object.defineProperty(definition, "relations", {
      enumerable: true,
      get() {
        throw { reason: "relationLimitExceeded" };
      },
    });
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifactWithSchema(),
      loadExecution: () => Promise.resolve({ default: {} }),
      loadSchema: () => Promise.resolve({ default: definition }),
    });

    expect(outcome).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.invalidSchema,
    });
  });

  it("rejects import-time outbound calls with the stable forbidden-effect code", async () => {
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: async () => {
        await fetch("https://example.com");
        return { default: {} };
      },
      loadSchema: null,
    });

    expect(outcome).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
    });
  });

  it("rejects a forbidden ambient attempt even when application code catches it", async () => {
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: async () => {
        try {
          await fetch("https://example.com");
        } catch {
          // A caught ambient denial is still an attempted import effect.
        }
        return { default: {} };
      },
      loadSchema: null,
    });

    expect(outcome).toMatchObject({
      kind: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
    });
  });

  it("keeps deterministic Date semantics installed through lazy registration reads", async () => {
    const fixed = 1_700_000_000_000;
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: async () => ({
        default: {
          users: Object.defineProperty({}, "get", {
            enumerable: true,
            get: () => {
              if (
                Date.now() !== fixed ||
                new Date().getTime() !== fixed ||
                Date() !== new Date(fixed).toString() ||
                new Date().constructor !== Date ||
                new Date(2020, 0).getDate() !== 1 ||
                new Date(0).getTime() !== 0
              ) throw new Error("deterministic Date policy was not retained");
              class DerivedDate extends Date {}
              if (!(new DerivedDate() instanceof DerivedDate)) {
                throw new Error("deterministic Date lost derived new.target");
              }
              return query({ handler: async () => null });
            },
          }),
        },
      }),
      loadSchema: null,
    });

    expect(outcome.kind).toBe("analyzed");
  });

  it("classifies uncaught and caught lazy forbidden access before invalid registration", async () => {
    const uncaught = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: async () => ({
        default: {
          users: Object.defineProperty({}, "get", {
            enumerable: true,
            get: () => {
              void fetch("https://example.com");
              return query({ handler: async () => null });
            },
          }),
        },
      }),
      loadSchema: null,
    });
    const caughtBeforeInvalid = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: async () => Object.defineProperty({}, "default", {
        enumerable: true,
        get: () => {
          try {
            void fetch("https://example.com");
          } catch {
            // The sticky policy must outrank the invalid value returned here.
          }
          return null;
        },
      }),
      loadSchema: null,
    });

    for (const outcome of [uncaught, caughtBeforeInvalid]) {
      expect(outcome).toMatchObject({
        kind: "rejected",
        failureCode: ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
      });
    }
  });

  it("resets deterministic ambient substitutes for every cold load", async () => {
    const loadExecution = async () => {
      const moduleName = `${Date.now()}-${Math.random()}`;
      return {
        default: {
          [moduleName]: {
            get: query({ handler: async () => null }),
          },
        },
      };
    };
    const first = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution,
      loadSchema: null,
    });
    const second = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution,
      loadSchema: null,
    });

    expect(first.kind).toBe("analyzed");
    expect(second.kind).toBe("analyzed");
    if (first.kind === "analyzed" && second.kind === "analyzed") {
      expect(first.canonicalManifest).toBe(second.canonicalManifest);
    }
  });

  it("bounds diagnostic count and total message bytes", async () => {
    const outcome = await runApplicationAnalysisColdLoad({
      sourceArtifact: sourceArtifact(),
      loadExecution: async () => {
        for (let index = 0; index < 200; index += 1) {
          console.log("x".repeat(3_000), index);
        }
        return { default: {} };
      },
      loadSchema: null,
    });

    expect(outcome.diagnostics.length).toBeLessThanOrEqual(100);
    const bytes = outcome.diagnostics.reduce(
      (total, diagnostic) =>
        total + new TextEncoder().encode(diagnostic.message).byteLength,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(65_536);
  });
});

function sourceArtifact() {
  return Object.freeze({
    rootSha256: ROOT,
    executionModulePath: "functions.js",
    schemaModulePath: null,
    modules: Object.freeze([Object.freeze({
      path: "functions.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      sourceSha256: SOURCE_DIGEST,
      sourceByteLength: 18,
    })]),
  });
}

function sourceArtifactWithSchema() {
  return Object.freeze({
    rootSha256: ROOT,
    executionModulePath: "functions.js",
    schemaModulePath: "schema.js",
    modules: Object.freeze([
      Object.freeze({
        path: "functions.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: SOURCE_DIGEST,
        sourceByteLength: 18,
      }),
      Object.freeze({
        path: "schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "c".repeat(64),
        sourceByteLength: 18,
      }),
    ]),
  });
}

function relationDeclaration() {
  return Object.freeze({
    format: "flarex.relation-declaration" as const,
    version: 1 as const,
    source: Object.freeze({
      table: "posts",
      path: Object.freeze([
        Object.freeze({ kind: "field" as const, name: "authorId" }),
      ]),
      forwardName: "authorId",
    }),
    target: Object.freeze({ table: "users" }),
    value: Object.freeze({
      cardinality: "one" as const,
      required: true,
    }),
    inverse: Object.freeze({
      cardinality: "many" as const,
      name: "posts",
    }),
    localized: false as const,
    onTargetDelete: "restrict" as const,
  });
}
