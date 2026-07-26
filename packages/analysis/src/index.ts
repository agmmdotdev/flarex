import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Schema } from "effect";
import { assertValidatorJson } from "flarex/validator-json";
import type { ValidatorJSON } from "flarex/values";
import type {
  DeploymentAnalysis as ProtocolDeploymentAnalysis,
  DeploymentCodegenAnalysis as ProtocolDeploymentCodegenAnalysis,
  DeploymentCodegenModule as ProtocolDeploymentCodegenModule,
  DeploymentFunctionMetadata as ProtocolDeploymentFunctionMetadata,
  ValidatorJson as ProtocolValidatorJson,
} from "flarex-protocol/deployment";
import {
  decodeDeploymentAnalysisEffect,
  decodeDeploymentCodegenAnalysisEffect,
} from "flarex-protocol/deployment";
import { selectorNameForPartitionField } from "flarex-protocol/partition-selector";
import { ValidatorJson as ProtocolValidatorJsonSchema } from "flarex-protocol/validator-json";

export type AnalyzerDiagnostic = {
  readonly level: "log" | "warn" | "error";
  readonly message: string;
};

export type AnalyzedSourcePosition = {
  readonly path: string;
  readonly startLine: number;
  readonly startColumn: number;
};

export type AnalyzedFunctionPartitionPolicy = {
  readonly type: "partition";
  readonly table: string;
  readonly selector: string;
  readonly partitionField: string;
  readonly argField: string;
};

export type AnalyzedFunctionPartitionRootPolicy = {
  readonly type: "partitionRoot";
  readonly table: string;
  readonly partitionField: string;
};

export type AnalyzedFunctionPartitionCreateRootPolicy = {
  readonly type: "partitionCreateRoot";
  readonly table: string;
  readonly partitionField: "_id";
};

export type ParsedFunctionPartitionPolicy =
  | AnalyzedFunctionPartitionPolicy
  | AnalyzedFunctionPartitionRootPolicy
  | AnalyzedFunctionPartitionCreateRootPolicy;

export type AnalyzedFunction = {
  readonly moduleName: string;
  readonly exportName: string;
  readonly kind: "query" | "mutation" | "workflowMutation" | "action";
  readonly visibility: "public" | "internal";
  readonly args: ValidatorJSON;
  readonly returns: ValidatorJSON | null;
  readonly partition?: ParsedFunctionPartitionPolicy | null;
  readonly position?: AnalyzedSourcePosition;
};

export type AnalyzedModule = {
  readonly moduleName: string;
  readonly functions: readonly AnalyzedFunction[];
};

export type AnalyzedSchema = {
  readonly version: number;
  readonly tables: ReadonlyArray<{
    readonly tableId: number;
    readonly name: string;
    readonly validator: ValidatorJSON;
    readonly placement:
      | { readonly kind: "partitionBy"; readonly field: string }
      | { readonly kind: "colocateWith"; readonly table: string; readonly field: string }
      | { readonly kind: "global" };
  }>;
  readonly indexes: ReadonlyArray<{
    readonly indexId: number;
    readonly tableId: number;
    readonly name: string;
    readonly fields: readonly string[];
  }>;
};

export type DeploymentAnalysis = {
  readonly functions: readonly AnalyzedModule[];
  readonly schema: AnalyzedSchema;
};

export type LoadedExecutionModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export type AnalyzerSourceMapInput = Readonly<Record<string, string>>;

export type AnalyzeLoadedSourcePackageInput = {
  readonly executionModules: LoadedExecutionModules;
  readonly schemaDefinition: unknown;
  readonly sourceMaps: AnalyzerSourceMapInput;
  readonly sourceMapFailure?: "fail" | "ignore";
};

