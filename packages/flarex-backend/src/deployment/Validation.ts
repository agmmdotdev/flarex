import { Effect } from "effect";
import type { AnalyzedStartPushRequest as ProtocolAnalyzedStartPushRequest } from "flarex-protocol/deployment";
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
import { assertValidatorJson, BackendValidationError } from "../validation";
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
  function* (sourcePackage: PushSourcePackage): Effect.fn.Return<PushSourcePackage, DeploymentValidationError> {
    const result = normalizeSourcePackage(sourcePackage);
    return yield* deploymentValidationResultToEffect(result);
  },
);

export function validateSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  return unwrapDeploymentValidation(normalizeSourcePackage(sourcePackage));
}

type DeploymentValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: DeploymentValidationError;
    };

function deploymentValidationSuccess<A>(value: A): DeploymentValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function deploymentValidationFailure<A = never>(message: string): DeploymentValidationResult<A> {
  return {
    success: false,
    error: new DeploymentValidationError({ message }),
  };
}

function deploymentValidationResultToEffect<A>(
  result: DeploymentValidationResult<A>,
): Effect.Effect<A, DeploymentValidationError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapDeploymentValidation<A>(result: DeploymentValidationResult<A>): A {
  if (result.success) return result.value;
  throw result.error;
}

function normalizeSourcePackage(sourcePackage: PushSourcePackage): DeploymentValidationResult<PushSourcePackage> {
  if (!Array.isArray(sourcePackage.modules)) {
    return deploymentValidationFailure("Source package modules must be an array.");
  }
  if (!Array.isArray(sourcePackage.functions)) {
    return deploymentValidationFailure("Source package functions must be an array.");
  }
  if (typeof sourcePackage.execution !== "string" || sourcePackage.execution.length === 0) {
    return deploymentValidationFailure("Source package execution module is required.");
  }
  const seen = new Set<string>();
  const modules = [];
  for (const module of sourcePackage.modules) {
    if (typeof module.path !== "string" || module.path.length === 0) {
      return deploymentValidationFailure("Source package module has an invalid path.");
    }
    if (seen.has(module.path)) {
      return deploymentValidationFailure(`Duplicate source module path: ${module.path}.`);
    }
    seen.add(module.path);
    if (module.environment !== "isolate") {
      return deploymentValidationFailure(
        `Source module ${module.path} has unsupported environment ${module.environment}.`,
      );
    }
    if (typeof module.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(module.sha256)) {
      return deploymentValidationFailure(`Source module ${module.path} has an invalid sha256.`);
    }
    if (module.source !== undefined && typeof module.source !== "string") {
      return deploymentValidationFailure(`Source module ${module.path} source must be a string.`);
    }
    if (module.sourceMap !== undefined && typeof module.sourceMap !== "string") {
      return deploymentValidationFailure(`Source module ${module.path} sourceMap must be a string.`);
    }
    modules.push({ ...module });
  }
  modules.sort((left, right) => left.path.localeCompare(right.path));
  if (!seen.has(sourcePackage.execution)) {
    return deploymentValidationFailure(`Source package execution module ${sourcePackage.execution} is missing.`);
  }
  if (sourcePackage.schema !== undefined && !seen.has(sourcePackage.schema)) {
    return deploymentValidationFailure(`Source package schema module ${sourcePackage.schema} is missing.`);
  }
  const functions = [...sourcePackage.functions].sort();
  for (const fn of functions) {
    if (typeof fn !== "string" || !seen.has(fn)) {
      return deploymentValidationFailure(`Source package function module ${String(fn)} is missing.`);
    }
  }
  return deploymentValidationSuccess({
    modules,
    functions,
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    execution: sourcePackage.execution,
  });
}

export function validateDiagnostics(value: unknown): PushDiagnostic[] {
  return unwrapDeploymentValidation(normalizeDiagnostics(value));
}

export const decodeDiagnostics = Effect.fn("DeploymentValidation.decodeDiagnostics")(
  function* (value: unknown): Effect.fn.Return<PushDiagnostic[], DeploymentValidationError> {
    const result = normalizeDiagnostics(value);
    return yield* deploymentValidationResultToEffect(result);
  },
);

