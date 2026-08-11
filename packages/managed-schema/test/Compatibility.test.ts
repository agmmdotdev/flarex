import { describe, expect, it } from "vitest";
import {
  decodeSchemaManifestAppSchemaV1,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import { validateValidatorValueV1 } from "flarex-protocol/validator-engine";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import {
  classifyAppSchemaEvolution,
  classifyValidatorCompatibility,
} from "@flarex/managed-schema/compatibility";

const stringField = Object.freeze({
  fieldType: Object.freeze({ type: "string" } as const),
  optional: false,
});
const optionalStringField = Object.freeze({
  fieldType: Object.freeze({ type: "string" } as const),
  optional: true,
});

describe("managed app-schema compatibility", () => {
  it("classifies equal schemas and additive metadata without inventing readiness", () => {
    const active = manifest([
      table(1, "recipes", objectValidator({ name: stringField })),
    ]);
    const equal = classifyAppSchemaEvolution(active, active);
    expect(equal).toEqual({
      disposition: "safeMetadataActivation",
      dataCompatibility: "universallyCompatible",
      physicalRequirements: "unchanged",
      identity: "consistent",
      changes: [],
    });
    expect(Object.isFrozen(equal)).toBe(true);
    expect(Object.isFrozen(equal.changes)).toBe(true);

    const optionalField = classifyAppSchemaEvolution(
      active,
      manifest([
        table(1, "recipes", objectValidator({
          name: stringField,
          description: optionalStringField,
        })),
        table(2, "categories", objectValidator({ label: stringField })),
      ]),
    );
    expect(optionalField).toMatchObject({
      disposition: "safeMetadataActivation",
      dataCompatibility: "universallyCompatible",
      physicalRequirements: "unchanged",
      identity: "consistent",
    });
    expect(optionalField.changes.map((change) => change.kind)).toEqual([
      "tableAdded",
      "tableValidatorChanged",
    ]);
  });

  it("requires row validation for removal, required addition, and narrowing", () => {
    const withOptionalDescription = manifest([
      table(1, "recipes", objectValidator({
        name: stringField,
        description: optionalStringField,
      })),
    ]);
    const removed = classifyAppSchemaEvolution(
      withOptionalDescription,
      manifest([table(1, "recipes", objectValidator({ name: stringField }))]),
    );
    expect(removed).toMatchObject({
      disposition: "managedBuildAndValidation",
      dataCompatibility: "requiresDataValidation",
      physicalRequirements: "unchanged",
      identity: "consistent",
      changes: [{
        kind: "tableValidatorChanged",
        compatibility: {
          disposition: "requiresDataValidation",
          reason: "narrowingOrUnknown",
          path: "$document.description",
        },
      }],
    });

    const required = classifyValidatorCompatibility(
      objectValidator({ name: stringField }),
      objectValidator({ name: stringField, slug: stringField }),
    );
    expect(required).toEqual({
      disposition: "requiresDataValidation",
      reason: "narrowingOrUnknown",
      path: "$document.slug",
    });

    const narrowed = classifyValidatorCompatibility(
      { type: "union", value: [{ type: "string" }, { type: "number" }] },
      { type: "string" },
    );
    expect(narrowed).toMatchObject({
      disposition: "requiresDataValidation",
      path: "$document<activeUnion:1>",
    });

    const removedTable = classifyAppSchemaEvolution(
      manifest([
        table(1, "recipes", objectValidator({ name: stringField })),
        table(2, "categories", objectValidator({ name: stringField })),
      ]),
      manifest([table(1, "recipes", objectValidator({ name: stringField }))]),
    );
    expect(removedTable).toMatchObject({
      disposition: "managedBuildAndValidation",
      dataCompatibility: "requiresDataValidation",
      changes: [{ kind: "tableRemoved", tableId: 2 }],
    });
  });

  it("proves only conservative widening rules", () => {
    for (const [active, candidate] of [
      [
        objectValidator({ name: stringField }),
        objectValidator({ name: optionalStringField }),
      ],
      [
        { type: "union", value: [{ type: "string" }] },
        { type: "union", value: [{ type: "string" }, { type: "number" }] },
      ],
      [{ type: "literal", value: "draft" }, { type: "string" }],
      [{ type: "id", tableName: "users" }, { type: "string" }],
      [
        { type: "array", value: { type: "literal", value: 1 } },
        { type: "array", value: { type: "number" } },
      ],
    ] satisfies ReadonlyArray<readonly [ValidatorJsonV1, ValidatorJsonV1]>) {
      expect(classifyValidatorCompatibility(active, candidate)).toEqual({
        disposition: "universallyCompatible",
      });
    }

    expect(classifyValidatorCompatibility(
      { type: "string" },
      { type: "id", tableName: "users" },
    )).toMatchObject({ disposition: "requiresDataValidation" });
    expect(classifyValidatorCompatibility(
      { type: "record", keys: { type: "string" }, values: { type: "number" } },
      { type: "object", value: {} },
    )).toMatchObject({ disposition: "requiresDataValidation" });
  });

  it("separates physical drift and identity ambiguity from row compatibility", () => {
    const recipeTable = table(1, "recipes", objectValidator({
      name: stringField,
      category: stringField,
    }));
    const active = manifest(
      [recipeTable],
      [index(1, 1, "by_name", ["name"])],
    );
    const physical = classifyAppSchemaEvolution(
      active,
      manifest(
        [recipeTable],
        [index(1, 1, "by_name", ["category"])],
      ),
    );
    expect(physical).toMatchObject({
      disposition: "managedBuildAndValidation",
      dataCompatibility: "universallyCompatible",
      physicalRequirements: "requiresBuildOrRetirement",
      identity: "consistent",
      changes: [{ kind: "indexDefinitionChanged" }],
    });

    const tableIdentity = classifyAppSchemaEvolution(
      manifest([table(1, "recipes", objectValidator({ name: stringField }))]),
      manifest([table(2, "recipes", objectValidator({ name: stringField }))]),
    );
    expect(tableIdentity).toMatchObject({
      disposition: "blocked",
      identity: "requiresExplicitIntent",
    });
    expect(tableIdentity.changes.some((change) =>
      change.kind === "tableIdentityChanged"
    )).toBe(true);

    const renamedWithoutIntent = classifyAppSchemaEvolution(
      manifest([table(1, "recipes", objectValidator({ name: stringField }))]),
      manifest([table(1, "meals", objectValidator({ name: stringField }))]),
    );
    expect(renamedWithoutIntent).toMatchObject({
      disposition: "blocked",
      identity: "requiresExplicitIntent",
      changes: [{ kind: "tableLogicalNameChanged", tableId: 1 }],
    });

    const indexIdentity = classifyAppSchemaEvolution(
      active,
      manifest(
        [recipeTable],
        [index(2, 1, "by_name", ["name"])],
      ),
    );
    expect(indexIdentity).toMatchObject({
      disposition: "blocked",
      identity: "requiresExplicitIntent",
      physicalRequirements: "requiresBuildOrRetirement",
    });

    const ambiguousTableReplacement = classifyAppSchemaEvolution(
      manifest([table(1, "recipes", objectValidator({ name: stringField }))]),
      manifest([table(2, "meals", objectValidator({ name: stringField }))]),
    );
    expect(ambiguousTableReplacement).toMatchObject({
      disposition: "blocked",
      identity: "requiresExplicitIntent",
    });
    expect(ambiguousTableReplacement.changes.map((change) => change.kind))
      .toEqual(["tableAdded", "tableRemoved"]);

    const ambiguousIndexReplacement = classifyAppSchemaEvolution(
      active,
      manifest(
        [recipeTable],
        [index(2, 1, "by_category", ["category"])],
      ),
    );
    expect(ambiguousIndexReplacement).toMatchObject({
      disposition: "blocked",
      identity: "requiresExplicitIntent",
      physicalRequirements: "requiresBuildOrRetirement",
    });
    expect(ambiguousIndexReplacement.changes.map((change) => change.kind))
      .toEqual(["indexAdded", "indexRemoved"]);
  });

  it("falls back to data validation when union comparison exhausts its budget", () => {
    const { active, candidate } = budgetExhaustionValidators();

    expect(classifyValidatorCompatibility(active, candidate)).toMatchObject({
      disposition: "requiresDataValidation",
      reason: "comparisonBudgetExceeded",
    });
  });

  it("shares one conservative comparison budget across the whole manifest", () => {
    const { active, candidate } = budgetExhaustionValidators();
    const activeManifest = manifestWithDocumentTypes([
      objectValidator({ value: { fieldType: active, optional: false } }),
      objectValidator({ name: stringField }),
    ]);
    const candidateManifest = manifestWithDocumentTypes([
      objectValidator({ value: { fieldType: candidate, optional: false } }),
      objectValidator({ name: stringField }),
    ]);

    const classification = classifyAppSchemaEvolution(
      activeManifest,
      candidateManifest,
    );
    expect(classification).toMatchObject({
      disposition: "managedBuildAndValidation",
      dataCompatibility: "requiresDataValidation",
      changes: [
        {
          kind: "tableValidatorChanged",
          tableId: 1,
          compatibility: { reason: "comparisonBudgetExceeded" },
        },
        {
          kind: "tableValidatorChanged",
          tableId: 2,
          compatibility: { reason: "comparisonBudgetExceeded" },
        },
      ],
    });
  });

  it("never labels a generated old-valid witness incompatible with the candidate", () => {
    const corpus: ReadonlyArray<ValidatorJsonV1> = [
      { type: "null" },
      { type: "number" },
      { type: "bigint" },
      { type: "boolean" },
      { type: "string" },
      { type: "bytes" },
      { type: "any" },
      { type: "id", tableName: "users" },
      { type: "literal", value: "draft" },
      { type: "literal", value: 1 },
      { type: "literal", value: true },
      { type: "array", value: { type: "number" } },
      {
        type: "record",
        keys: { type: "string" },
        values: { type: "boolean" },
      },
      objectValidator({ name: stringField }),
      objectValidator({ note: optionalStringField }),
      {
        type: "union",
        value: [{ type: "number" }, { type: "string" }],
      },
      {
        type: "object",
        value: {
          nested: {
            optional: false,
            fieldType: objectValidator({ count: {
              optional: false,
              fieldType: { type: "number" },
            } }),
          },
        },
      },
    ];

    for (const active of corpus) {
      for (const candidate of corpus) {
        const compatibility = classifyValidatorCompatibility(active, candidate);
        if (compatibility.disposition !== "universallyCompatible") continue;
        for (const witness of witnessesFor(active)) {
          const normalized = normalizeFlarexValueV1(witness).value;
          expect(
            validateValidatorValueV1(
              active,
              normalized,
              { idPolicy: { mode: "shapeOnly" } },
            )._tag === "Success",
            `generated witness must satisfy active ${active.type}`,
          ).toBe(true);
          expect(
            validateValidatorValueV1(
              candidate,
              normalized,
              { idPolicy: { mode: "shapeOnly" } },
            )._tag === "Success",
            `universal proof admitted old-valid/new-invalid witness ${active.type}->${candidate.type}`,
          ).toBe(true);
        }
      }
    }
  });
});

function manifest(
  tables: ReadonlyArray<Readonly<Record<string, unknown>>>,
  indexes: ReadonlyArray<Readonly<Record<string, unknown>>> = [],
): SchemaManifestAppSchemaV1 {
  return decodeSchemaManifestAppSchemaV1({
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
      indexes,
    },
  });
}

