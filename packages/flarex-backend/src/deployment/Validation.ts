import { isNonArrayRecord as isRecord } from "@flarex/utils/records";
import { Effect } from "effect";
import { decodeAnalyzerProtocolSuccessResponseEffect } from "@flarex/analysis";
import { decodeAuthConfigEffect } from "flarex-protocol/auth";
import type { AnalyzedStartPushRequest as ProtocolAnalyzedStartPushRequest } from "flarex-protocol/deployment";
import {
  decodeDeploymentStorageCodegenAnalysisJson,
  decodeDeploymentStorageDiagnosticsJson,
  decodeDeploymentStorageFunctionsJson,
  decodeDeploymentStorageSchemaJson,
  decodeDeploymentStorageSourcePackageJson,
} from "./StorageRows";
import type {
  AnalyzedSourcePosition,
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentCodegenModule,
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  DeploymentFunctions,
  DeploymentSchema,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  FunctionVisibility,
  Json,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
  SchemaTable,
  ValidatorJson,
} from "../types";
import { parseValidatorJson } from "../validation";
import { DeploymentValidationError } from "./Errors";

export interface DeploymentPushStatusRow extends Record<string, string | number | null> {
  push_id: string;
  state: string;
  source_package_json: string;
  schema_json: string | null;
  functions_json: string | null;
  codegen_analysis_json: string | null;
  error: string | null;
  diagnostics_json: string | null;
  created_at: number;
  updated_at: number;
}

export const decodeSourcePackage = Effect.fn("DeploymentValidation.decodeSourcePackage")(
  function* (sourcePackage: unknown): Effect.fn.Return<PushSourcePackage, DeploymentValidationError> {
    if (!isRecord(sourcePackage)) {
      return yield* deploymentValidationFailureEffect("Source package must be an object.");
    }
    if (!Array.isArray(sourcePackage.modules)) {
      return yield* deploymentValidationFailureEffect("Source package modules must be an array.");
    }
    if (!Array.isArray(sourcePackage.functions)) {
      return yield* deploymentValidationFailureEffect("Source package functions must be an array.");
    }
    if (typeof sourcePackage.execution !== "string" || sourcePackage.execution.length === 0) {
      return yield* deploymentValidationFailureEffect("Source package execution module is required.");
    }
    const seen = new Set<string>();
    const modules: PushSourcePackage["modules"] = [];
    for (const module of sourcePackage.modules) {
      if (!isRecord(module)) {
        return yield* deploymentValidationFailureEffect("Source package module must be an object.");
      }
      const path = module.path;
      if (typeof path !== "string" || path.length === 0) {
        return yield* deploymentValidationFailureEffect("Source package module has an invalid path.");
      }
      if (seen.has(path)) {
        return yield* deploymentValidationFailureEffect(`Duplicate source module path: ${path}.`);
      }
      seen.add(path);
      if (module.environment !== "isolate") {
        return yield* deploymentValidationFailureEffect(
          `Source module ${path} has unsupported environment ${module.environment}.`,
        );
      }
      const sha256 = module.sha256;
      if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
        return yield* deploymentValidationFailureEffect(`Source module ${path} has an invalid sha256.`);
      }
      if (module.source !== undefined && typeof module.source !== "string") {
        return yield* deploymentValidationFailureEffect(`Source module ${path} source must be a string.`);
      }
      if (module.sourceMap !== undefined && typeof module.sourceMap !== "string") {
        return yield* deploymentValidationFailureEffect(`Source module ${path} sourceMap must be a string.`);
      }
      modules.push({
        path,
        environment: "isolate",
        sha256,
        ...(module.source === undefined ? {} : { source: module.source }),
        ...(module.sourceMap === undefined ? {} : { sourceMap: module.sourceMap }),
      });
    }
    modules.sort((left, right) => left.path.localeCompare(right.path));
    if (!seen.has(sourcePackage.execution)) {
      return yield* deploymentValidationFailureEffect(
        `Source package execution module ${sourcePackage.execution} is missing.`,
      );
    }
    if (sourcePackage.schema !== undefined && typeof sourcePackage.schema !== "string") {
      return yield* deploymentValidationFailureEffect("Source package schema module must be a string.");
    }
    if (sourcePackage.schema !== undefined && !seen.has(sourcePackage.schema)) {
      return yield* deploymentValidationFailureEffect(
        `Source package schema module ${sourcePackage.schema} is missing.`,
      );
    }
    if (
      sourcePackage.authConfig !== undefined &&
      (typeof sourcePackage.authConfigModule !== "string" || sourcePackage.authConfigModule.length === 0)
    ) {
      return yield* deploymentValidationFailureEffect(
        "Source package auth config module is required when authConfig is present.",
      );
    }
    if (sourcePackage.authConfigModule !== undefined) {
      if (typeof sourcePackage.authConfigModule !== "string") {
        return yield* deploymentValidationFailureEffect("Source package auth config module must be a string.");
      }
      if (!seen.has(sourcePackage.authConfigModule)) {
        return yield* deploymentValidationFailureEffect(
          `Source package auth config module ${sourcePackage.authConfigModule} is missing.`,
        );
      }
      if (sourcePackage.authConfig === undefined) {
        return yield* deploymentValidationFailureEffect(
          "Source package authConfig is required when auth config module is present.",
        );
      }
    }
    const authConfig = sourcePackage.authConfig === undefined
      ? undefined
      : yield* decodeAuthConfigEffect(sourcePackage.authConfig).pipe(
        Effect.mapError(error => new DeploymentValidationError({ message: error.message })),
      );
    const functions = [...sourcePackage.functions].sort();
    for (const fn of functions) {
      if (typeof fn !== "string" || !seen.has(fn)) {
        return yield* deploymentValidationFailureEffect(`Source package function module ${String(fn)} is missing.`);
      }
    }
    return {
      modules,
      functions,
      ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
      ...(authConfig === undefined ? {} : { authConfig }),
      ...(sourcePackage.authConfigModule === undefined
        ? {}
        : { authConfigModule: sourcePackage.authConfigModule }),
      execution: sourcePackage.execution,
    };
  },
);