function normalizeDiagnostics(value: unknown): DeploymentValidationResult<PushDiagnostic[]> {
  if (value === undefined) {
    return deploymentValidationSuccess([]);
  }
  if (!Array.isArray(value)) {
    return deploymentValidationFailure("Push diagnostics must be an array.");
  }
  const diagnostics: PushDiagnostic[] = [];
  for (const [index, diagnostic] of value.slice(-100).entries()) {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      return deploymentValidationFailure(`Push diagnostic at index ${index} must be an object.`);
    }
    const record = diagnostic as Partial<PushDiagnostic>;
    if (record.level !== "log" && record.level !== "warn" && record.level !== "error") {
      return deploymentValidationFailure(`Push diagnostic at index ${index} has an invalid level.`);
    }
    if (typeof record.message !== "string") {
      return deploymentValidationFailure(`Push diagnostic at index ${index} has an invalid message.`);
    }
    diagnostics.push({
      level: record.level,
      message: record.message,
    });
  }
  return deploymentValidationSuccess(diagnostics);
}

export function analyzedStartPushRequest(
  request: ProtocolAnalyzedStartPushRequest,
): AnalyzedStartPushRequest {
  return unwrapDeploymentValidation(normalizeAnalyzedStartPushRequest(request));
}

function normalizeAnalyzedStartPushRequest(
  request: ProtocolAnalyzedStartPushRequest,
): DeploymentValidationResult<AnalyzedStartPushRequest> {
  const sourcePackageResult = normalizeSourcePackage(request.sourcePackage as PushSourcePackage);
  if (!sourcePackageResult.success) return sourcePackageResult;
  const sourcePackage = sourcePackageResult.value;
  const diagnostics = request.diagnostics === undefined
    ? undefined
    : normalizeDiagnostics(request.diagnostics);
  if (diagnostics !== undefined && !diagnostics.success) return diagnostics;
  if (request.analysis === undefined) {
    const error = request.error;
    if (error === undefined) {
      return deploymentValidationFailure("A push without analysis must include an error message.");
    }
    return deploymentValidationSuccess({
      sourcePackage,
      error,
      ...(diagnostics === undefined ? {} : { diagnostics: diagnostics.value }),
    });
  }
  return deploymentValidationSuccess({
    sourcePackage,
    analysis: request.analysis,
    ...(request.codegenAnalysis === undefined ? {} : { codegenAnalysis: request.codegenAnalysis }),
    ...(diagnostics === undefined ? {} : { diagnostics: diagnostics.value }),
  });
}

