import type {
  CanonicalDeclarativeProgramV1,
} from "@flarex/declarative-program/v1";
import type { ValidatorJSON } from "flarex/values";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type {
  AnalyzedModule,
  AnalyzedSchema,
  DeploymentAnalysis,
} from "./index.ts";

/**
 * Projects normalized developer intent into the existing V1 analysis model.
 *
 * The canonical program has already established ownership and validated every
 * table/index reference, so a missing table here is an internal invariant
 * violation rather than a recoverable developer-input failure.
 */
export function analyzeCanonicalDeclarativeProgramV1(
  program: CanonicalDeclarativeProgramV1,
): DeploymentAnalysis {
  const tableIds = new Map(
    program.schema.tables.map((table, index) => [
      table.logicalName,
      index + 1,
    ] as const),
  );

  const tables: AnalyzedSchema["tables"] = program.schema.tables.map(
    (table, index) => ({
      tableId: index + 1,
      name: table.logicalName,
      validator: legacyValidatorJsonFromCanonical(
        table.definition.documentType,
      ),
      placement: { kind: "global" },
    }),
  );

  const indexes: AnalyzedSchema["indexes"] = program.schema.indexes.map(
    (index, position) => {
      const tableId = tableIds.get(index.tableLogicalName);
      if (tableId === undefined) {
        throw new Error(
          `Canonical declarative program index "${index.descriptor}" references missing table "${index.tableLogicalName}".`,
        );
      }
      return {
        indexId: position + 1,
        tableId,
        name: index.descriptor,
        fields: [...index.fields],
      };
    },
  );

  const functions: readonly AnalyzedModule[] = program.modules.map((module) => ({
    moduleName: module.modulePath,
    functions: module.functions.map((fn) => ({
      moduleName: module.modulePath,
      exportName: fn.exportName,
      kind: fn.kind,
      visibility: fn.visibility,
      args: legacyValidatorJsonFromCanonical(fn.argsValidator),
      returns: fn.returnsValidator === null
        ? null
        : legacyValidatorJsonFromCanonical(fn.returnsValidator),
      partition: null,
    })),
  }));

  return {
    schema: {
      version: 1,
      tables,
      indexes,
    },
    functions,
  };
}

function legacyValidatorJsonFromCanonical(
  validator: ValidatorJsonV1,
): ValidatorJSON {
  switch (validator.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type: validator.type };
    case "id":
      return {
        type: "id",
        tableName: validator.tableName,
      };
    case "literal":
      return {
        type: "literal",
        value: validator.value,
      };
    case "array":
      return {
        type: "array",
        value: legacyValidatorJsonFromCanonical(validator.value),
      };
    case "record":
      return {
        type: "record",
        keys: legacyValidatorJsonFromCanonical(validator.keys),
        values: legacyValidatorJsonFromCanonical(validator.values),
      };
    case "union":
      return {
        type: "union",
        value: validator.value.map(legacyValidatorJsonFromCanonical),
      };
    case "object":
      return {
        type: "object",
        value: Object.fromEntries(
          Object.entries(validator.value).map(([fieldName, field]) => [
            fieldName,
            {
              fieldType: legacyValidatorJsonFromCanonical(field.fieldType),
              optional: field.optional,
            },
          ]),
        ),
      };
  }
}