export const decodeDiagnostics = Effect.fn("DeploymentValidation.decodeDiagnostics")(
  function* (value: unknown): Effect.fn.Return<PushDiagnostic[], DeploymentValidationError> {
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      return yield* deploymentValidationFailureEffect("Push diagnostics must be an array.");
    }
    const diagnostics: PushDiagnostic[] = [];
    for (const [index, diagnostic] of value.slice(-100).entries()) {
      if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
        return yield* deploymentValidationFailureEffect(`Push diagnostic at index ${index} must be an object.`);
      }
      const record = diagnostic as Partial<PushDiagnostic>;
      if (record.level !== "log" && record.level !== "warn" && record.level !== "error") {
        return yield* deploymentValidationFailureEffect(`Push diagnostic at index ${index} has an invalid level.`);
      }
      if (typeof record.message !== "string") {
        return yield* deploymentValidationFailureEffect(`Push diagnostic at index ${index} has an invalid message.`);
      }
      diagnostics.push({
        level: record.level,
        message: record.message,
      });
    }
    return diagnostics;
  },
);

export const decodeAnalyzedStartPushRequest = Effect.fn(
  "DeploymentValidation.decodeAnalyzedStartPushRequest",
)(function* (
  request: ProtocolAnalyzedStartPushRequest,
): Effect.fn.Return<AnalyzedStartPushRequest, DeploymentValidationError> {
  const sourcePackage = yield* decodeSourcePackage(request.sourcePackage as PushSourcePackage);
  const diagnostics = request.diagnostics === undefined
    ? undefined
    : yield* decodeDiagnostics(request.diagnostics);
  if (request.analysis === undefined) {
    const error = request.error;
    if (error === undefined) {
      return yield* deploymentValidationFailureEffect("A push without analysis must include an error message.");
    }
    return {
      sourcePackage,
      error,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  return {
    sourcePackage,
    analysis: request.analysis,
    ...(request.codegenAnalysis === undefined ? {} : { codegenAnalysis: request.codegenAnalysis }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
});

export type StartAnalyzedPushServiceInput = {
  readonly sourcePackage: PushSourcePackage;
  readonly diagnostics: ReadonlyArray<PushDiagnostic>;
} & (
  | {
      readonly analysis: DeploymentAnalysis;
      readonly codegenAnalysis: DeploymentCodegenAnalysis;
    }
  | {
      readonly error: string;
    }
);

export interface StartAnalyzedPushInputPayload {
  readonly sourcePackage: unknown;
  readonly analysis?: unknown;
  readonly codegenAnalysis?: unknown;
  readonly error?: string | undefined;
  readonly diagnostics?: unknown;
}

export const decodeStartAnalyzedPushInput = Effect.fn(
  "DeploymentValidation.decodeStartAnalyzedPushInput",
)(function* (
  request: StartAnalyzedPushInputPayload,
): Effect.fn.Return<StartAnalyzedPushServiceInput, DeploymentValidationError> {
  const sourcePackage = yield* decodeSourcePackage(request.sourcePackage);
  const error = request.error;
  const analysis = request.analysis === undefined ? undefined : yield* decodeAnalysis(request.analysis);
  const diagnostics = yield* decodeDiagnostics(request.diagnostics);
  if (analysis === undefined) {
    if (typeof error !== "string" || error.length === 0) {
      return yield* deploymentValidationFailureEffect("A push without analysis must include an error message.");
    }
    return {
      sourcePackage,
      error,
      diagnostics,
    };
  }
  const hasCodegenAnalysis = Object.prototype.hasOwnProperty.call(request, "codegenAnalysis");
  const codegenAnalysis = yield* decodeCodegenAnalysis(
    hasCodegenAnalysis ? request.codegenAnalysis : codegenAnalysisFromDeploymentAnalysis(analysis),
    analysis,
  );
  yield* validateDeploymentAnalysisSourcePackageEffect(sourcePackage, analysis);
  yield* decodeAnalyzerProtocolSuccessResponseEffect({
    analysis,
    codegenAnalysis,
    diagnostics,
  }).pipe(
    Effect.mapError(error => new DeploymentValidationError({ message: error.message })),
  );
  return {
    sourcePackage,
    analysis,
    codegenAnalysis,
    diagnostics,
  };
});

export const decodePushStatusFromRow = Effect.fn("DeploymentValidation.decodePushStatusFromRow")(
  function* (row: DeploymentPushStatusRow): Effect.fn.Return<PushStatus, DeploymentValidationError> {
    const state = yield* decodePushState(row.state);
    const sourcePackageJson = yield* decodeDeploymentStorageSourcePackageJson(row.source_package_json);
    const sourcePackage = yield* decodeSourcePackage(sourcePackageJson);
    const diagnosticsJson = row.diagnostics_json === null
      ? []
      : yield* decodeDeploymentStorageDiagnosticsJson(row.diagnostics_json);
    const diagnostics = yield* decodeDiagnostics(diagnosticsJson);

    let storedAnalysis: DeploymentAnalysis | undefined;
    if (row.schema_json !== null || row.functions_json !== null) {
      if (row.schema_json === null || row.functions_json === null) {
        return yield* deploymentValidationFailureEffect(
          "Stored push analysis must include both schema_json and functions_json.",
        );
      }
      const schema = yield* decodeDeploymentStorageSchemaJson(row.schema_json);
      const functions = yield* decodeDeploymentStorageFunctionsJson(row.functions_json);
      storedAnalysis = yield* decodeAnalysis({
        schema,
        functions,
      });
    }

    const storedCodegenAnalysis = row.codegen_analysis_json === null
      ? undefined
      : yield* decodeDeploymentStorageCodegenAnalysisJson(row.codegen_analysis_json);
    const codegenAnalysis = storedAnalysis === undefined
      ? undefined
      : storedCodegenAnalysis === undefined
        ? codegenAnalysisFromDeploymentAnalysis(storedAnalysis)
        : yield* decodeCodegenAnalysis(storedCodegenAnalysis, storedAnalysis);
    if (storedAnalysis !== undefined) {
      yield* validateDeploymentAnalysisSourcePackageEffect(sourcePackage, storedAnalysis);
    }

    return {
      pushId: row.push_id,
      state,
      sourcePackage,
      ...(storedAnalysis !== undefined
        ? {
            analysis: storedAnalysis,
            codegenAnalysis: codegenAnalysis!,
          }
        : {}),
      ...(row.error === null ? {} : { error: row.error }),
      ...(diagnostics.length === 0 ? {} : { diagnostics }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
);

export function codegenAnalysisFromDeploymentAnalysis(
  analysis: DeploymentAnalysis,
): DeploymentCodegenAnalysis {
  const modules = new Map<string, DeploymentCodegenModule>();
  for (const metadata of analysis.functions.functions) {
    const { moduleName, exportName } = parseFunctionPath(metadata.path);
    const module = modules.get(moduleName) ?? { moduleName, functions: [] };
    module.functions.push({
      moduleName,
      exportName,
      kind: metadata.kind,
      visibility: metadata.visibility ?? "public",
      args: metadata.args ?? { type: "any" },
      returns: metadata.returns ?? null,
      partition: metadata.partition ?? null,
      ...(metadata.position === undefined ? {} : { position: metadata.position }),
    });
    modules.set(moduleName, module);
  }
  return {
    schema: analysis.schema,
    functions: [...modules.values()]
      .map(module => ({
        ...module,
        functions: module.functions.sort((left, right) =>
          left.exportName.localeCompare(right.exportName),
        ),
      }))
      .sort((left, right) => left.moduleName.localeCompare(right.moduleName)),
  };
}

function parseFunctionPath(path: string): { moduleName: string; exportName: string } {
  const separator = path.indexOf(":");
  if (separator === -1) return { moduleName: path, exportName: "default" };
  return {
    moduleName: path.slice(0, separator),
    exportName: path.slice(separator + 1),
  };
}

const decodePushState = Effect.fn("DeploymentValidation.decodePushState")(function* (
  value: string,
): Effect.fn.Return<PushStatus["state"], DeploymentValidationError> {
  if (
    value === "pending" ||
    value === "analyzed" ||
    value === "failed" ||
    value === "activated" ||
    value === "abandoned" ||
    value === "superseded"
  ) {
    return value;
  }
  return yield* deploymentValidationFailureEffect(`Unknown stored push state ${value}.`);
});

function deploymentValidationFailureEffect(message: string): Effect.Effect<never, DeploymentValidationError> {
  return Effect.fail(new DeploymentValidationError({ message }));
}

export const decodeSchema = Effect.fn("DeploymentValidation.decodeSchema")(
  function* (schema: unknown): Effect.fn.Return<DeploymentSchema, DeploymentValidationError> {
    if (!isRecord(schema)) {
      return yield* deploymentValidationFailureEffect("Schema must be an object.");
    }
    if (typeof schema.version !== "number" || !Number.isInteger(schema.version) || schema.version < 0) {
      return yield* deploymentValidationFailureEffect("Schema version must be a non-negative integer.");
    }
    if (!Array.isArray(schema.tables)) {
      return yield* deploymentValidationFailureEffect("Schema tables must be an array.");
    }
    if (!Array.isArray(schema.indexes)) {
      return yield* deploymentValidationFailureEffect("Schema indexes must be an array.");
    }

    const tableIds = new Set<number>();
    const normalizedTables: DeploymentSchema["tables"] = [];
    for (const table of schema.tables) {
      if (!isRecord(table)) {
        return yield* deploymentValidationFailureEffect("Schema table entry must be an object.");
      }
      const tableId = table.tableId;
      if (typeof tableId !== "number" || !Number.isInteger(tableId) || tableId <= 0) {
        return yield* deploymentValidationFailureEffect(`Invalid table id for ${table.name}.`);
      }
      if (tableIds.has(tableId)) {
        return yield* deploymentValidationFailureEffect(`Duplicate table id ${tableId}.`);
      }
      tableIds.add(tableId);
      const tableName = table.name;
      if (typeof tableName !== "string" || tableName.length === 0) {
        return yield* deploymentValidationFailureEffect(`Table ${tableId} has an invalid name.`);
      }
      const state = yield* decodeTableState(table.state);
      const validator = yield* decodeValidator(table.validator ?? null, `$schema.tables.${tableName}.validator`);
      const placement = yield* decodePlacement(table.placement, `$schema.tables.${tableName}.placement`);
      normalizedTables.push({
        tableId,
        name: tableName,
        state,
        validator,
        placement,
      });
    }

    const indexIds = new Set<number>();
    const normalizedIndexes: DeploymentSchema["indexes"] = [];
    for (const index of schema.indexes) {
      if (!isRecord(index)) {
        return yield* deploymentValidationFailureEffect("Schema index entry must be an object.");
      }
      const indexId = index.indexId;
      if (typeof indexId !== "number" || !Number.isInteger(indexId) || indexId <= 0) {
        return yield* deploymentValidationFailureEffect(`Invalid index id for ${index.name}.`);
      }
      if (indexIds.has(indexId)) {
        return yield* deploymentValidationFailureEffect(`Duplicate index id ${indexId}.`);
      }
      indexIds.add(indexId);
      const tableId = index.tableId;
      if (typeof tableId !== "number" || !tableIds.has(tableId)) {
        return yield* deploymentValidationFailureEffect(
          `Index ${index.name} references unknown table id ${String(index.tableId)}.`,
        );
      }
      const indexName = index.name;
      if (typeof indexName !== "string" || indexName.length === 0) {
        return yield* deploymentValidationFailureEffect(`Index ${indexId} has an invalid name.`);
      }
      if (!Array.isArray(index.fields) || !index.fields.every(field => typeof field === "string")) {
        return yield* deploymentValidationFailureEffect(`Index ${indexName} has invalid fields.`);
      }
      const state = yield* decodeIndexState(index.state);
      normalizedIndexes.push({
        indexId,
        tableId,
        name: indexName,
        fields: [...index.fields],
        state,
      });
    }

    return { version: schema.version, tables: normalizedTables, indexes: normalizedIndexes };
  },
);

export const decodeFunctions = Effect.fn("DeploymentValidation.decodeFunctions")(
  function* (functions: unknown): Effect.fn.Return<DeploymentFunctions, DeploymentValidationError> {
    if (!isRecord(functions)) {
      return yield* deploymentValidationFailureEffect("Function metadata must be an object.");
    }
    if (!Array.isArray(functions.functions)) {
      return yield* deploymentValidationFailureEffect("Function metadata must include a functions array.");
    }
    const seen = new Set<string>();
    const normalized: DeploymentFunctions["functions"] = [];
    for (const [index, metadata] of functions.functions.entries()) {
      if (!isRecord(metadata)) {
        return yield* deploymentValidationFailureEffect(`Function metadata at index ${index} must be an object.`);
      }
      const path = metadata.path;
      if (typeof path !== "string" || path.length === 0) {
        return yield* deploymentValidationFailureEffect(`Function metadata at index ${index} has an invalid path.`);
      }
      if (seen.has(path)) {
        return yield* deploymentValidationFailureEffect(`Duplicate function metadata path: ${path}.`);
      }
      seen.add(path);
      const kind = yield* decodeFunctionKind(metadata.kind, `$functions.${path}.kind`);
      const visibility = yield* decodeVisibility(metadata.visibility ?? "public", `$functions.${path}.visibility`);
      const args = yield* decodeValidator(metadata.args ?? null, `$functions.${path}.args`);
      const returns = yield* decodeValidator(metadata.returns ?? null, `$functions.${path}.returns`);
      const route = yield* decodeFunctionRoutePolicy(metadata.route, `$functions.${path}.route`);
      const partition = yield* decodeFunctionPartitionPolicy(metadata.partition, `$functions.${path}.partition`);
      const position = yield* decodeSourcePosition(metadata.position, `$functions.${path}.position`);
      normalized.push({
        path,
        kind,
        visibility,
        args,
        returns,
        route,
        partition,
        ...(position === undefined ? {} : { position }),
      });
    }
    return { functions: normalized };
  },
);

export const decodeAnalysis = Effect.fn("DeploymentValidation.decodeAnalysis")(
  function* (analysis: unknown): Effect.fn.Return<DeploymentAnalysis, DeploymentValidationError> {
    if (!isRecord(analysis)) {
      return yield* deploymentValidationFailureEffect("Deployment analysis must be an object.");
    }
    const schema = yield* decodeSchema(analysis.schema);
    const functions = yield* decodeFunctions(analysis.functions);
    yield* validateFunctionPartitionsEffect(functions, schema);
    return { schema, functions };
  },
);

export const decodeCodegenAnalysis = Effect.fn("DeploymentValidation.decodeCodegenAnalysis")(
  function* (
    codegenAnalysis: unknown,
    analysis: DeploymentAnalysis,
  ): Effect.fn.Return<DeploymentCodegenAnalysis, DeploymentValidationError> {
    if (!isRecord(codegenAnalysis)) {
      return yield* deploymentValidationFailureEffect("Codegen analysis must be an object.");
    }
    const schema = yield* decodeSchema(codegenAnalysis.schema);
    if (canonicalJson(schema) !== canonicalJson(analysis.schema)) {
      return yield* deploymentValidationFailureEffect("Codegen analysis schema must match deployment analysis schema.");
    }
    if (!Array.isArray(codegenAnalysis.functions)) {
      return yield* deploymentValidationFailureEffect("Codegen analysis functions must be an array.");
    }

    const metadataByPath = new Map(analysis.functions.functions.map(metadata => [metadata.path, metadata]));
    const seenModuleNames = new Set<string>();
    const seenPaths = new Set<string>();
    const modules: DeploymentCodegenAnalysis["functions"] = [];
    for (const [moduleIndex, module] of codegenAnalysis.functions.entries()) {
      if (!isRecord(module)) {
        return yield* deploymentValidationFailureEffect(`Codegen module at index ${moduleIndex} must be an object.`);
      }
      if (typeof module.moduleName !== "string" || module.moduleName.length === 0) {
        return yield* deploymentValidationFailureEffect(
          `Codegen module at index ${moduleIndex} has an invalid moduleName.`,
        );
      }
      if (!Array.isArray(module.functions)) {
        return yield* deploymentValidationFailureEffect(`Codegen module ${module.moduleName} functions must be an array.`);
      }
      const moduleName = module.moduleName;
      if (seenModuleNames.has(moduleName)) {
        return yield* deploymentValidationFailureEffect(`Duplicate codegen module metadata: ${moduleName}.`);
      }
      seenModuleNames.add(moduleName);
      const normalizedFunctions: DeploymentCodegenModule["functions"] = [];
      for (const [functionIndex, fn] of module.functions.entries()) {
        if (!isRecord(fn)) {
          return yield* deploymentValidationFailureEffect(
            `Codegen function ${moduleName}[${functionIndex}] must be an object.`,
          );
        }
        if (fn.moduleName !== moduleName) {
          return yield* deploymentValidationFailureEffect(
            `Codegen function ${moduleName}[${functionIndex}] moduleName must match its module.`,
          );
        }
        if (typeof fn.exportName !== "string" || fn.exportName.length === 0) {
          return yield* deploymentValidationFailureEffect(
            `Codegen function ${moduleName}[${functionIndex}] has an invalid exportName.`,
          );
        }
        const exportName = fn.exportName;
        const path = functionPathFromCodegen(moduleName, exportName);
        const metadata = metadataByPath.get(path);
        if (metadata === undefined) {
          return yield* deploymentValidationFailureEffect(
            `Codegen function ${path} has no deployment function metadata.`,
          );
        }
        if (seenPaths.has(path)) {
          return yield* deploymentValidationFailureEffect(`Duplicate codegen function metadata path: ${path}.`);
        }
        seenPaths.add(path);
        const kind = yield* decodeFunctionKind(fn.kind, `$codegen.functions.${path}.kind`);
        const visibility = yield* decodeVisibility(fn.visibility, `$codegen.functions.${path}.visibility`);
        const args = yield* decodeValidator(fn.args, `$codegen.functions.${path}.args`);
        if (args === null) {
          return yield* deploymentValidationFailureEffect(`$codegen.functions.${path}.args: Validator is required.`);
        }
        const returns = yield* decodeValidator(fn.returns ?? null, `$codegen.functions.${path}.returns`);
        const partition = yield* decodeFunctionPartitionPolicy(fn.partition, `$codegen.functions.${path}.partition`);
        const position = yield* decodeSourcePosition(fn.position, `$codegen.functions.${path}.position`);
        yield* assertCodegenFunctionMatchesMetadataEffect(path, {
          kind,
          visibility,
          args,
          returns,
          partition,
          position,
        }, metadata);
        normalizedFunctions.push({
          moduleName,
          exportName,
          kind,
          visibility,
          args,
          returns,
          partition,
          ...(position === undefined ? {} : { position }),
        });
      }
      modules.push({
        moduleName,
        functions: normalizedFunctions,
      });
    }
    if (seenPaths.size !== metadataByPath.size) {
      return yield* deploymentValidationFailureEffect("Codegen analysis functions must cover every deployment function.");
    }
    return { schema, functions: modules };
  },
);

const assertCodegenFunctionMatchesMetadataEffect = Effect.fn(
  "DeploymentValidation.assertCodegenFunctionMatchesMetadataEffect",
)(function* (
  path: string,
  codegen: {
    kind: DeploymentFunctionKind;
    visibility: FunctionVisibility;
    args: ValidatorJson;
    returns: ValidatorJson | null;
    partition: FunctionPartitionMetadata | null;
    position: AnalyzedSourcePosition | undefined;
  },
  metadata: DeploymentFunctionMetadata,
): Effect.fn.Return<void, DeploymentValidationError> {
  const expected = {
    kind: metadata.kind,
    visibility: metadata.visibility ?? "public",
    args: metadata.args ?? { type: "any" },
    returns: metadata.returns ?? null,
    partition: metadata.partition ?? null,
    position: metadata.position,
  };
  if (canonicalJson(codegen) !== canonicalJson(expected)) {
    return yield* deploymentValidationFailureEffect(`Codegen function ${path} must match deployment function metadata.`);
  }
});

const validateDeploymentAnalysisSourcePackageEffect = Effect.fn(
  "DeploymentValidation.validateDeploymentAnalysisSourcePackageEffect",
)(function* (
  sourcePackage: PushSourcePackage,
  analysis: DeploymentAnalysis,
): Effect.fn.Return<void, DeploymentValidationError> {
  const sourceFunctionModules = new Set(sourcePackage.functions.map(sourceFunctionModuleName));
  for (const metadata of analysis.functions.functions) {
    const { moduleName } = parseFunctionPath(metadata.path);
    if (!sourceFunctionModules.has(moduleName)) {
      return yield* deploymentValidationFailureEffect(
        `Deployment function ${metadata.path} is not declared by source package functions.`,
      );
    }
  }
});

function sourceFunctionModuleName(modulePath: string): string {
  return modulePath.replace(/\.[^/.]+$/, "");
}

function functionPathFromCodegen(moduleName: string, exportName: string): string {
  return exportName === "default" ? moduleName : `${moduleName}:${exportName}`;
}

const validateFunctionPartitionsEffect = Effect.fn("DeploymentValidation.validateFunctionPartitionsEffect")(function* (
  functions: DeploymentFunctions,
  schema: DeploymentSchema,
): Effect.fn.Return<void, DeploymentValidationError> {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  for (const metadata of functions.functions) {
    const partition = metadata.partition;
    if (partition === undefined || partition === null) continue;
    const table = tables.get(partition.table);
    if (table === undefined || table.state === "deleted") {
      return yield* deploymentValidationFailureEffect(
        `${metadata.path}.partition: Unknown partition table ${partition.table}.`,
      );
    }
    if (table.placement.kind !== "partitionBy") {
      return yield* deploymentValidationFailureEffect(
        `${metadata.path}.partition: Table ${partition.table} is not partitioned.`,
      );
    }
    if (partition.type === "partitionCreateRoot") {
      if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
        return yield* deploymentValidationFailureEffect(
          `${metadata.path}.partition: create-root partition requires ${partition.table} to be partitioned by _id.`,
        );
      }
      if (metadata.route !== null && metadata.route !== undefined) {
        return yield* deploymentValidationFailureEffect(
          `${metadata.path}.partition: create-root partition cannot declare route metadata.`,
        );
      }
      continue;
    }
    if (table.placement.field !== partition.partitionField) {
      return yield* deploymentValidationFailureEffect(
        `${metadata.path}.partition: Selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
      );
    }
    const expectedSelector = selectorNameForPartitionField(table.placement.field);
    if (partition.selector !== expectedSelector) {
      return yield* deploymentValidationFailureEffect(
        `${metadata.path}.partition: Expected selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
      );
    }
    if (!validatorHasRequiredField(metadata.args ?? null, partition.argField)) {
      return yield* deploymentValidationFailureEffect(
        `${metadata.path}.partition: args.${partition.argField} is not a required argument.`,
      );
    }
    if (
      metadata.route !== null &&
      metadata.route !== undefined &&
      metadata.route.type === "args" &&
      metadata.route.field !== partition.argField
    ) {
      return yield* deploymentValidationFailureEffect(
        `${metadata.path}.partition: partition argument ${partition.argField} must match route argument ${metadata.route.field}.`,
      );
    }
  }
});

const decodeTableState = Effect.fn("DeploymentValidation.decodeTableState")(function* (
  value: unknown,
): Effect.fn.Return<NonNullable<SchemaTable["state"]>, DeploymentValidationError> {
  if (value === undefined) return "active";
  if (value === "active" || value === "hidden" || value === "deleted") return value;
  return yield* deploymentValidationFailureEffect("Schema table has invalid state.");
});

const decodeIndexState = Effect.fn("DeploymentValidation.decodeIndexState")(function* (
  value: unknown,
): Effect.fn.Return<NonNullable<DeploymentSchema["indexes"][number]["state"]>, DeploymentValidationError> {
  if (value === undefined) return "enabled";
  if (value === "enabled" || value === "staged" || value === "disabled") return value;
  return yield* deploymentValidationFailureEffect("Schema index has invalid state.");
});

const decodeSourcePosition = Effect.fn("DeploymentValidation.decodeSourcePosition")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<AnalyzedSourcePosition | undefined, DeploymentValidationError> {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return yield* deploymentValidationFailureEffect(`${path}: Invalid source position.`);
  }
  const position = value as Partial<AnalyzedSourcePosition>;
  if (typeof position.path !== "string" || position.path.length === 0) {
    return yield* deploymentValidationFailureEffect(`${path}.path: Source position path must be a non-empty string.`);
  }
  if (
    typeof position.startLine !== "number" ||
    !Number.isInteger(position.startLine) ||
    position.startLine <= 0
  ) {
    return yield* deploymentValidationFailureEffect(
      `${path}.startLine: Source position line must be a positive integer.`,
    );
  }
  if (
    typeof position.startColumn !== "number" ||
    !Number.isInteger(position.startColumn) ||
    position.startColumn <= 0
  ) {
    return yield* deploymentValidationFailureEffect(
      `${path}.startColumn: Source position column must be a positive integer.`,
    );
  }
  return {
    path: position.path,
    startLine: position.startLine,
    startColumn: position.startColumn,
  };
});

const decodeFunctionRoutePolicy = Effect.fn("DeploymentValidation.decodeFunctionRoutePolicy")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<FunctionRoutePolicy | null, DeploymentValidationError> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return yield* deploymentValidationFailureEffect(`${path}: Invalid route policy.`);
  }
  const route = value as Partial<FunctionRoutePolicy>;
  if (route.type === "args" && typeof route.field === "string" && route.field.length > 0) {
    return { type: "args", field: route.field };
  }
  return yield* deploymentValidationFailureEffect(`${path}: Invalid route policy.`);
});

const decodeFunctionPartitionPolicy = Effect.fn("DeploymentValidation.decodeFunctionPartitionPolicy")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<FunctionPartitionMetadata | null, DeploymentValidationError> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return yield* deploymentValidationFailureEffect(`${path}: Invalid partition policy.`);
  }
  const partition = value as Partial<FunctionPartitionMetadata>;
  if (
    partition.type === "partitionCreateRoot" &&
    typeof partition.table === "string" &&
    partition.table.length > 0 &&
    partition.partitionField === "_id"
  ) {
    const rootPartition: FunctionPartitionMetadata = {
      type: "partitionCreateRoot",
      table: partition.table,
      partitionField: "_id",
    };
    return rootPartition;
  }
  if (
    partition.type === "partition" &&
    typeof partition.table === "string" &&
    partition.table.length > 0 &&
    typeof partition.selector === "string" &&
    partition.selector.length > 0 &&
    typeof partition.partitionField === "string" &&
    partition.partitionField.length > 0 &&
    typeof partition.argField === "string" &&
    partition.argField.length > 0
  ) {
    const routedPartition: FunctionPartitionMetadata = {
      type: "partition",
      table: partition.table,
      selector: partition.selector,
      partitionField: partition.partitionField,
      argField: partition.argField,
    };
    return routedPartition;
  }
  return yield* deploymentValidationFailureEffect(`${path}: Invalid partition policy.`);
});