export const decodeAnalyzedStartPushRequest = Effect.fn(
  "DeploymentValidation.decodeAnalyzedStartPushRequest",
)(function* (
  request: ProtocolAnalyzedStartPushRequest,
): Effect.fn.Return<AnalyzedStartPushRequest, DeploymentValidationError> {
  return yield* deploymentValidationResultToEffect(normalizeAnalyzedStartPushRequest(request));
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

export function startAnalyzedPushInput(
  request: AnalyzedStartPushRequest,
): StartAnalyzedPushServiceInput {
  return unwrapDeploymentValidation(normalizeStartAnalyzedPushInput(request));
}

function normalizeStartAnalyzedPushInput(
  request: AnalyzedStartPushRequest,
): DeploymentValidationResult<StartAnalyzedPushServiceInput> {
  const sourcePackageResult = normalizeSourcePackage(request.sourcePackage);
  if (!sourcePackageResult.success) return sourcePackageResult;
  const sourcePackage = sourcePackageResult.value;
  const error = request.error;
  const analysis = request.analysis === undefined ? undefined : normalizeAnalysis(request.analysis);
  if (analysis !== undefined && !analysis.success) return analysis;
  const diagnostics = normalizeDiagnostics(request.diagnostics);
  if (!diagnostics.success) return diagnostics;
  if (analysis === undefined) {
    if (typeof error !== "string" || error.length === 0) {
      return deploymentValidationFailure("A push without analysis must include an error message.");
    }
    return deploymentValidationSuccess({
      sourcePackage,
      error,
      diagnostics: diagnostics.value,
    });
  }
  const hasCodegenAnalysis = Object.prototype.hasOwnProperty.call(request, "codegenAnalysis");
  const codegenAnalysis = normalizeCodegenAnalysis(
    hasCodegenAnalysis ? request.codegenAnalysis : codegenAnalysisFromDeploymentAnalysis(analysis.value),
    analysis.value,
  );
  if (!codegenAnalysis.success) return codegenAnalysis;
  return deploymentValidationSuccess({
    sourcePackage,
    analysis: analysis.value,
    codegenAnalysis: codegenAnalysis.value,
    diagnostics: diagnostics.value,
  });
}

export const decodeStartAnalyzedPushInput = Effect.fn(
  "DeploymentValidation.decodeStartAnalyzedPushInput",
)(function* (
  request: AnalyzedStartPushRequest,
): Effect.fn.Return<StartAnalyzedPushServiceInput, DeploymentValidationError> {
  return yield* deploymentValidationResultToEffect(normalizeStartAnalyzedPushInput(request));
});

export function pushStatusFromRow(row: DeploymentPushStatusRow): PushStatus {
  const storedAnalysis = row.schema_json === null || row.functions_json === null
    ? undefined
    : validateAnalysis({
      schema: JSON.parse(row.schema_json),
      functions: JSON.parse(row.functions_json),
    });
  const storedCodegenAnalysis: unknown = row.codegen_analysis_json === null
    ? undefined
    : JSON.parse(row.codegen_analysis_json);
  const diagnostics = row.diagnostics_json === null
    ? []
    : JSON.parse(row.diagnostics_json) as PushDiagnostic[];
  return {
    pushId: row.push_id,
    state: parsePushState(row.state),
    sourcePackage: JSON.parse(row.source_package_json) as PushSourcePackage,
    ...(storedAnalysis !== undefined
      ? {
          analysis: storedAnalysis,
          codegenAnalysis: storedCodegenAnalysis === undefined
            ? codegenAnalysisFromDeploymentAnalysis(storedAnalysis)
            : validateCodegenAnalysis(storedCodegenAnalysis, storedAnalysis),
        }
      : {}),
    ...(row.error === null ? {} : { error: row.error }),
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

function parsePushState(value: string): PushStatus["state"] {
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
  throw new Error(`Unknown stored push state ${value}.`);
}

export function validateSchema(schema: unknown): DeploymentSchema {
  return unwrapDeploymentValidation(normalizeSchema(schema));
}

export const decodeSchema = Effect.fn("DeploymentValidation.decodeSchema")(
  function* (schema: unknown): Effect.fn.Return<DeploymentSchema, DeploymentValidationError> {
    return yield* deploymentValidationResultToEffect(normalizeSchema(schema));
  },
);

function normalizeSchema(schema: unknown): DeploymentValidationResult<DeploymentSchema> {
  if (!isRecord(schema)) {
    return deploymentValidationFailure("Schema must be an object.");
  }
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version) || schema.version < 0) {
    return deploymentValidationFailure("Schema version must be a non-negative integer.");
  }
  if (!Array.isArray(schema.tables)) return deploymentValidationFailure("Schema tables must be an array.");
  if (!Array.isArray(schema.indexes)) return deploymentValidationFailure("Schema indexes must be an array.");

  const tableIds = new Set<number>();
  const normalizedTables: DeploymentSchema["tables"] = [];
  for (const table of schema.tables) {
    if (!isRecord(table)) {
      return deploymentValidationFailure("Schema table entry must be an object.");
    }
    const tableId = table.tableId;
    if (typeof tableId !== "number" || !Number.isInteger(tableId) || tableId <= 0) {
      return deploymentValidationFailure(`Invalid table id for ${table.name}.`);
    }
    if (tableIds.has(tableId)) return deploymentValidationFailure(`Duplicate table id ${tableId}.`);
    tableIds.add(tableId);
    const tableName = table.name;
    if (typeof tableName !== "string" || tableName.length === 0) {
      return deploymentValidationFailure(`Table ${tableId} has an invalid name.`);
    }
    const state = parseTableState(table.state);
    if (!state.success) return state;
    const validator = safeValidator(table.validator ?? null, `$schema.tables.${tableName}.validator`);
    if (!validator.success) return validator;
    const placement = validatePlacement(table.placement, `$schema.tables.${tableName}.placement`);
    if (!placement.success) return placement;
    normalizedTables.push({
      tableId,
      name: tableName,
      state: state.value,
      validator: validator.value,
      placement: placement.value,
    });
  }

  const indexIds = new Set<number>();
  const normalizedIndexes: DeploymentSchema["indexes"] = [];
  for (const index of schema.indexes) {
    if (!isRecord(index)) {
      return deploymentValidationFailure("Schema index entry must be an object.");
    }
    const indexId = index.indexId;
    if (typeof indexId !== "number" || !Number.isInteger(indexId) || indexId <= 0) {
      return deploymentValidationFailure(`Invalid index id for ${index.name}.`);
    }
    if (indexIds.has(indexId)) return deploymentValidationFailure(`Duplicate index id ${indexId}.`);
    indexIds.add(indexId);
    const tableId = index.tableId;
    if (typeof tableId !== "number" || !tableIds.has(tableId)) {
      return deploymentValidationFailure(`Index ${index.name} references unknown table id ${String(index.tableId)}.`);
    }
    const indexName = index.name;
    if (typeof indexName !== "string" || indexName.length === 0) {
      return deploymentValidationFailure(`Index ${indexId} has an invalid name.`);
    }
    if (!Array.isArray(index.fields) || !index.fields.every(field => typeof field === "string")) {
      return deploymentValidationFailure(`Index ${indexName} has invalid fields.`);
    }
    const state = parseIndexState(index.state);
    if (!state.success) return state;
    normalizedIndexes.push({
      indexId,
      tableId,
      name: indexName,
      fields: [...index.fields],
      state: state.value,
    });
  }

  return deploymentValidationSuccess({ version: schema.version, tables: normalizedTables, indexes: normalizedIndexes });
}

export function validateFunctions(functions: unknown): DeploymentFunctions {
  return unwrapDeploymentValidation(normalizeFunctions(functions));
}

export const decodeFunctions = Effect.fn("DeploymentValidation.decodeFunctions")(
  function* (functions: unknown): Effect.fn.Return<DeploymentFunctions, DeploymentValidationError> {
    return yield* deploymentValidationResultToEffect(normalizeFunctions(functions));
  },
);

function normalizeFunctions(functions: unknown): DeploymentValidationResult<DeploymentFunctions> {
  if (!isRecord(functions)) {
    return deploymentValidationFailure("Function metadata must be an object.");
  }
  if (!Array.isArray(functions.functions)) {
    return deploymentValidationFailure("Function metadata must include a functions array.");
  }
  const seen = new Set<string>();
  const normalized: DeploymentFunctions["functions"] = [];
  for (const [index, metadata] of functions.functions.entries()) {
    if (!isRecord(metadata)) {
      return deploymentValidationFailure(`Function metadata at index ${index} must be an object.`);
    }
    const path = metadata.path;
    if (typeof path !== "string" || path.length === 0) {
      return deploymentValidationFailure(`Function metadata at index ${index} has an invalid path.`);
    }
    if (seen.has(path)) return deploymentValidationFailure(`Duplicate function metadata path: ${path}.`);
    seen.add(path);
    const kind = parseFunctionKind(metadata.kind, `$functions.${path}.kind`);
    if (!kind.success) return kind;
    const visibility = parseVisibility(metadata.visibility ?? "public", `$functions.${path}.visibility`);
    if (!visibility.success) return visibility;
    const args = safeValidator(metadata.args ?? null, `$functions.${path}.args`);
    if (!args.success) return args;
    const returns = safeValidator(metadata.returns ?? null, `$functions.${path}.returns`);
    if (!returns.success) return returns;
    const route = validateFunctionRoutePolicy(metadata.route, `$functions.${path}.route`);
    if (!route.success) return route;
    const partition = validateFunctionPartitionPolicy(
      metadata.partition,
      `$functions.${path}.partition`,
    );
    if (!partition.success) return partition;
    const position = validateSourcePosition(metadata.position, `$functions.${path}.position`);
    if (!position.success) return position;
    normalized.push({
      path,
      kind: kind.value,
      visibility: visibility.value,
      args: args.value,
      returns: returns.value,
      route: route.value,
      partition: partition.value,
      ...(position.value === undefined ? {} : { position: position.value }),
    });
  }
  return deploymentValidationSuccess({ functions: normalized });
}

export function validateAnalysis(analysis: unknown): DeploymentAnalysis {
  return unwrapDeploymentValidation(normalizeAnalysis(analysis));
}

export const decodeAnalysis = Effect.fn("DeploymentValidation.decodeAnalysis")(
  function* (analysis: unknown): Effect.fn.Return<DeploymentAnalysis, DeploymentValidationError> {
    return yield* deploymentValidationResultToEffect(normalizeAnalysis(analysis));
  },
);

function normalizeAnalysis(analysis: unknown): DeploymentValidationResult<DeploymentAnalysis> {
  if (!isRecord(analysis)) {
    return deploymentValidationFailure("Deployment analysis must be an object.");
  }
  const schema = normalizeSchema(analysis.schema);
  if (!schema.success) return schema;
  const functions = normalizeFunctions(analysis.functions);
  if (!functions.success) return functions;
  const partitions = validateFunctionPartitions(functions.value, schema.value);
  if (!partitions.success) return partitions;
  return deploymentValidationSuccess({
    schema: schema.value,
    functions: functions.value,
  });
}

export function validateCodegenAnalysis(
  codegenAnalysis: unknown,
  analysis: DeploymentAnalysis,
): DeploymentCodegenAnalysis {
  return unwrapDeploymentValidation(normalizeCodegenAnalysis(codegenAnalysis, analysis));
}

export const decodeCodegenAnalysis = Effect.fn("DeploymentValidation.decodeCodegenAnalysis")(
  function* (
    codegenAnalysis: unknown,
    analysis: DeploymentAnalysis,
  ): Effect.fn.Return<DeploymentCodegenAnalysis, DeploymentValidationError> {
    return yield* deploymentValidationResultToEffect(normalizeCodegenAnalysis(codegenAnalysis, analysis));
  },
);

function normalizeCodegenAnalysis(
  codegenAnalysis: unknown,
  analysis: DeploymentAnalysis,
): DeploymentValidationResult<DeploymentCodegenAnalysis> {
  if (!isRecord(codegenAnalysis)) {
    return deploymentValidationFailure("Codegen analysis must be an object.");
  }
  const schema = normalizeSchema(codegenAnalysis.schema);
  if (!schema.success) return schema;
  if (canonicalJson(schema.value) !== canonicalJson(analysis.schema)) {
    return deploymentValidationFailure("Codegen analysis schema must match deployment analysis schema.");
  }
  if (!Array.isArray(codegenAnalysis.functions)) {
    return deploymentValidationFailure("Codegen analysis functions must be an array.");
  }

  const metadataByPath = new Map(analysis.functions.functions.map(metadata => [metadata.path, metadata]));
  const seenModuleNames = new Set<string>();
  const seenPaths = new Set<string>();
  const modules: DeploymentCodegenAnalysis["functions"] = [];
  for (const [moduleIndex, module] of codegenAnalysis.functions.entries()) {
    if (!isRecord(module)) {
      return deploymentValidationFailure(`Codegen module at index ${moduleIndex} must be an object.`);
    }
    if (typeof module.moduleName !== "string" || module.moduleName.length === 0) {
      return deploymentValidationFailure(`Codegen module at index ${moduleIndex} has an invalid moduleName.`);
    }
    if (!Array.isArray(module.functions)) {
      return deploymentValidationFailure(`Codegen module ${module.moduleName} functions must be an array.`);
    }
    const moduleName = module.moduleName;
    if (seenModuleNames.has(moduleName)) {
      return deploymentValidationFailure(`Duplicate codegen module metadata: ${moduleName}.`);
    }
    seenModuleNames.add(moduleName);
    const normalizedFunctions: DeploymentCodegenModule["functions"] = [];
    for (const [functionIndex, fn] of module.functions.entries()) {
      if (!isRecord(fn)) {
        return deploymentValidationFailure(`Codegen function ${moduleName}[${functionIndex}] must be an object.`);
      }
      if (fn.moduleName !== moduleName) {
        return deploymentValidationFailure(
          `Codegen function ${moduleName}[${functionIndex}] moduleName must match its module.`,
        );
      }
      if (typeof fn.exportName !== "string" || fn.exportName.length === 0) {
        return deploymentValidationFailure(
          `Codegen function ${moduleName}[${functionIndex}] has an invalid exportName.`,
        );
      }
      const exportName = fn.exportName;
      const path = functionPathFromCodegen(moduleName, exportName);
      const metadata = metadataByPath.get(path);
      if (metadata === undefined) {
        return deploymentValidationFailure(`Codegen function ${path} has no deployment function metadata.`);
      }
      if (seenPaths.has(path)) {
        return deploymentValidationFailure(`Duplicate codegen function metadata path: ${path}.`);
      }
      seenPaths.add(path);
      const kind = parseFunctionKind(fn.kind, `$codegen.functions.${path}.kind`);
      if (!kind.success) return kind;
      const visibility = parseVisibility(fn.visibility, `$codegen.functions.${path}.visibility`);
      if (!visibility.success) return visibility;
      const args = safeValidator(fn.args, `$codegen.functions.${path}.args`);
      if (!args.success) return args;
      if (args.value === null) {
        return deploymentValidationFailure(`$codegen.functions.${path}.args: Validator is required.`);
      }
      const returns = safeValidator(fn.returns ?? null, `$codegen.functions.${path}.returns`);
      if (!returns.success) return returns;
      const partition = validateFunctionPartitionPolicy(
        fn.partition,
        `$codegen.functions.${path}.partition`,
      );
      if (!partition.success) return partition;
      const position = validateSourcePosition(fn.position, `$codegen.functions.${path}.position`);
      if (!position.success) return position;
      const matchesMetadata = assertCodegenFunctionMatchesMetadata(path, {
        kind: kind.value,
        visibility: visibility.value,
        args: args.value,
        returns: returns.value,
        partition: partition.value,
        position: position.value,
      }, metadata);
      if (!matchesMetadata.success) return matchesMetadata;
      normalizedFunctions.push({
        moduleName,
        exportName,
        kind: kind.value,
        visibility: visibility.value,
        args: args.value,
        returns: returns.value,
        partition: partition.value,
        ...(position.value === undefined ? {} : { position: position.value }),
      });
    }
    modules.push({
      moduleName,
      functions: normalizedFunctions,
    });
  }
  if (seenPaths.size !== metadataByPath.size) {
    return deploymentValidationFailure("Codegen analysis functions must cover every deployment function.");
  }
  return deploymentValidationSuccess({ schema: schema.value, functions: modules });
}

function assertCodegenFunctionMatchesMetadata(
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
): DeploymentValidationResult<void> {
  const expected = {
    kind: metadata.kind,
    visibility: metadata.visibility ?? "public",
    args: metadata.args ?? { type: "any" },
    returns: metadata.returns ?? null,
    partition: metadata.partition ?? null,
    position: metadata.position,
  };
  if (canonicalJson(codegen) !== canonicalJson(expected)) {
    return deploymentValidationFailure(`Codegen function ${path} must match deployment function metadata.`);
  }
  return deploymentValidationSuccess(undefined);
}

function functionPathFromCodegen(moduleName: string, exportName: string): string {
  return exportName === "default" ? moduleName : `${moduleName}:${exportName}`;
}

function validateFunctionPartitions(
  functions: DeploymentFunctions,
  schema: DeploymentSchema,
): DeploymentValidationResult<void> {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  for (const metadata of functions.functions) {
    const partition = metadata.partition;
    if (partition === undefined || partition === null) continue;
    const table = tables.get(partition.table);
    if (table === undefined || table.state === "deleted") {
      return deploymentValidationFailure(`${metadata.path}.partition: Unknown partition table ${partition.table}.`);
    }
    if (table.placement.kind !== "partitionBy") {
      return deploymentValidationFailure(`${metadata.path}.partition: Table ${partition.table} is not partitioned.`);
    }
    if (partition.type === "partitionCreateRoot") {
      if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
        return deploymentValidationFailure(
          `${metadata.path}.partition: create-root partition requires ${partition.table} to be partitioned by _id.`,
        );
      }
      if (metadata.route !== null && metadata.route !== undefined) {
        return deploymentValidationFailure(
          `${metadata.path}.partition: create-root partition cannot declare route metadata.`,
        );
      }
      continue;
    }
    if (table.placement.field !== partition.partitionField) {
      return deploymentValidationFailure(
        `${metadata.path}.partition: Selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
      );
    }
    const expectedSelector = selectorNameForPartitionField(table.placement.field);
    if (partition.selector !== expectedSelector) {
      return deploymentValidationFailure(
        `${metadata.path}.partition: Expected selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
      );
    }
    if (!validatorHasRequiredField(metadata.args ?? null, partition.argField)) {
      return deploymentValidationFailure(
        `${metadata.path}.partition: args.${partition.argField} is not a required argument.`,
      );
    }
    if (
      metadata.route !== null &&
      metadata.route !== undefined &&
      metadata.route.type === "args" &&
      metadata.route.field !== partition.argField
    ) {
      return deploymentValidationFailure(
        `${metadata.path}.partition: partition argument ${partition.argField} must match route argument ${metadata.route.field}.`,
      );
    }
  }
  return deploymentValidationSuccess(undefined);
}

function parseTableState(value: unknown): DeploymentValidationResult<NonNullable<SchemaTable["state"]>> {
  if (value === undefined) return deploymentValidationSuccess("active");
  if (value === "active" || value === "hidden" || value === "deleted") {
    return deploymentValidationSuccess(value);
  }
  return deploymentValidationFailure("Schema table has invalid state.");
}

function parseIndexState(
  value: unknown,
): DeploymentValidationResult<NonNullable<DeploymentSchema["indexes"][number]["state"]>> {
  if (value === undefined) return deploymentValidationSuccess("enabled");
  if (value === "enabled" || value === "staged" || value === "disabled") {
    return deploymentValidationSuccess(value);
  }
  return deploymentValidationFailure("Schema index has invalid state.");
}

function validateSourcePosition(
  value: unknown,
  path: string,
): DeploymentValidationResult<AnalyzedSourcePosition | undefined> {
  if (value === undefined) return deploymentValidationSuccess(undefined);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deploymentValidationFailure(`${path}: Invalid source position.`);
  }
  const position = value as Partial<AnalyzedSourcePosition>;
  if (typeof position.path !== "string" || position.path.length === 0) {
    return deploymentValidationFailure(`${path}.path: Source position path must be a non-empty string.`);
  }
  if (
    typeof position.startLine !== "number" ||
    !Number.isInteger(position.startLine) ||
    position.startLine <= 0
  ) {
    return deploymentValidationFailure(`${path}.startLine: Source position line must be a positive integer.`);
  }
  if (
    typeof position.startColumn !== "number" ||
    !Number.isInteger(position.startColumn) ||
    position.startColumn <= 0
  ) {
    return deploymentValidationFailure(`${path}.startColumn: Source position column must be a positive integer.`);
  }
  return deploymentValidationSuccess({
    path: position.path,
    startLine: position.startLine,
    startColumn: position.startColumn,
  });
}

