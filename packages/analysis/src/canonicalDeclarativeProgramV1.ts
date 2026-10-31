import type {
  CanonicalDeclarativeProgramV1,
} from "@flarex/declarative-program/v1";
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
      validator: table.definition.documentType,
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
        ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }),
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
      args: fn.argsValidator,
      returns: fn.returnsValidator,
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
