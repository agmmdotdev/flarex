import {
  analyzeExecutionModulesEffect,
  analyzeSchemaDefinitionEffect,
  type AnalyzerFunctionMetadataError,
  type AnalyzerPartitionError,
  type AnalyzerSchemaError,
  type AnalyzerValidatorError,
  type LoadedExecutionModules,
} from "@flarex/analysis";
import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  decodeCanonicalDeclarativeProgramV1,
  type CanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeFunctionInputV1,
  type CanonicalDeclarativeProgramV1,
  type CanonicalDeclarativeProgramV1Error,
  type CanonicalDeclarativeModuleInputV1,
} from "@flarex/declarative-program/v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";

export interface LoadedSdkDeclarativeProgramV1Input {
  readonly schemaDefinition: unknown;
  readonly executionModules: LoadedExecutionModules;
}

export type CanonicalDeclarativeProgramV1SdkAdapterErrorReason =
  | "sdkInspectionFailed"
  | "unsupportedSchemaMember"
  | "unsupportedTablePlacement"
  | "unsupportedFunctionPartition";

export class CanonicalDeclarativeProgramV1SdkAdapterError
  extends Data.TaggedError("CanonicalDeclarativeProgramV1SdkAdapterError")<{
    readonly reason: CanonicalDeclarativeProgramV1SdkAdapterErrorReason;
    readonly path: string;
    readonly cause?: unknown;
  }> {}

export type CanonicalDeclarativeProgramV1FromSdkError =
  | AnalyzerSchemaError
  | AnalyzerFunctionMetadataError
  | AnalyzerValidatorError
  | AnalyzerPartitionError
  | CanonicalDeclarativeProgramV1SdkAdapterError
  | CanonicalDeclarativeProgramV1Error;

/**
 * Compatibility adapter for the first canonical-program vertical.
 *
 * It evaluates current SDK exporters through the existing analyzer boundary,
 * rejects legacy placement/partition policy, then enters the canonical
 * program's Result decoder exactly once.
 */
export const canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect: (
  input: LoadedSdkDeclarativeProgramV1Input,
  budget: CanonicalDeclarativeProgramBudgetV1,
) => Effect.Effect<
  CanonicalDeclarativeProgramV1,
  CanonicalDeclarativeProgramV1FromSdkError
> = Effect.fn(
    "FlarexDev.canonicalDeclarativeProgramV1FromLoadedSdkDefinition",
  )(function* (
    input: LoadedSdkDeclarativeProgramV1Input,
    budget: CanonicalDeclarativeProgramBudgetV1,
  ): Effect.fn.Return<
    CanonicalDeclarativeProgramV1,
    CanonicalDeclarativeProgramV1FromSdkError
  > {
    const sdkSchemaMembers = yield* inspectSdkSchemaMembersEffect(
      input.schemaDefinition,
    );
    for (const member of sdkSchemaMembers) {
      if (member.kind !== "table") {
        return yield* new CanonicalDeclarativeProgramV1SdkAdapterError({
          reason: "unsupportedSchemaMember",
          path: `schema.tables.${member.name}`,
        });
      }
    }

    const analyzedSchema = yield* analyzeSchemaDefinitionEffect(
      input.schemaDefinition,
    );

    const tableNamesById = new Map<number, string>();
    for (const table of analyzedSchema.tables) {
      if (table.placement.kind !== "global") {
        return yield* new CanonicalDeclarativeProgramV1SdkAdapterError({
          reason: "unsupportedTablePlacement",
          path: `schema.tables.${table.name}.placement`,
        });
      }
      tableNamesById.set(table.tableId, table.name);
    }

    const analyzedModules = yield* analyzeExecutionModulesEffect(
      input.executionModules,
    );

    const indexes = analyzedSchema.indexes.map((index) => {
      const tableLogicalName = tableNamesById.get(index.tableId);
      if (tableLogicalName === undefined) {
        throw new Error(
          `Analyzed SDK index "${index.name}" references missing table id ${index.tableId}.`,
        );
      }
      return {
        tableLogicalName,
        descriptor: index.name,
        fields: index.fields,
      };
    });

    const modules: CanonicalDeclarativeModuleInputV1[] = [];
    for (const module of analyzedModules) {
      const functions: CanonicalDeclarativeFunctionInputV1[] = [];
      for (const fn of module.functions) {
        if (fn.partition !== undefined && fn.partition !== null) {
          return yield* new CanonicalDeclarativeProgramV1SdkAdapterError({
            reason: "unsupportedFunctionPartition",
            path: `modules.${module.moduleName}.functions.${fn.exportName}.partition`,
          });
        }
        functions.push({
          exportName: fn.exportName,
          kind: fn.kind,
          visibility: fn.visibility,
          argsValidator: fn.args,
          returnsValidator: fn.returns,
        });
      }
      modules.push({
        modulePath: module.moduleName,
        functions,
      });
    }

    const candidate = {
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: 1,
      schema: {
        tables: analyzedSchema.tables.map((table) => ({
          logicalName: table.name,
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: table.validator,
          },
        })),
        indexes,
      },
      modules,
    };

    return yield* Effect.fromResult(
      decodeCanonicalDeclarativeProgramV1(candidate, budget),
    );
  });

const inspectSdkSchemaMembersEffect = Effect.fn(
  "FlarexDev.inspectSdkSchemaMembers",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ReadonlyArray<Readonly<{ readonly name: string; readonly kind: unknown }>>,
  CanonicalDeclarativeProgramV1SdkAdapterError
> {
  return yield* Effect.try({
    try: () => {
      if (!isNonArrayRecord(value)) {
        return [];
      }
      const tables = value.tables;
      if (!isNonArrayRecord(tables)) {
        return [];
      }
      return Object.entries(tables).map(([name, member]) => {
        if (!isNonArrayRecord(member)) {
          return { name, kind: undefined };
        }
        const descriptor = Object.getOwnPropertyDescriptor(member, "kind");
        if (descriptor !== undefined && !("value" in descriptor)) {
          throw new TypeError(
            `SDK schema member "${name}" kind must be an own data property.`,
          );
        }
        return {
          name,
          kind: descriptor?.value,
        };
      });
    },
    catch: (cause) =>
      new CanonicalDeclarativeProgramV1SdkAdapterError({
        reason: "sdkInspectionFailed",
        path: "schema.tables",
        cause,
      }),
  });
});