function validateFunctionRoutePolicy(
  value: unknown,
  path: string,
): DeploymentValidationResult<FunctionRoutePolicy | null> {
  if (value === undefined || value === null) return deploymentValidationSuccess(null);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deploymentValidationFailure(`${path}: Invalid route policy.`);
  }
  const route = value as Partial<FunctionRoutePolicy>;
  if (route.type === "args" && typeof route.field === "string" && route.field.length > 0) {
    return deploymentValidationSuccess({ type: "args", field: route.field });
  }
  return deploymentValidationFailure(`${path}: Invalid route policy.`);
}

function validateFunctionPartitionPolicy(
  value: unknown,
  path: string,
): DeploymentValidationResult<FunctionPartitionMetadata | null> {
  if (value === undefined || value === null) return deploymentValidationSuccess(null);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return deploymentValidationFailure(`${path}: Invalid partition policy.`);
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
    return deploymentValidationSuccess(rootPartition);
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
    return deploymentValidationSuccess(routedPartition);
  }
  return deploymentValidationFailure(`${path}: Invalid partition policy.`);
}

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

function validatePlacement(value: unknown, path: string): DeploymentValidationResult<SchemaTable["placement"]> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("kind" in value)) {
    return deploymentValidationFailure(`${path}: Invalid placement.`);
  }
  const placement = value as Partial<SchemaTable["placement"]>;
  if (placement.kind === "global") return deploymentValidationSuccess({ kind: "global" });
  if (placement.kind === "partitionBy" && typeof placement.field === "string") {
    return deploymentValidationSuccess({ kind: "partitionBy", field: placement.field });
  }
  if (
    placement.kind === "colocateWith" &&
    typeof placement.table === "string" &&
    typeof placement.field === "string"
  ) {
    return deploymentValidationSuccess({ kind: "colocateWith", table: placement.table, field: placement.field });
  }
  return deploymentValidationFailure(`${path}: Invalid placement.`);
}