function manifestWithDocumentTypes(
  documentTypes: ReadonlyArray<
    Extract<ValidatorJsonV1, { readonly type: "object" }>
  >,
): SchemaManifestAppSchemaV1 {
  const decoded = manifest(documentTypes.map((_, index) =>
    table(index + 1, `table_${index + 1}`, objectValidator({}))
  ));
  return decodeSchemaManifestAppSchemaV1({
    ...decoded,
    tableDefinitions: {
      ...decoded.tableDefinitions,
      tables: decoded.tableDefinitions.tables.map((table, index) => ({
        ...table,
        definition: {
          ...table.definition,
          documentType: documentTypes[index] ?? objectValidator({}),
        },
      })),
    },
  });
}

function budgetExhaustionValidators(): Readonly<{
  active: ValidatorJsonV1;
  candidate: ValidatorJsonV1;
}> {
  const active: ValidatorJsonV1 = {
    type: "union",
    value: Array.from({ length: 5 }, (_, offset) => ({
      type: "literal" as const,
      value: -(offset + 1),
    })),
  };
  return {
    active,
    candidate: {
      type: "union",
      value: [
        ...Array.from({ length: 65_529 }, (_, value) => ({
          type: "literal" as const,
          value,
        })),
        ...active.value,
      ],
    },
  };
}

