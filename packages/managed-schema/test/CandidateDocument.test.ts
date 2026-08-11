import { describe, expect, it } from "vitest";
import {
  prepareCandidateDocumentValidator,
  validateCandidateDocument,
} from "../src/CandidateDocument";
import {
  decodeAppDocumentIdentityV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  decodeSchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  normalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";

const recipesTableId = decodeCatalogTableId(1);
const usersTableId = decodeCatalogTableId(2);

const manifest = decodeSchemaManifestAppSchemaV1({
  kind: "appSchema",
  manifestVersion: 1,
  tableDefinitions: {
    kind: "tableDefinitions",
    sectionVersion: 1,
    tables: [
      {
        tableId: recipesTableId,
        namespace: "app",
        logicalName: "recipes",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: {
            type: "object",
            value: {
              title: { fieldType: { type: "string" }, optional: false },
              ownerId: {
                fieldType: { type: "id", tableName: "users" },
                optional: false,
              },
            },
          },
        },
      },
      {
        tableId: usersTableId,
        namespace: "app",
        logicalName: "users",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
        },
      },
    ],
  },
  indexBindings: {
    kind: "indexBindings",
    sectionVersion: 1,
    indexes: [],
  },
});

describe("candidate document validation", () => {
  it("accepts candidate-valid developer fields with table-aware IDs", () => {
    const ownerId = decodeAppDocumentIdentityV1(
      "2:018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    ).id;
    const developerFields = normalizedObject({ title: "Soup", ownerId });
    expect(validateCandidateDocument({
      candidateManifest: manifest,
      tableId: recipesTableId,
      developerFields,
    })).toEqual({ status: "valid" });
  });

  it("reports removed tables without exposing document fields", () => {
    expect(validateCandidateDocument({
      candidateManifest: manifest,
      tableId: decodeCatalogTableId(3),
      developerFields: normalizedObject({ secret: "never emit this" }),
    })).toEqual({
      status: "invalid",
      reason: "candidateTableRemoved",
      validatorPath: null,
    });
  });

  it("returns the bounded validator path for incompatible values", () => {
    const wrongOwnerId = decodeAppDocumentIdentityV1(
      "1:018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    ).id;
    const result = validateCandidateDocument({
      candidateManifest: manifest,
      tableId: recipesTableId,
      developerFields: normalizedObject({
        title: "Soup",
        ownerId: wrongOwnerId,
      }),
    });
    expect(result).toMatchObject({
      status: "invalid",
      reason: "candidateValidatorRejected",
      validatorPath: "$document.ownerId",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Soup");
  });

  it("pre-indexes a maximum-cardinality manifest for table and ID policy", () => {
    const maximumTables = 10_000;
    const tables = Array.from({ length: maximumTables }, (_, index) => {
      const tableId = decodeCatalogTableId(index + 1);
      return {
        tableId,
        namespace: "app" as const,
        logicalName: `table_${index + 1}`,
        definition: {
          kind: "appDocument" as const,
          definitionVersion: 1 as const,
          documentType: index === 0
            ? {
                type: "object" as const,
                value: {
                  target: {
                    fieldType: {
                      type: "id" as const,
                      tableName: `table_${maximumTables}`,
                    },
                    optional: false,
                  },
                },
              }
            : { type: "object" as const, value: {} },
        },
      };
    });
    const maximumManifest = decodeSchemaManifestAppSchemaV1({
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables,
      },
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: [],
      },
    });
    const validator = prepareCandidateDocumentValidator(maximumManifest);
    const target = decodeAppDocumentIdentityV1(
      `${maximumTables}:018f22e2-58cc-7b2a-91d8-f3f3401a0874`,
    ).id;
    expect(validator.hasTable(decodeCatalogTableId(maximumTables))).toBe(true);
    expect(validator.validate({
      tableId: decodeCatalogTableId(1),
      developerFields: normalizedObject({ target }),
    })).toEqual({ status: "valid" });
  });
});

function normalizedObject(
  value: Readonly<Record<string, unknown>>,
) {
  const normalized = normalizeFlarexValueV1(value);
  if (!isCanonicalFlarexRuntimeObjectV1(normalized.value)) {
    throw new Error("Expected canonical object fixture.");
  }
  return normalized.value;
}
