import { Result } from "effect";
import { expect, it } from "vitest";
import { captureLogicalSchemaSourceResult } from "../src/logical-schema-candidate";
import { compileLogicalDocumentReference, compileLogicalDocumentReferences } from "../src/logical-storage-requirements";

it("lowers one actual scalar declaration without broadening whole-source profile admission", () => {
  const source = Result.getOrThrow(captureLogicalSchemaSourceResult({
    key: "payload", owner: "payload", evidence: {}, sourceSha256: "c".repeat(64), writeProfile: "payload.content-relations",
    definition: { kind: "documents", indexes: [], uniqueConstraints: [],
      tables: ["references", "users"].map(logicalName => ({ logicalName,
        definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
          value: { user: { fieldType: { type: "id", tableName: "users" }, optional: false } } } } })),
      relations: [{ format: "flarex.relation-declaration", version: 1,
        source: { table: "references", path: [{ kind: "field", name: "user" }], forwardName: "user" },
        target: { table: "users" }, value: { cardinality: "one", required: false },
        inverse: { cardinality: "many", name: null }, localized: false, onTargetDelete: "restrict" }],
    },
    bindings: ["references", "users"].map(localName => ({ kind: "definition", localName,
      table: { namespace: "app", logicalName: localName } })),
  }));
  if (source.definition.kind !== "documents") throw new Error("Missing native source");
  const declared = source.definition.relations[0];
  if (declared === undefined) throw new Error("Missing native declaration");
  const single = Result.getOrThrow(compileLogicalDocumentReference(source, declared));
  expect(Result.getOrThrow(compileLogicalDocumentReferences(source))).toEqual([single]);
  expect(Result.isFailure(compileLogicalDocumentReference(source, { ...declared }))).toBe(true);
  for (const writeProfile of ["payload.content-many", "payload.content-joins"])
    expect(Result.getOrThrow(compileLogicalDocumentReferences({ ...source, writeProfile }))).toEqual([]);
});
