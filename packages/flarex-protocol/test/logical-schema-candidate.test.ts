import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";

const qualified = (logicalName: string) => ({ namespace: "app", logicalName });
const candidate = {
  kind: "logicalSchemaCandidate", definitionVersion: 1, state: "candidate", deploymentId: "test", scopeId: "scope",
  applicationAnalysis: { candidateId: "candidate", analysisId: "analysis", manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
  sources: [{ key: "application", owner: "application", evidence: {}, sourceSha256: "c".repeat(64), writeProfile: "application.occ",
    definition: { kind: "documents", indexes: [], uniqueConstraints: [], relations: [], tables: ["references", "users", "posts"].map(logicalName => ({
      logicalName, definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { user: { fieldType: { type: "id", tableName: "users" }, optional: false } } } },
    })) },
    bindings: ["references", "users", "posts"].map(localName => ({ kind: "definition", localName, table: qualified(localName) })),
  }],
  extensions: [{ name: "reference_user", sourceKey: "application", source: { table: qualified("references"), field: "user" },
    target: { table: qualified("users"), field: "_id" }, policy: "strongReference", onTargetDelete: "restrict" }],
};

describe("logical candidate dependency identities", () => {
  it("requires explicit complete unique intent and validates its field dependencies", () => {
    const constraint = { tableLogicalName: "references", descriptor: "unique/user", fields: ["user"], sparse: false, nullsDistinct: false };
    const withConstraints = (uniqueConstraints: unknown) => ({ ...candidate, sources: candidate.sources.map(source => ({
      ...source, definition: { ...source.definition, uniqueConstraints },
    })) });
    expect(Result.isSuccess(decodeLogicalSchemaCandidate(withConstraints([constraint])))).toBe(true);
    for (const invalid of [undefined, [constraint, constraint], [{ ...constraint, fields: ["missing"] }],
      [{ ...constraint, tableLogicalName: "missing" }], [{ ...constraint, predicate: { kind: "fieldIsNull", field: "missing" } }]]) {
      expect(Result.isFailure(decodeLogicalSchemaCandidate(withConstraints(invalid)))).toBe(true);
    }
  });
  it("resolves a native id target through its producer binding", () => {
    expect(Result.isSuccess(decodeLogicalSchemaCandidate(candidate))).toBe(true);
    const renamed = { ...candidate, sources: candidate.sources.map(source => ({ ...source,
      bindings: source.bindings.map(binding => binding.localName === "users" ? { ...binding, table: qualified("accounts") } : binding),
    })), extensions: candidate.extensions.map(extension => ({ ...extension, target: { table: qualified("accounts"), field: "_id" } })) };
    expect(Result.isSuccess(decodeLogicalSchemaCandidate(renamed))).toBe(true);
  });

  it("refuses an id extension pointing at a different table", () => {
    expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate,
      extensions: candidate.extensions.map(extension => ({ ...extension, target: { table: qualified("posts"), field: "_id" } })),
    }))).toBe(true);
  });
});