export class AnalyzerSchemaError extends Data.TaggedError("AnalyzerSchemaError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AnalyzerFunctionMetadataError extends Data.TaggedError("AnalyzerFunctionMetadataError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AnalyzerValidatorError extends Data.TaggedError("AnalyzerValidatorError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AnalyzerPartitionError extends Data.TaggedError("AnalyzerPartitionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AnalyzerSourceMapError extends Data.TaggedError("AnalyzerSourceMapError")<{
  readonly message: string;
  readonly moduleName: string;
  readonly cause?: unknown;
}> {}

export class AnalyzerHostImportError extends Data.TaggedError("AnalyzerHostImportError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AnalyzerNondeterministicError extends Data.TaggedError("AnalyzerNondeterministicError")<{
  readonly message: string;
  readonly diagnostics: readonly AnalyzerDiagnostic[];
}> {}

export type AnalyzerResponseErrorCode =
  | "invalid_success_envelope"
  | "missing_codegen_analysis"
  | "protocol_validation";

export class AnalyzerResponseError extends Data.TaggedError("AnalyzerResponseError")<{
  readonly code: AnalyzerResponseErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type AnalyzerSemanticError =
  | AnalyzerSchemaError
  | AnalyzerFunctionMetadataError
  | AnalyzerValidatorError
  | AnalyzerPartitionError
  | AnalyzerSourceMapError;

type RuntimeFunction = Readonly<Record<string, unknown>> | ((...args: never[]) => unknown);
type OptionalKeys<T extends object> = {
  [Key in keyof T]-?: undefined extends T[Key] ? Key : never
}[keyof T];

type RequiredKeys<T extends object> = Exclude<keyof T, OptionalKeys<T>>;

type MutableDeep<T> =
  T extends readonly (infer Item)[] ? MutableDeep<Item>[] :
  T extends object ? (
    { -readonly [Key in RequiredKeys<T>]: MutableDeep<T[Key]> } &
    { -readonly [Key in OptionalKeys<T>]?: MutableDeep<Exclude<T[Key], undefined>> }
  ) :
  T;

type BackendDeploymentAnalysis = MutableDeep<ProtocolDeploymentAnalysis>;
type BackendDeploymentCodegenAnalysis = MutableDeep<ProtocolDeploymentCodegenAnalysis>;
type BackendDeploymentCodegenModule = MutableDeep<ProtocolDeploymentCodegenModule>;
type BackendValidatorJson = MutableDeep<ProtocolValidatorJson>;
type BackendFunctionPartitionMetadata = NonNullable<MutableDeep<ProtocolDeploymentFunctionMetadata>["partition"]>;

export type AnalyzerSuccessEnvelope = {
  readonly analysis: unknown;
  readonly codegenAnalysis: unknown;
  readonly diagnostics?: readonly AnalyzerDiagnostic[];
};

export type AnalyzerProtocolSuccessResponse = {
  readonly analysis: ProtocolDeploymentAnalysis;
  readonly codegenAnalysis: ProtocolDeploymentCodegenAnalysis;
  readonly diagnostics?: readonly AnalyzerDiagnostic[];
};

type SourcePositionResolver = (
  moduleName: string,
  exportName: string,
) => AnalyzedSourcePosition | undefined;

type SourceMapJson = {
  readonly sources?: readonly string[];
  readonly sourcesContent?: ReadonlyArray<string | null>;
};

export const analyzeLoadedSourcePackageEffect = Effect.fn(
  "FlarexAnalysis.analyzeLoadedSourcePackage",
)(function* (
  input: AnalyzeLoadedSourcePackageInput,
): Effect.fn.Return<DeploymentAnalysis, AnalyzerSemanticError> {
  const schema = yield* analyzeSchemaDefinitionEffect(input.schemaDefinition);
  const positionFor = yield* sourcePositionResolverFromSourceMapsEffect(input.sourceMaps, {
    failure: input.sourceMapFailure ?? "fail",
  });
  const rawFunctions = yield* analyzeExecutionModulesEffect(input.executionModules, { positionFor });
  const functions = yield* validateAndLowerFunctionPartitionsEffect(rawFunctions, schema);
  return { functions, schema };
});

export const decodeAnalyzerSuccessEnvelopeEffect = Effect.fn(
  "FlarexAnalysis.decodeAnalyzerSuccessEnvelope",
)(function* (
  value: unknown,
): Effect.fn.Return<AnalyzerSuccessEnvelope, AnalyzerResponseError> {
  if (!isRecord(value) || "error" in value) {
    return yield* analyzerResponseFailure(
      "invalid_success_envelope",
      "Analyzer success response must be an object without error.",
      value,
    );
  }
  if (!("analysis" in value) || value.analysis === undefined) {
    return yield* analyzerResponseFailure(
      "invalid_success_envelope",
      "Analyzer success response must include analysis.",
      value,
    );
  }
  if (!("codegenAnalysis" in value)) {
    return yield* analyzerResponseFailure(
      "missing_codegen_analysis",
      "Analyzer response did not include codegenAnalysis.",
      value,
    );
  }
  if (value.codegenAnalysis === undefined || value.codegenAnalysis === null) {
    return yield* analyzerResponseFailure(
      "invalid_success_envelope",
      "Analyzer success response must include codegenAnalysis.",
      value,
    );
  }
  const diagnostics = normalizeOptionalAnalyzerDiagnostics(value);
  return {
    analysis: value.analysis,
    codegenAnalysis: value.codegenAnalysis,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
});

export const decodeAnalyzerProtocolSuccessResponseEffect = Effect.fn(
  "FlarexAnalysis.decodeAnalyzerProtocolSuccessResponse",
)(function* (
  value: AnalyzerSuccessEnvelope,
): Effect.fn.Return<AnalyzerProtocolSuccessResponse, AnalyzerResponseError> {
  const analysis = yield* decodeDeploymentAnalysisEffect(value.analysis).pipe(
    Effect.mapError(error =>
      new AnalyzerResponseError({
        code: "protocol_validation",
        message: error.message,
        cause: error,
      })
    ),
  );
  const codegenAnalysis = yield* decodeDeploymentCodegenAnalysisEffect(value.codegenAnalysis).pipe(
    Effect.mapError(error =>
      new AnalyzerResponseError({
        code: "protocol_validation",
        message: error.message,
        cause: error,
      })
    ),
  );
  return {
    analysis,
    codegenAnalysis,
    ...(value.diagnostics === undefined ? {} : { diagnostics: value.diagnostics }),
  };
});

export const analyzeSchemaDefinitionEffect = Effect.fn(
  "FlarexAnalysis.analyzeSchemaDefinition",
)(function* (
  value: unknown,
): Effect.fn.Return<AnalyzedSchema, AnalyzerSchemaError | AnalyzerValidatorError> {
  if (value === undefined) return emptySchema();
  if (!isRecord(value)) {
    return yield* schemaFailure("Schema default export must be a Flarex schema definition.");
  }
  const rawTables = yield* readSchemaPropertyEffect(
    value,
    "tables",
    "schema.tables",
  );
  if (!isRecord(rawTables)) {
    return yield* schemaFailure("Schema default export must be a Flarex schema definition.");
  }
  const entries = yield* Effect.try({
    try: () =>
      Object.entries(rawTables)
        .filter((entry): entry is [string, Record<string, unknown>] =>
          isRecord(entry[1]) && entry[1].kind === "table"
        )
        .sort(([left], [right]) => compareUtf16Strings(left, right)),
    catch: (cause) =>
      schemaError("Schema table metadata inspection failed.", cause),
  });
  const tableIds = new Map(entries.map(([name], index) => [name, index + 1] as const));
  const tables: AnalyzedSchema["tables"][number][] = [];
  const indexes: AnalyzedSchema["indexes"][number][] = [];
  let nextIndexId = 1;

  for (const [name, table] of entries) {
    const tableId = tableIds.get(name);
    if (tableId === undefined) {
      return yield* schemaFailure(`Schema table "${name}" has no generated table id.`);
    }
    tables.push({
      tableId,
      name,
      validator: yield* analyzeTableValidatorEffect(
        yield* readSchemaPropertyEffect(
          table,
          "validator",
          `schema.tables.${name}.validator`,
        ),
        name,
      ),
      placement: yield* analyzePlacementEffect(
        yield* readSchemaPropertyEffect(
          table,
          "placement",
          `schema.tables.${name}.placement`,
        ),
        name,
      ),
    });
    const tableIndexes = yield* analyzeIndexesEffect(
      yield* readSchemaPropertyEffect(
        table,
        "indexes",
        `schema.tables.${name}.indexes`,
      ),
      name,
    );
    for (const index of tableIndexes) {
      indexes.push({
        indexId: nextIndexId++,
        tableId,
        name: index.name,
        fields: index.fields,
      });
    }
  }

  return { version: 1, tables, indexes };
});

export const analyzeExecutionModulesEffect = Effect.fn(
  "FlarexAnalysis.analyzeExecutionModules",
)(function* (
  analyzedExports: LoadedExecutionModules,
  options: { readonly positionFor?: SourcePositionResolver } = {},
): Effect.fn.Return<
  readonly AnalyzedModule[],
  AnalyzerFunctionMetadataError | AnalyzerValidatorError | AnalyzerPartitionError
> {
  const modules: AnalyzedModule[] = [];
  const moduleEntries = yield* Effect.try({
    try: () =>
      Object.entries(analyzedExports)
        .sort(([left], [right]) => compareUtf16Strings(left, right)),
    catch: (cause) =>
      functionMetadataError(
        "Execution-module namespace inspection failed.",
        cause,
      ),
  });
  for (const [moduleName, exports] of moduleEntries) {
    const functions: AnalyzedFunction[] = [];
    const exportEntries = yield* Effect.try({
      try: () =>
        Object.entries(exports)
          .sort(([left], [right]) => compareUtf16Strings(left, right)),
      catch: (cause) =>
        functionMetadataError(
          `Execution module "${moduleName}" export inspection failed.`,
          cause,
        ),
    });
    for (const [exportName, value] of exportEntries) {
      const analyzed = yield* analyzeExportEffect(moduleName, exportName, value, options.positionFor);
      if (analyzed !== null) functions.push(analyzed);
    }
    modules.push({ moduleName, functions });
  }
  return modules;
});

export const validateAndLowerFunctionPartitionsEffect = Effect.fn(
  "FlarexAnalysis.validateAndLowerFunctionPartitions",
)(function* (
  modules: readonly AnalyzedModule[],
  schema: AnalyzedSchema,
): Effect.fn.Return<readonly AnalyzedModule[], AnalyzerPartitionError> {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  const loweredModules: AnalyzedModule[] = [];
  for (const module of modules) {
    const functions: AnalyzedFunction[] = [];
    for (const fn of module.functions) {
      const partition = fn.partition;
      if (partition === undefined || partition === null) {
        functions.push(fn);
        continue;
      }
      const path = `${module.moduleName}:${fn.exportName}`;
      const table = tables.get(partition.table);
      if (table === undefined) {
        return yield* partitionFailure(`${path}.partition: Unknown partition table ${partition.table}.`);
      }
      if (table.placement.kind !== "partitionBy") {
        return yield* partitionFailure(`${path}.partition: Table ${partition.table} is not partitioned.`);
      }
      if (partition.type === "partitionRoot") {
        functions.push({
          ...fn,
          partition: yield* lowerRootPartitionEffect(fn, partition, table, path),
        });
        continue;
      }
      if (partition.type === "partitionCreateRoot") {
        if (table.placement.field !== partition.partitionField) {
          return yield* partitionFailure(
            `${path}.partition: create-root policy targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
          );
        }
        functions.push(fn);
        continue;
      }
      if (table.placement.field !== partition.partitionField) {
        return yield* partitionFailure(
          `${path}.partition: Selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
        );
      }
      const expectedSelector = selectorNameForPartitionField(table.placement.field);
      if (partition.selector !== expectedSelector) {
        return yield* partitionFailure(
          `${path}.partition: Expected selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
        );
      }
      if (!validatorHasRequiredField(fn.args, partition.argField)) {
        return yield* partitionFailure(`${path}.partition: args.${partition.argField} is not a required argument.`);
      }
      functions.push(fn);
    }
    loweredModules.push({ ...module, functions });
  }
  return loweredModules;
});

export const sourcePositionResolverFromSourceMapsEffect = Effect.fn(
  "FlarexAnalysis.sourcePositionResolverFromSourceMaps",
)(function* (
  sourceMaps: AnalyzerSourceMapInput,
  options: { readonly failure?: "fail" | "ignore" } = {},
): Effect.fn.Return<SourcePositionResolver, AnalyzerSourceMapError> {
  const positions = new Map<string, AnalyzedSourcePosition>();
  for (const [moduleName, rawSourceMap] of Object.entries(sourceMaps)) {
    const sourceMap = yield* parseSourceMapEffect(moduleName, rawSourceMap, options.failure ?? "fail");
    if (sourceMap === undefined) continue;
    const sourceIndex = findSourceIndex(sourceMap.sources ?? [], moduleName);
    if (sourceIndex === undefined) continue;
    const sourcePath = sourceMap.sources?.[sourceIndex];
    const source = sourceMap.sourcesContent?.[sourceIndex];
    if (sourcePath === undefined || typeof source !== "string") continue;
    for (const [exportName, position] of exportedFunctionPositions(sourcePath, source)) {
      positions.set(`${moduleName}:${exportName}`, position);
    }
  }
  return (moduleName, exportName) => positions.get(`${moduleName}:${exportName}`);
});

export const deploymentAnalysisFromCodegenAnalysisEffect = Effect.fn(
  "FlarexAnalysis.deploymentAnalysisFromCodegenAnalysis",
)(function* (
  analysis: DeploymentAnalysis,
): Effect.fn.Return<BackendDeploymentAnalysis, AnalyzerValidatorError | AnalyzerPartitionError> {
  return {
    schema: yield* backendSchemaFromAnalyzedSchemaEffect(analysis.schema),
    functions: {
      functions: yield* Effect.forEach(
        analysis.functions.flatMap(module =>
          module.functions.map(fn => ({ moduleName: module.moduleName, fn })),
        ),
        ({ moduleName, fn }) => backendFunctionMetadataEffect(moduleName, fn),
      ),
    },
  };
});

export const backendCodegenAnalysisFromCodegenAnalysisEffect = Effect.fn(
  "FlarexAnalysis.backendCodegenAnalysisFromCodegenAnalysis",
)(function* (
  analysis: DeploymentAnalysis,
): Effect.fn.Return<BackendDeploymentCodegenAnalysis, AnalyzerValidatorError | AnalyzerPartitionError> {
  const functions = yield* Effect.forEach(analysis.functions, module =>
    backendCodegenModuleEffect(module),
  );
  return {
    schema: yield* backendSchemaFromAnalyzedSchemaEffect(analysis.schema),
    functions,
  };
});

export function normalizeAnalyzerDiagnostics(value: unknown): AnalyzerDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-100).flatMap(diagnostic => {
    if (!isRecord(diagnostic)) return [];
    const level = diagnostic.level;
    const message = diagnostic.message;
    if ((level !== "log" && level !== "warn" && level !== "error") || typeof message !== "string") {
      return [];
    }
    return [{ level, message }];
  });
}

export function normalizeOptionalAnalyzerDiagnostics(value: unknown): AnalyzerDiagnostic[] | undefined {
  if (!isRecord(value) || !("diagnostics" in value) || value.diagnostics === undefined) {
    return undefined;
  }
  if (!Array.isArray(value.diagnostics)) return undefined;
  return normalizeAnalyzerDiagnostics(value.diagnostics);
}

function emptySchema(): AnalyzedSchema {
  return { version: 1, tables: [], indexes: [] };
}

function readSchemaPropertyEffect(
  value: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): Effect.Effect<unknown, AnalyzerSchemaError> {
  return Effect.try({
    try: () => value[key],
    catch: (cause) =>
      schemaError(`Schema property "${path}" could not be inspected.`, cause),
  });
}

const analyzeTableValidatorEffect = Effect.fn(function* (
  value: unknown,
  tableName: string,
): Effect.fn.Return<ValidatorJSON, AnalyzerSchemaError | AnalyzerValidatorError> {
  if (!isRecord(value)) {
    return yield* schemaFailure(`Schema table "${tableName}" has an invalid document validator.`);
  }
  const isFlarexValidator = yield* readSchemaPropertyEffect(
    value,
    "isFlarexValidator",
    `schema.tables.${tableName}.validator.isFlarexValidator`,
  );
  if (isFlarexValidator !== true) {
    return yield* schemaFailure(`Schema table "${tableName}" has an invalid document validator.`);
  }
  const json = yield* readSchemaPropertyEffect(
    value,
    "json",
    `schema.tables.${tableName}.validator.json`,
  );
  if (json === undefined) {
    return yield* schemaFailure(`Schema table "${tableName}" has an invalid document validator.`);
  }
  const validator = yield* assertValidatorJsonEffect(
    json,
    `schema.tables.${tableName}.validator`,
  );
  if (validator === null || validator.type !== "object") {
    return yield* schemaFailure(`Schema table "${tableName}" document validator must be an object validator.`);
  }
  return validator;
});

const analyzePlacementEffect = Effect.fn(function* (
  value: unknown,
  tableName: string,
): Effect.fn.Return<AnalyzedSchema["tables"][number]["placement"], AnalyzerSchemaError> {
  if (value === undefined) return { kind: "partitionBy", field: "_id" };
  if (!isRecord(value)) {
    return yield* schemaFailure(`Schema table "${tableName}" has an invalid placement.`);
  }
  const kind = yield* readSchemaPropertyEffect(
    value,
    "kind",
    `schema.tables.${tableName}.placement.kind`,
  );
  if (kind === "global") return { kind: "global" };
  if (kind === "partitionBy") {
    const field = yield* readSchemaPropertyEffect(
      value,
      "field",
      `schema.tables.${tableName}.placement.field`,
    );
    if (typeof field === "string") {
      return { kind: "partitionBy", field };
    }
  }
  if (kind === "colocateWith") {
    const table = yield* readSchemaPropertyEffect(
      value,
      "table",
      `schema.tables.${tableName}.placement.table`,
    );
    const field = yield* readSchemaPropertyEffect(
      value,
      "field",
      `schema.tables.${tableName}.placement.field`,
    );
    if (typeof table === "string" && typeof field === "string") {
      return { kind: "colocateWith", table, field };
    }
  }
  return yield* schemaFailure(`Schema table "${tableName}" has an invalid placement.`);
});

const analyzeIndexesEffect = Effect.fn(function* (
  value: unknown,
  tableName: string,
): Effect.fn.Return<
  ReadonlyArray<{ readonly name: string; readonly fields: readonly string[] }>,
  AnalyzerSchemaError
> {
  const rawIndexes = yield* Effect.try({
    try: () => Array.isArray(value) ? value : undefined,
    catch: (cause) =>
      schemaError(`Schema table "${tableName}" index inspection failed.`, cause),
  });
  if (rawIndexes === undefined) {
    return yield* schemaFailure(`Schema table "${tableName}" has invalid indexes.`);
  }
  const indexes: Array<{ name: string; fields: string[] }> = [];
  const indexCount = yield* Effect.try({
    try: () => rawIndexes.length,
    catch: (cause) =>
      schemaError(`Schema table "${tableName}" index count inspection failed.`, cause),
  });
  for (let position = 0; position < indexCount; position += 1) {
    const index = yield* Effect.try({
      try: () => rawIndexes[position],
      catch: (cause) =>
        schemaError(
          `Schema table "${tableName}" index at position ${position} could not be inspected.`,
          cause,
        ),
    });
    if (!isRecord(index)) {
      return yield* schemaFailure(`Schema table "${tableName}" has an invalid index at position ${position}.`);
    }
    const name = yield* readSchemaPropertyEffect(
      index,
      "name",
      `schema.tables.${tableName}.indexes[${position}].name`,
    );
    if (typeof name !== "string") {
      return yield* schemaFailure(`Schema table "${tableName}" has an invalid index at position ${position}.`);
    }
    const rawFields = yield* readSchemaPropertyEffect(
      index,
      "fields",
      `schema.tables.${tableName}.indexes[${position}].fields`,
    );
    const fieldArray = yield* Effect.try({
      try: () => Array.isArray(rawFields) ? rawFields : undefined,
      catch: (cause) =>
        schemaError(
          `Schema table "${tableName}" index fields at position ${position} could not be inspected.`,
          cause,
        ),
    });
    if (fieldArray === undefined) {
      return yield* schemaFailure(`Schema table "${tableName}" has an invalid index at position ${position}.`);
    }
    const fieldCount = yield* Effect.try({
      try: () => fieldArray.length,
      catch: (cause) =>
        schemaError(
          `Schema table "${tableName}" index field count at position ${position} could not be inspected.`,
          cause,
        ),
    });
    const fields: string[] = [];
    for (
      let fieldPosition = 0;
      fieldPosition < fieldCount;
      fieldPosition += 1
    ) {
      const field = yield* Effect.try({
        try: () => fieldArray[fieldPosition],
        catch: (cause) =>
          schemaError(
            `Schema table "${tableName}" index field ${fieldPosition} at position ${position} could not be inspected.`,
            cause,
          ),
      });
      if (typeof field !== "string") {
        return yield* schemaFailure(`Schema table "${tableName}" has an invalid index at position ${position}.`);
      }
      fields.push(field);
    }
    indexes.push({ name, fields });
  }
  return indexes;
});

const analyzeExportEffect = Effect.fn(function* (
  moduleName: string,
  exportName: string,
  value: unknown,
  positionFor: SourcePositionResolver | undefined,
): Effect.fn.Return<
  AnalyzedFunction | null,
  AnalyzerFunctionMetadataError | AnalyzerValidatorError | AnalyzerPartitionError
> {
  if (!isRuntimeFunction(value)) return null;

  const classification = yield* Effect.try({
    try: () => ({
      kind: functionKind(value),
      visibility: functionVisibility(value),
    }),
    catch: (cause) =>
      functionMetadataError(
        `${moduleName}:${exportName} marker inspection failed.`,
        cause,
      ),
  });
  const kind = classification.kind;
  if (kind === null) return null;
  const visibility = classification.visibility;
  if (visibility === null) return null;

  const identifier = `${moduleName}:${exportName}`;
  yield* assertHandlerEffect(value, identifier);
  const position = positionFor?.(moduleName, exportName);
  return {
    moduleName,
    exportName,
    kind,
    visibility,
    args: yield* parseArgsValidatorEffect(value, identifier),
    returns: yield* parseValidatorExportEffect(value, "exportReturns", identifier, null, true),
    partition: yield* parsePartitionExportEffect(value, identifier),
    ...(position === undefined ? {} : { position }),
  };
});

function lowerRootPartitionEffect(
  fn: AnalyzedFunction,
  partition: AnalyzedFunctionPartitionRootPolicy,
  table: AnalyzedSchema["tables"][number],
  path: string,
): Effect.Effect<AnalyzedFunctionPartitionPolicy | AnalyzedFunctionPartitionCreateRootPolicy, AnalyzerPartitionError> {
  return Effect.gen(function* () {
    if (table.placement.kind !== "partitionBy") {
      return yield* partitionFailure(`${path}.partition: Table ${partition.table} is not partitioned.`);
    }
    if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
      return yield* partitionFailure(
        `${path}.partition: model.${partition.table} requires ${partition.table} to be partitioned by _id.`,
      );
    }
    const idArgs = requiredIdArgsForTable(fn.args, partition.table);
    if (idArgs.length === 0) {
      if (fn.kind === "mutation" || fn.kind === "workflowMutation") {
        return {
          type: "partitionCreateRoot",
          table: partition.table,
          partitionField: "_id",
        };
      }
      return yield* partitionFailure(
        `${path}.partition: model.${partition.table} requires exactly one required v.id(${JSON.stringify(partition.table)}) argument.`,
      );
    }
    if (idArgs.length > 1) {
      return yield* partitionFailure(
        `${path}.partition: model.${partition.table} is ambiguous. Found multiple required ${partition.table} IDs: ${idArgs.join(", ")}.`,
      );
    }
    const argField = idArgs[0];
    if (argField === undefined) {
      return yield* partitionFailure(`${path}.partition: model.${partition.table} root argument was not resolved.`);
    }
    return {
      type: "partition",
      table: partition.table,
      selector: "byId",
      partitionField: "_id",
      argField,
    };
  });
}

function assertHandlerEffect(value: RuntimeFunction, identifier: string): Effect.Effect<void, AnalyzerFunctionMetadataError> {
  return Effect.gen(function* () {
    const handler = yield* Effect.try({
      try: () => "_handler" in value ? value._handler : undefined,
      catch: (cause) =>
        functionMetadataError(
          `${identifier}.handler inspection failed.`,
          cause,
        ),
    });
    if (handler !== undefined) {
      if (typeof handler !== "function") {
        return yield* functionMetadataFailure(`${identifier}.handler is not a function.`);
      }
      return;
    }
    if (typeof value !== "function") {
      return yield* functionMetadataFailure(`${identifier} is not a function.`);
    }
  });
}

function parseValidatorExportEffect(
  value: RuntimeFunction,
  exporterName: "exportArgs" | "exportReturns",
  identifier: string,
  defaultValue: ValidatorJSON | null,
  allowNull: boolean,
): Effect.Effect<ValidatorJSON | null, AnalyzerValidatorError> {
  return Effect.gen(function* () {
    const candidate = value as Record<string, unknown>;
    const exporter = yield* Effect.try({
      try: () =>
        exporterName in candidate ? candidate[exporterName] : undefined,
      catch: (cause) =>
        validatorError(
          `${identifier}.${exporterName} inspection failed.`,
          cause,
        ),
    });
    if (exporter === undefined) return defaultValue;
    if (typeof exporter !== "function") {
      return yield* validatorFailure(`${identifier}.${exporterName} is not a function or \`undefined\`.`);
    }

    const serialized = yield* Effect.try({
      try: () => exporter.call(value) as unknown,
      catch: (cause) =>
        validatorError(
          `${identifier}.${exporterName}() failed.`,
          cause,
        ),
    });
    if (typeof serialized !== "string") {
      return yield* validatorFailure(
        `Invalid ${exporterName} return value: ${identifier}.${exporterName}() didn't return a string.`,
      );
    }

    const parsed = yield* parseJsonEffect(
      serialized,
      error => `Invalid JSON returned from ${identifier}.${exporterName}(): ${errorMessage(error)}`,
    );
    if (parsed === null && allowNull) return null;
    const validator = yield* assertValidatorJsonEffect(parsed, `${identifier}.${exporterName}()`).pipe(
      Effect.mapError(error =>
        validatorError(
          `Invalid validator returned from ${identifier}.${exporterName}(): ${errorMessage(error)}`,
          error,
        )
      ),
    );
    if (validator === null) {
      return yield* validatorFailure(`Invalid validator returned from ${identifier}.${exporterName}(): Validator is required.`);
    }
    if (!allowNull && validator.type !== "object" && validator.type !== "any") {
      return yield* validatorFailure(
        `Invalid validator returned from ${identifier}.${exporterName}(): Argument validator must be an object validator or v.any().`,
      );
    }
    return validator;
  });
}

function parseArgsValidatorEffect(
  value: RuntimeFunction,
  identifier: string,
): Effect.Effect<ValidatorJSON, AnalyzerValidatorError> {
  return Effect.gen(function* () {
    const validator = yield* parseValidatorExportEffect(value, "exportArgs", identifier, { type: "any" }, false);
    if (validator === null) {
      return yield* validatorFailure(`Invalid validator returned from ${identifier}.exportArgs(): Validator is required.`);
    }
    return validator;
  });
}

function parsePartitionExportEffect(
  value: RuntimeFunction,
  identifier: string,
): Effect.Effect<ParsedFunctionPartitionPolicy | null, AnalyzerValidatorError | AnalyzerPartitionError> {
  return Effect.gen(function* () {
    const candidate = value as Record<string, unknown>;
    const exporter = yield* Effect.try({
      try: () =>
        "exportPartition" in candidate ? candidate.exportPartition : undefined,
      catch: (cause) =>
        partitionError(
          `${identifier}.exportPartition inspection failed.`,
          cause,
        ),
    });
    if (exporter === undefined) return null;
    if (typeof exporter !== "function") {
      return yield* partitionFailure(`${identifier}.exportPartition is not a function or \`undefined\`.`);
    }

    const serialized = yield* Effect.try({
      try: () => exporter.call(value) as unknown,
      catch: (cause) =>
        partitionError(
          `${identifier}.exportPartition() failed.`,
          cause,
        ),
    });
    if (typeof serialized !== "string") {
      return yield* partitionFailure(
        `Invalid exportPartition return value: ${identifier}.exportPartition() didn't return a string.`,
      );
    }

    const parsed = yield* parsePartitionJsonEffect(
      serialized,
      error => `Invalid JSON returned from ${identifier}.exportPartition(): ${errorMessage(error)}`,
    );
    return yield* assertPartitionPolicyEffect(parsed, `${identifier}.exportPartition()`);
  });
}

function assertPartitionPolicyEffect(
  value: unknown,
  path: string,
): Effect.Effect<ParsedFunctionPartitionPolicy | null, AnalyzerPartitionError> {
  return Effect.gen(function* () {
    if (value === null) return null;
    if (!isRecord(value)) return yield* partitionFailure(`${path}: Invalid partition policy.`);
    if (
      value.type === "partitionRoot" &&
      typeof value.table === "string" &&
      value.table.length > 0 &&
      typeof value.partitionField === "string" &&
      value.partitionField.length > 0
    ) {
      return {
        type: "partitionRoot",
        table: value.table,
        partitionField: value.partitionField,
      };
    }
    if (
      value.type === "partition" &&
      typeof value.table === "string" &&
      value.table.length > 0 &&
      typeof value.selector === "string" &&
      value.selector.length > 0 &&
      typeof value.partitionField === "string" &&
      value.partitionField.length > 0 &&
      typeof value.argField === "string" &&
      value.argField.length > 0
    ) {
      return {
        type: "partition",
        table: value.table,
        selector: value.selector,
        partitionField: value.partitionField,
        argField: value.argField,
      };
    }
    return yield* partitionFailure(`${path}: Invalid partition policy.`);
  });
}

function parseSourceMapEffect(
  moduleName: string,
  rawSourceMap: string,
  failure: "fail" | "ignore",
): Effect.Effect<SourceMapJson | undefined, AnalyzerSourceMapError> {
  return Effect.try({
    try: () => JSON.parse(rawSourceMap) as SourceMapJson,
    catch: cause =>
      new AnalyzerSourceMapError({
        moduleName,
        message: `Source map for ${moduleName} must be valid JSON.`,
        cause,
      }),
  }).pipe(
    Effect.catchTag("AnalyzerSourceMapError", error =>
      failure === "ignore" ? Effect.succeed(undefined) : Effect.fail(error)
    ),
  );
}

function parseJsonEffect(
  serialized: string,
  message: (error: unknown) => string,
): Effect.Effect<unknown, AnalyzerValidatorError> {
  return Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: cause => validatorError(message(cause), cause),
  });
}

function parsePartitionJsonEffect(
  serialized: string,
  message: (error: unknown) => string,
): Effect.Effect<unknown, AnalyzerPartitionError> {
  return Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: cause => new AnalyzerPartitionError({
      message: message(cause),
      cause,
    }),
  });
}

function assertValidatorJsonEffect(
  value: unknown,
  path: string,
): Effect.Effect<ValidatorJSON | null, AnalyzerValidatorError> {
  return Effect.try({
    try: () => assertValidatorJson(value, path),
    catch: cause => validatorError(errorMessage(cause), cause),
  });
}

function findSourceIndex(sources: readonly string[], moduleName: string): number | undefined {
  const candidates = [
    `${moduleName}.ts`,
    `${moduleName}.tsx`,
    `${moduleName}.js`,
    `${moduleName}.jsx`,
    `${moduleName}.mts`,
    `${moduleName}.cts`,
  ];
  const index = sources.findIndex(source => candidates.includes(source));
  return index === -1 ? undefined : index;
}

function exportedFunctionPositions(
  sourcePath: string,
  source: string,
): Array<[string, AnalyzedSourcePosition]> {
  const positions: Array<[string, AnalyzedSourcePosition]> = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const named = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (named) {
      const exportName = named[1];
      if (exportName !== undefined) {
        positions.push([
          exportName,
          { path: sourcePath, startLine: index + 1, startColumn: named.index + 1 },
        ]);
      }
      return;
    }
    const defaultMatch = /\bexport\s+default\b/.exec(line);
    if (defaultMatch) {
      positions.push([
        "default",
        { path: sourcePath, startLine: index + 1, startColumn: defaultMatch.index + 1 },
      ]);
    }
  });
  return positions;
}