function parseFunctionKind(value: unknown, path: string): DeploymentValidationResult<DeploymentFunctionKind> {
  if (
    value === "query" ||
    value === "mutation" ||
    value === "action" ||
    value === "workflowMutation"
  ) {
    return deploymentValidationSuccess(value);
  }
  return deploymentValidationFailure(`${path}: Invalid function kind ${value}.`);
}

function parseVisibility(value: unknown, path: string): DeploymentValidationResult<FunctionVisibility> {
  if (value === "public" || value === "internal") return deploymentValidationSuccess(value);
  return deploymentValidationFailure(`${path}: Invalid function visibility ${value}.`);
}

function safeValidator(value: unknown, path: string): DeploymentValidationResult<ValidatorJson | null> {
  const json = jsonValue(value, path);
  if (!json.success) return json;
  try {
    return deploymentValidationSuccess(assertValidatorJson(json.value, path));
  } catch (error) {
    if (error instanceof BackendValidationError) {
      return deploymentValidationFailure(`Invalid validator metadata: ${error.message}`);
    }
    throw error;
  }
}

function jsonValue(value: unknown, path: string): DeploymentValidationResult<Json | undefined> {
  if (value === undefined) return deploymentValidationSuccess(undefined);
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return deploymentValidationSuccess(value);
  }
  if (Array.isArray(value)) {
    const parsedArray: Json[] = [];
    for (const [index, item] of value.entries()) {
      const parsed = jsonValue(item, `${path}[${index}]`);
      if (!parsed.success) return parsed;
      if (parsed.value === undefined) {
        return deploymentValidationFailure(`${path}[${index}]: Expected JSON value.`);
      }
      parsedArray.push(parsed.value);
    }
    return deploymentValidationSuccess(parsedArray);
  }
  if (isRecord(value)) {
    const record: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      const parsed = jsonValue(item, `${path}.${key}`);
      if (!parsed.success) return parsed;
      if (parsed.value === undefined) {
        return deploymentValidationFailure(`${path}.${key}: Expected JSON value.`);
      }
      record[key] = parsed.value;
    }
    return deploymentValidationSuccess(record);
  }
  return deploymentValidationFailure(`${path}: Expected JSON value.`);
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
