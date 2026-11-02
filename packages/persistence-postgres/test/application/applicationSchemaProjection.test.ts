import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureSchemaManifestAppSchemaV1Result, CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema } from "flarex-protocol/schema-manifest";
import type { DocumentValidatorJsonV1, ObjectValidatorJsonV1, ValidatorLiteralV1 } from "flarex-protocol/validator-json";

import { applicationSchemaPublicationInputResult, projectBoundApplicationSchemaResult,
  type AnalyzedApplicationSchema } from "../../src/application/applicationSchemaProjection";

describe("Application Source schema projection", () => {
  it.each<DocumentValidatorJsonV1>([{ type: "any" }, { type: "object", value: {} },
    { type: "union", value: [{ type: "object", value: { a: { fieldType: { type: "string" }, optional: false } } },
      { type: "object", value: { b: { fieldType: { type: "bigint" }, optional: false } } }] }])(
    "captures fresh Source document root %j as V2", validator => {
      const result = applicationSchemaPublicationInputResult("source_projection", CatalogSchemaVersionIdSchema.make("source_projection"),
        CatalogSchemaVersionSchema.make(1), schema(validator));
      expect(result).toMatchObject({ _tag: "Success", success: { tables: [{ definition: { definitionVersion: 2 } }] } });
      expect(Result.isSuccess(projectBoundApplicationSchemaResult(schema(validator), bound(validator)))).toBe(true);
    });

  it.each<readonly [ValidatorLiteralV1, ValidatorLiteralV1]>([[-0, 0], [1n, 1], [false, "false"]])(
    "keeps distinct Source literal values %s and %s", (left, right) => {
      expect(Result.isSuccess(projectBoundApplicationSchemaResult(schema(literalRoot(left)), bound(literalRoot(left))))).toBe(true);
      expect(Result.isFailure(projectBoundApplicationSchemaResult(schema(literalRoot(left)), bound(literalRoot(right))))).toBe(true);
    });

  it("preserves union order rather than equating differently ordered declarations", () => {
    const a = literalRoot("a"), b = literalRoot("b");
    expect(Result.isFailure(projectBoundApplicationSchemaResult(schema({ type: "union", value: [a, b] }),
      bound({ type: "union", value: [b, a] })))).toBe(true);
  });

  it("compares Source object fields independently of JavaScript property insertion order", () => {
    const a = { fieldType: { type: "literal" as const, value: 1n }, optional: false };
    const b = { fieldType: { type: "literal" as const, value: -0 }, optional: false };
    expect(Result.isSuccess(projectBoundApplicationSchemaResult(schema({ type: "object", value: { a, b } }),
      bound({ type: "object", value: { b, a } })))).toBe(true);
  });
});

function literalRoot(value: ValidatorLiteralV1): ObjectValidatorJsonV1 {
  return { type: "object", value: { value: { fieldType: { type: "literal", value }, optional: false } } };
}
function schema(validator: DocumentValidatorJsonV1): AnalyzedApplicationSchema {
  return { version: 1, tables: [{ tableId: 1, name: "users", validator, placement: { kind: "global" } }], indexes: [] };
}
function bound(documentType: DocumentValidatorJsonV1) {
  return Result.getOrThrow(captureSchemaManifestAppSchemaV1Result({ kind: "appSchema", manifestVersion: 1,
    tableDefinitions: { kind: "tableDefinitions", sectionVersion: 1,
      tables: [{ tableId: 1, namespace: "app", logicalName: "users", definition: { kind: "appDocument", definitionVersion: 2, documentType } }] },
    indexBindings: { kind: "indexBindings", sectionVersion: 1, indexes: [] } }));
}
