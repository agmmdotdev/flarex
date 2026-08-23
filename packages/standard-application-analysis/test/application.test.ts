import {
  canonicalizeApplicationAnalysisReceiptV1,
  canonicalizeApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { describe, expect, it } from "vitest";

import {
  analyzeStandardApplication,
  type StandardApplicationAnalysis,
  type StandardApplicationAnalysisContext,
} from "../src/application";

const ROOT_SHA256 = "a".repeat(64);

describe("Standard Application analysis", () => {
  it("preserves a relation-bearing manifest through the unversioned composition", async () => {
    const manifest = relationManifest();
    const canonicalReceipt = Result.getOrThrow(
      canonicalizeApplicationAnalysisReceiptV1({
        format: "flarex.application-analysis-receipt",
        version: 1,
        analysisId: "analysis-relations",
        candidateId: "candidate-relations",
        scopeId: "scope-relations",
        sourceArtifactRootSha256: ROOT_SHA256,
        analyzerIdentity: "analyzer-relations",
        analyzerPolicyIdentity: "policy-relations",
        completedAt: "2026-08-23T00:00:00.000Z",
        status: "analyzed",
        manifestSha256: "d".repeat(64),
      }),
    );
    if (canonicalReceipt.receipt.status !== "analyzed") {
      throw new Error("Expected analyzed Application Analysis Receipt V1.");
    }
    const receipt = canonicalReceipt.receipt;
    const expected = Object.freeze({
      kind: "analyzed" as const,
      receipt,
      manifest,
    }) satisfies StandardApplicationAnalysis;
    const context = Object.freeze({
      analyze() {
        return Effect.succeed(expected);
      },
    }) satisfies StandardApplicationAnalysisContext<never>;

    const analyzed = await Effect.runPromise(analyzeStandardApplication({
      requestKey: "request:relations",
      sourceArtifactRootSha256: ROOT_SHA256,
    }, context));

    expect(analyzed).toBe(expected);
    if (analyzed.kind !== "analyzed") {
      throw new Error("Expected analyzed Standard Application result.");
    }
    expect(analyzed.manifest.version).toBe(2);
    if (analyzed.manifest.version !== 2) {
      throw new Error("Expected relation-bearing Application Manifest V2.");
    }
    expect(analyzed.manifest.schema.relations).toMatchObject([
      { relationOrdinal: 1 },
    ]);
  });
});

function relationManifest() {
  return Result.getOrThrow(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact: {
      rootSha256: ROOT_SHA256,
      executionModulePath: "functions.js",
      schemaModulePath: "schema.js",
      modules: [
        {
          path: "functions.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
          sourceSha256: "b".repeat(64),
          sourceByteLength: 18,
        },
        {
          path: "schema.js",
          roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
          sourceSha256: "c".repeat(64),
          sourceByteLength: 32,
        },
      ],
    },
    schema: {
      version: 2,
      tables: [
        {
          tableId: 1,
          name: "posts",
          validator: {
            type: "object",
            value: {
              author: {
                fieldType: { type: "id", tableName: "users" },
                optional: false,
              },
            },
          },
          placement: { kind: "global" },
        },
        {
          tableId: 2,
          name: "users",
          validator: { type: "object", value: {} },
          placement: { kind: "global" },
        },
      ],
      indexes: [],
      relations: [{
        relationOrdinal: 1,
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
        declaration: {
          format: "flarex.relation-declaration",
          version: 1,
          source: {
            table: "posts",
            path: [{ kind: "field", name: "author" }],
            forwardName: "author",
          },
          target: { table: "users" },
          value: { cardinality: "one", required: true },
          inverse: { cardinality: "many", name: "posts" },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  })).manifest;
}