function isRuntimeFunction(value: unknown): value is RuntimeFunction {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function functionKind(value: RuntimeFunction): AnalyzedFunction["kind"] | null {
  const kinds = [
    ["isQuery", "query"],
    ["isMutation", "mutation"],
    ["isWorkflowMutation", "workflowMutation"],
    ["isAction", "action"],
  ] as const;
  const marked = kinds.filter(([marker]) => marker in value);
  return marked.length === 1 ? marked[0]?.[1] ?? null : null;
}

function functionVisibility(value: RuntimeFunction): AnalyzedFunction["visibility"] | null {
  const publicFunction = "isPublic" in value;
  const internalFunction = "isInternal" in value;
  if (publicFunction === internalFunction) return null;
  return publicFunction ? "public" : "internal";
}

function validatorHasRequiredField(validator: ValidatorJSON, field: string): boolean {
  return (
    validator.type === "object" &&
    Object.prototype.hasOwnProperty.call(validator.value, field) &&
    validator.value[field]?.optional === false
  );
}

function requiredIdArgsForTable(validator: ValidatorJSON, tableName: string): string[] {
  if (validator.type !== "object") return [];
  return Object.entries(validator.value)
    .filter(([, field]) =>
      field.optional === false &&
      field.fieldType.type === "id" &&
      field.fieldType.tableName === tableName,
    )
    .map(([fieldName]) => fieldName)
    .sort();
}

function backendSchemaFromAnalyzedSchemaEffect(
  schema: AnalyzedSchema,
): Effect.Effect<BackendDeploymentAnalysis["schema"], AnalyzerValidatorError> {
  return Effect.gen(function* () {
    return {
      version: schema.version,
      tables: yield* Effect.forEach(schema.tables, table =>
        Effect.gen(function* () {
          return {
            tableId: table.tableId,
            name: table.name,
            validator: yield* backendRequiredValidatorJsonEffect(table.validator),
            placement: table.placement,
          };
        })
      ),
      indexes: schema.indexes.map(index => ({
        indexId: index.indexId,
        tableId: index.tableId,
        name: index.name,
        fields: [...index.fields],
      })),
    };
  });
}

function backendFunctionMetadataEffect(
  moduleName: string,
  fn: AnalyzedFunction,
): Effect.Effect<MutableDeep<ProtocolDeploymentFunctionMetadata>, AnalyzerValidatorError | AnalyzerPartitionError> {
  return Effect.gen(function* () {
    return {
      path: fn.exportName === "default" ? moduleName : `${moduleName}:${fn.exportName}`,
      kind: fn.kind,
      visibility: fn.visibility,
      args: yield* backendValidatorJsonEffect(fn.args),
      returns: yield* backendValidatorJsonEffect(fn.returns),
      route: null,
      partition: yield* backendFunctionPartitionEffect(fn.partition ?? null),
      ...(fn.position === undefined ? {} : { position: fn.position }),
    };
  });
}

function backendCodegenModuleEffect(
  module: AnalyzedModule,
): Effect.Effect<BackendDeploymentCodegenModule, AnalyzerValidatorError | AnalyzerPartitionError> {
  return Effect.gen(function* () {
    return {
      moduleName: module.moduleName,
      functions: yield* Effect.forEach(module.functions, fn =>
        Effect.gen(function* () {
          return {
            moduleName: fn.moduleName,
            exportName: fn.exportName,
            kind: fn.kind,
            visibility: fn.visibility,
            args: yield* backendRequiredValidatorJsonEffect(fn.args),
            returns: yield* backendValidatorJsonEffect(fn.returns),
            partition: yield* backendFunctionPartitionEffect(fn.partition ?? null),
            ...(fn.position === undefined ? {} : { position: fn.position }),
          };
        })
      ),
    };
  });
}

function backendFunctionPartitionEffect(
  partition: ParsedFunctionPartitionPolicy | null,
): Effect.Effect<BackendFunctionPartitionMetadata | null, AnalyzerPartitionError> {
  return Effect.gen(function* () {
    if (partition === null) return null;
    switch (partition.type) {
      case "partition":
        return {
          type: "partition",
          table: partition.table,
          selector: partition.selector,
          partitionField: partition.partitionField,
          argField: partition.argField,
        };
      case "partitionCreateRoot":
        return {
          type: "partitionCreateRoot",
          table: partition.table,
          partitionField: partition.partitionField,
        };
      case "partitionRoot":
        return yield* partitionFailure(
          `partitionRoot metadata for table ${partition.table} is not executable backend metadata.`,
        );
    }
  });
}

const decodeProtocolValidatorJsonEffect = Schema.decodeUnknownEffect(
  ProtocolValidatorJsonSchema,
);

export const backendValidatorJsonEffect = Effect.fn(
  "FlarexAnalysis.backendValidatorJson",
)(function* (
  value: ValidatorJSON | null,
): Effect.fn.Return<BackendValidatorJson | null, AnalyzerValidatorError> {
  const validator = yield* backendValidatorJsonWorker(value);
  if (validator === null) return null;
  yield* decodeProtocolValidatorJsonEffect(validator).pipe(
    Effect.mapError(cause => validatorError(
      `Invalid backend validator metadata: ${errorMessage(cause)}`,
      cause,
    )),
  );
  return validator;
});

function backendValidatorJsonWorker(
  value: ValidatorJSON | null,
): Effect.Effect<BackendValidatorJson | null, AnalyzerValidatorError> {
  return Effect.gen(function* () {
    if (value === null) return null;
    switch (value.type) {
      case "null":
      case "number":
      case "bigint":
      case "boolean":
      case "string":
      case "bytes":
      case "any":
        return { type: value.type };
      case "id": {
        if (value.tableName.length === 0) {
          return yield* validatorFailure(
            "Invalid backend validator metadata: tableName must be a Convex-compatible table identifier",
          );
        }
        return { type: "id", tableName: value.tableName };
      }
      case "literal": {
        if (typeof value.value === "bigint") {
          return yield* validatorFailure("BigInt literal validators are not supported by backend deployment metadata.");
        }
        return { type: "literal", value: value.value };
      }
      case "array":
        return { type: "array", value: yield* backendRequiredValidatorJsonWorker(value.value) };
      case "object": {
        const fields: Array<readonly [
          string,
          { readonly fieldType: BackendValidatorJson; readonly optional: boolean },
        ]> = [];
        for (const [name, field] of Object.entries(value.value)) {
          fields.push([name, {
            fieldType: yield* backendRequiredValidatorJsonWorker(field.fieldType),
            optional: field.optional,
          }]);
        }
        return { type: "object", value: Object.fromEntries(fields) };
      }
      case "record":
        return {
          type: "record",
          keys: yield* backendRequiredValidatorJsonWorker(value.keys),
          values: yield* backendRequiredValidatorJsonWorker(value.values),
        };
      case "union":
        return {
          type: "union",
          value: yield* Effect.forEach(value.value, member => backendRequiredValidatorJsonWorker(member)),
        };
    }
  });
}

export const backendRequiredValidatorJsonEffect = Effect.fn(
  "FlarexAnalysis.backendRequiredValidatorJson",
)(
  (value: ValidatorJSON): Effect.Effect<BackendValidatorJson, AnalyzerValidatorError> =>
    backendValidatorJsonEffect(value).pipe(
      Effect.flatMap(validator => validator === null
        ? validatorFailure("Required backend validator cannot be null.")
        : Effect.succeed(validator)),
    ),
);

function backendRequiredValidatorJsonWorker(
  value: ValidatorJSON,
): Effect.Effect<BackendValidatorJson, AnalyzerValidatorError> {
  return backendValidatorJsonWorker(value).pipe(
    Effect.flatMap(validator => validator === null
      ? validatorFailure("Required backend validator cannot be null.")
      : Effect.succeed(validator)),
  );
}

function schemaFailure(message: string, cause?: unknown): Effect.Effect<never, AnalyzerSchemaError> {
  return Effect.fail(schemaError(message, cause));
}

function schemaError(message: string, cause?: unknown): AnalyzerSchemaError {
  return new AnalyzerSchemaError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function functionMetadataFailure(message: string, cause?: unknown): Effect.Effect<never, AnalyzerFunctionMetadataError> {
  return Effect.fail(functionMetadataError(message, cause));
}

function functionMetadataError(
  message: string,
  cause?: unknown,
): AnalyzerFunctionMetadataError {
  return new AnalyzerFunctionMetadataError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function validatorFailure(message: string, cause?: unknown): Effect.Effect<never, AnalyzerValidatorError> {
  return Effect.fail(validatorError(message, cause));
}

function validatorError(message: string, cause?: unknown): AnalyzerValidatorError {
  return new AnalyzerValidatorError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function partitionFailure(message: string, cause?: unknown): Effect.Effect<never, AnalyzerPartitionError> {
  return Effect.fail(partitionError(message, cause));
}

function partitionError(
  message: string,
  cause?: unknown,
): AnalyzerPartitionError {
  return new AnalyzerPartitionError({
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

function analyzerResponseFailure(
  code: AnalyzerResponseErrorCode,
  message: string,
  cause?: unknown,
): Effect.Effect<never, AnalyzerResponseError> {
  return Effect.fail(new AnalyzerResponseError({
    code,
    message,
    ...(cause === undefined ? {} : { cause }),
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