function selectorNameForPartitionField(field: string): string {
  if (field === "_id") return "byId";
  const suffix = field
    .split(/[^A-Za-z0-9]+/)
    .filter(part => part.length > 0)
    .map(capitalize)
    .join("");
  return suffix.length === 0 ? "byPartition" : `by${suffix}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function validatorHasRequiredField(validator: ValidatorJson | null, field: string): boolean {
  return (
    validator !== null &&
    validator.type === "object" &&
    Object.prototype.hasOwnProperty.call(validator.value, field) &&
    validator.value[field]?.optional === false
  );
}

const decodePlacement = Effect.fn("DeploymentValidation.decodePlacement")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<SchemaTable["placement"], DeploymentValidationError> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("kind" in value)) {
    return yield* deploymentValidationFailureEffect(`${path}: Invalid placement.`);
  }
  const placement = value as Partial<SchemaTable["placement"]>;
  if (placement.kind === "global") return { kind: "global" };
  if (placement.kind === "partitionBy" && typeof placement.field === "string") {
    return { kind: "partitionBy", field: placement.field };
  }
  if (
    placement.kind === "colocateWith" &&
    typeof placement.table === "string" &&
    typeof placement.field === "string"
  ) {
    return { kind: "colocateWith", table: placement.table, field: placement.field };
  }
  return yield* deploymentValidationFailureEffect(`${path}: Invalid placement.`);
});

const decodeFunctionKind = Effect.fn("DeploymentValidation.decodeFunctionKind")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<DeploymentFunctionKind, DeploymentValidationError> {
  if (
    value === "query" ||
    value === "mutation" ||
    value === "action" ||
    value === "workflowMutation"
  ) {
    return value;
  }
  return yield* deploymentValidationFailureEffect(`${path}: Invalid function kind ${value}.`);
});

const decodeVisibility = Effect.fn("DeploymentValidation.decodeVisibility")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<FunctionVisibility, DeploymentValidationError> {
  if (value === "public" || value === "internal") return value;
  return yield* deploymentValidationFailureEffect(`${path}: Invalid function visibility ${value}.`);
});

const decodeValidator = Effect.fn("DeploymentValidation.decodeValidator")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<ValidatorJson | null, DeploymentValidationError> {
  const json = yield* decodeJsonValue(value, path);
  const validator = parseValidatorJson(json, path);
  if (!validator.success) {
    return yield* deploymentValidationFailureEffect(`Invalid validator metadata: ${validator.error.message}`);
  }
  return validator.value;
});

const decodeJsonValue = Effect.fn("DeploymentValidation.decodeJsonValue")(function* (
  value: unknown,
  path: string,
): Effect.fn.Return<Json | undefined, DeploymentValidationError> {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parsedArray: Json[] = [];
    for (const [index, item] of value.entries()) {
      const parsed = yield* decodeJsonValue(item, `${path}[${index}]`);
      if (parsed === undefined) {
        return yield* deploymentValidationFailureEffect(`${path}[${index}]: Expected JSON value.`);
      }
      parsedArray.push(parsed);
    }
    return parsedArray;
  }
  if (isRecord(value)) {
    const record: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      const parsed = yield* decodeJsonValue(item, `${path}.${key}`);
      if (parsed === undefined) {
        return yield* deploymentValidationFailureEffect(`${path}.${key}: Expected JSON value.`);
      }
      record[key] = parsed;
    }
    return record;
  }
  return yield* deploymentValidationFailureEffect(`${path}: Expected JSON value.`);
});

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}
