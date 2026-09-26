import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";
import { compileLogicalExtensionIndexes } from "../src/logical-storage-requirements";
import { normalizeRelationalSchema } from "../src/relational-schema";

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

  it("permits a string source to hold a document identity but refuses a non-identity target", () => {
    const stringSource = { ...candidate, sources: candidate.sources.map(source => ({ ...source,
      definition: { ...source.definition, tables: source.definition.tables.map(table => table.logicalName === "references"
        ? { ...table, definition: { ...table.definition, documentType: { ...table.definition.documentType,
          value: { user: { fieldType: { type: "string" }, optional: false } } } } } : table),
      },
    })) };
    expect(Result.isSuccess(decodeLogicalSchemaCandidate(stringSource))).toBe(true);
    expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...stringSource,
      extensions: candidate.extensions.map(extension => ({ ...extension,
        target: { table: qualified("users"), field: "user" } })),
    }))).toBe(true);
  });

  it("refuses a decimal-only indexed source as a general strong reference", () => {
    const decimalIndexed = { ...candidate, sources: candidate.sources.map(source => ({ ...source,
      definition: { ...source.definition, indexes: [{ tableLogicalName: "references",
        descriptor: "by_decimal_user", fields: ["user"], decimalFields: ["user"] }] },
    })) };
    expect(Result.isFailure(decodeLogicalSchemaCandidate(decimalIndexed))).toBe(true);
  });

  it("derives one complete reverse index unless the source already declares one", () => {
    const decoded = decodeLogicalSchemaCandidate(candidate);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) return;
    const derived = compileLogicalExtensionIndexes(decoded.success);
    expect(Result.isSuccess(derived)).toBe(true);
    if (Result.isFailure(derived)) return;
    expect(derived.success).toHaveLength(1);
    expect(derived.success[0]).toMatchObject({ sourceKey: "application", localName: "references",
      descriptor: "strong-reference/user" });
    expect(derived.success[0]?.physicalSpec.orderedFields[0]).toMatchObject({ kind: "documentPath", path: "user" });
    const indexed = decodeLogicalSchemaCandidate({ ...candidate, sources: candidate.sources.map(source => ({ ...source,
      definition: { ...source.definition, indexes: [{ tableLogicalName: "references", descriptor: "by_user", fields: ["user"] }] },
    })) });
    expect(Result.isSuccess(indexed)).toBe(true);
    if (Result.isSuccess(indexed)) expect(compileLogicalExtensionIndexes(indexed.success)).toMatchObject({ _tag: "Success", success: [] });
  });

  it("admits only relational column names that an exact reverse index can address", () => {
    const origin = (sourceId: string) => ({ kind: "synthetic", sourceId });
    const relational = (field: string) => normalizeRelationalSchema({
      owner: "medusa", lineageId: "reference-fixture", capabilities: [], tables: [{
        tableId: "reference", origin: origin("reference.table"),
        columns: ["id", field].map(columnId => ({ columnId, type: "text", nullable: false,
          default: { kind: "none" }, origin: origin(`reference.${columnId}`) })),
        keys: [{ keyId: "reference.primary", kind: "primary", columns: ["id"], origin: origin("reference.primary") }],
        indexes: [], constraints: [], relationships: [],
      }],
    });
    const withField = (field: string) => {
      const schema = Result.getOrThrow(relational(field));
      const source = { key: "medusa.reference", owner: "medusa", evidence: {}, sourceSha256: "d".repeat(64),
        writeProfile: "medusa.reference", definition: { kind: "relational", schema },
        bindings: [{ kind: "definition", localName: "reference", table: { namespace: "medusa", logicalName: "reference" } }],
      };
      return decodeLogicalSchemaCandidate({ ...candidate, sources: [...candidate.sources, source],
        extensions: [{ name: "reference_user", sourceKey: source.key,
          source: { table: source.bindings[0]?.table, field }, target: { table: qualified("users"), field: "_id" },
          policy: "strongReference", onTargetDelete: "restrict" }],
      });
    };
    expect(Result.isSuccess(withField("user_id"))).toBe(true);
    for (const field of ["user.id", "user id", "üser", "u".repeat(65)])
      expect(Result.isFailure(withField(field))).toBe(true);
  });
});
