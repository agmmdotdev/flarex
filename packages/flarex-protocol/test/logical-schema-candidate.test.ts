import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeLogicalSchemaCandidate } from "../src/logical-schema-candidate";
import { compileLogicalReferenceIndexes, compileLogicalStrongReferences } from "../src/logical-storage-requirements";
import { normalizeRelationalSchema } from "../src/relational-schema";

const qualified = (logicalName: string) => ({ namespace: "app", logicalName });
const candidate = {
  kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate", deploymentId: "test", scopeId: "scope",
  applicationAnalysis: { candidateId: "candidate", analysisId: "analysis", manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
  sources: [{ key: "application", owner: "application", evidence: {}, sourceSha256: "c".repeat(64), writeProfile: "application.occ",
    definition: { kind: "documents", indexes: [], uniqueConstraints: [], relations: [], tables: ["references", "users", "posts"].map(logicalName => ({
      logicalName, definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { user: { fieldType: { type: "id", tableName: "users" }, optional: false } } } },
    })) },
    bindings: ["references", "users", "posts"].map(localName => ({ kind: "definition", localName, table: qualified(localName) })),
  }],
  extensions: [{ name: "reference_user", sourceKey: "application", source: { table: qualified("references"), field: "user" },
    target: { table: qualified("users"), field: "_id" }, policy: "strongReference",
    liveness: { source: { kind: "current" }, target: { kind: "current" } }, onTargetDelete: "restrict" }],
};

describe("logical candidate dependency identities", () => {
  it("admits exactly nullable reference identities without widening arbitrary unions", () => {
    const withType = (fieldType: unknown) => decodeLogicalSchemaCandidate({ ...candidate,
      sources: candidate.sources.map(source => ({ ...source, definition: { ...source.definition,
        tables: source.definition.tables.map(table => table.logicalName === "references"
          ? { ...table, definition: { ...table.definition, documentType: { type: "object",
            value: { user: { fieldType, optional: false } } } } } : table),
      } })),
    });
    for (const identity of [{ type: "string" }, { type: "id", tableName: "users" }]) {
      for (const value of [[identity, { type: "null" }], [{ type: "null" }, identity]])
        expect(Result.isSuccess(withType({ type: "union", value }))).toBe(true);
    }
    for (const value of [[], [{ type: "null" }], [{ type: "string" }, { type: "number" }],
      [{ type: "string" }, { type: "null" }, { type: "id", tableName: "users" }],
      [{ type: "id", tableName: "posts" }, { type: "null" }]])
      expect(Result.isFailure(withType({ type: "union", value }))).toBe(true);
  });

  it("refuses retained-reference semantics without an authenticated soft-delete target", () => {
    for (const onTargetSoftDelete of ["retain", "cascade", null])
      expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate,
        extensions: candidate.extensions.map(extension => ({ ...extension, onTargetSoftDelete })),
      }))).toBe(true);
    const decoded = Result.getOrThrow(decodeLogicalSchemaCandidate(candidate));
    expect(decoded.extensions[0]).not.toHaveProperty("onTargetSoftDelete");
  });

  it("derives optional Payload policy and an indexed reverse path from the native declaration", () => {
    const relation = { format: "flarex.relation-declaration", version: 1,
      source: { table: "references", path: [{ kind: "field", name: "user" }], forwardName: "user" },
      target: { table: "users" }, value: { cardinality: "one", required: false },
      inverse: { cardinality: "many", name: null }, localized: false, onTargetDelete: "restrict" };
    const native = { ...candidate, extensions: [], sources: candidate.sources.map(source => ({ ...source,
      key: "payload", owner: "payload", writeProfile: "payload.content-relations",
      definition: { ...source.definition, relations: [relation] },
    })) };
    const checked = Result.getOrThrow(decodeLogicalSchemaCandidate(native));
    expect(compileLogicalStrongReferences(checked)).toMatchObject({ _tag: "Success", success: [{
      name: "document-relation/payload/references/user", sourceKey: "payload",
      source: { table: qualified("references"), field: "user" }, target: { table: qualified("users"), field: "_id" },
      liveness: { source: { kind: "current" }, target: { kind: "current" } }, onTargetDelete: "restrict",
    }] });
    expect(compileLogicalReferenceIndexes(checked)).toMatchObject({ _tag: "Success", success: [{
      localName: "references", descriptor: "strong-reference/user",
      physicalSpec: { orderedFields: [{ kind: "documentPath", path: "user" }, { kind: "systemCreationTime" }] },
    }] });
    const existing = Result.getOrThrow(decodeLogicalSchemaCandidate({ ...native, sources: native.sources.map(source => ({
      ...source, definition: { ...source.definition, indexes: [{ tableLogicalName: "references", descriptor: "by_user", fields: ["user"] }] },
    })) }));
    expect(compileLogicalReferenceIndexes(existing)).toMatchObject({ _tag: "Success", success: [] });
    const unsupported = Result.getOrThrow(decodeLogicalSchemaCandidate({ ...native, sources: native.sources.map(source => ({
      ...source, definition: { ...source.definition, relations: [{ ...relation, value: { cardinality: "one", required: true } }] },
    })) }));
    expect(Result.isFailure(compileLogicalStrongReferences(unsupported))).toBe(true);
    const collision = Result.getOrThrow(decodeLogicalSchemaCandidate({ ...native,
      extensions: candidate.extensions.map(extension => ({ ...extension, sourceKey: "payload",
        name: "document-relation/payload/references/user" })) }));
    expect(Result.isFailure(compileLogicalStrongReferences(collision))).toBe(true);
  });

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

  it("requires an explicit liveness rule matching both endpoint schemas", () => {
    expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate, definitionVersion: 1 }))).toBe(true);
    const extension = candidate.extensions[0];
    if (extension === undefined) throw new Error("Missing reference fixture");
    for (const changed of [
      { ...extension, liveness: undefined },
      { ...extension, liveness: { source: { kind: "softDeleteNull", field: "deleted_at" }, target: { kind: "current" } } },
      { ...extension, liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } } },
    ]) expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate, extensions: [changed] }))).toBe(true);
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
    const derived = compileLogicalReferenceIndexes(decoded.success);
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
    if (Result.isSuccess(indexed)) expect(compileLogicalReferenceIndexes(indexed.success)).toMatchObject({ _tag: "Success", success: [] });
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
          policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "current" } },
          onTargetDelete: "restrict" }],
      });
    };
    expect(Result.isSuccess(withField("user_id"))).toBe(true);
    for (const field of ["user.id", "user id", "üser", "u".repeat(65)])
      expect(Result.isFailure(withField(field))).toBe(true);
  });
});