function table(
  tableId: number,
  logicalName: string,
  documentType: ValidatorJsonV1,
): Readonly<Record<string, unknown>> {
  return {
    tableId,
    namespace: "app",
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType,
    },
  };
}

function index(
  logicalIndexId: number,
  tableId: number,
  descriptor: string,
  fields: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> {
  return {
    logicalIndexId,
    tableId,
    namespace: "app",
    descriptor,
    spec: {
      kind: "developerOrdered",
      specVersion: 1,
      fields,
    },
  };
}

function objectValidator(
  fields: Readonly<
    Record<
      string,
      Readonly<{ readonly fieldType: ValidatorJsonV1; readonly optional: boolean }>
    >
  >,
): Extract<ValidatorJsonV1, { readonly type: "object" }> {
  return { type: "object", value: fields };
}

function witnessesFor(validator: ValidatorJsonV1): ReadonlyArray<unknown> {
  switch (validator.type) {
    case "null":
      return [null];
    case "number":
      return [0, -0, Number.NaN, Number.POSITIVE_INFINITY];
    case "bigint":
      return [0n, -1n];
    case "boolean":
      return [false, true];
    case "string":
      return ["", "value"];
    case "bytes":
      return [new ArrayBuffer(0), new Uint8Array([1, 2]).buffer];
    case "any":
      return [null, 1, "value", false, [1], { value: "nested" }];
    case "id":
      return ["1:018f22e2-58cc-7b2a-91d8-f3f3401a0874"];
    case "literal":
      return [validator.value];
    case "array": {
      const element = witnessesFor(validator.value)[0];
      return element === undefined ? [[]] : [[], [element]];
    }
    case "record": {
      const value = witnessesFor(validator.values)[0];
      return value === undefined ? [{}] : [{ key: value }];
    }
    case "union":
      return validator.value.flatMap(witnessesFor);
    case "object": {
      const required: Record<string, unknown> = {};
      const complete: Record<string, unknown> = {};
      for (const fieldName of Object.keys(validator.value).sort()) {
        const field = validator.value[fieldName];
        if (field === undefined) throw new Error("decoded validator lost field");
        const witness = witnessesFor(field.fieldType)[0];
        if (witness === undefined) continue;
        complete[fieldName] = witness;
        if (!field.optional) required[fieldName] = witness;
      }
      return [required, complete];
    }
  }
}
