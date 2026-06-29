import { Effect } from "effect";
import { HttpError } from "../http";
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
    if (!result.success) {
      return yield* Effect.fail(new DeploymentValidationError({ message: result.message }));
    }
    return result.sourcePackage;
  },
);

export function validateSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  const result = normalizeSourcePackage(sourcePackage);
  if (!result.success) {
    throwDeploymentValidation(result.message);
  }
  return result.sourcePackage;
}

type SourcePackageValidationResult =
  | {
      readonly success: true;
      readonly sourcePackage: PushSourcePackage;
    }
  | {
      readonly success: false;
      readonly message: string;
    };

function normalizeSourcePackage(sourcePackage: PushSourcePackage): SourcePackageValidationResult {
  if (!Array.isArray(sourcePackage.modules)) {
    return sourcePackageValidationFailure("Source package modules must be an array.");
  }
  if (!Array.isArray(sourcePackage.functions)) {
    return sourcePackageValidationFailure("Source package functions must be an array.");
  }
  if (typeof sourcePackage.execution !== "string" || sourcePackage.execution.length === 0) {
    return sourcePackageValidationFailure("Source package execution module is required.");
  }
  const seen = new Set<string>();
  const modules = [];
  for (const module of sourcePackage.modules) {
    if (typeof module.path !== "string" || module.path.length === 0) {
      return sourcePackageValidationFailure("Source package module has an invalid path.");
    }
    if (seen.has(module.path)) {
      return sourcePackageValidationFailure(`Duplicate source module path: ${module.path}.`);
    }
    seen.add(module.path);
    if (module.environment !== "isolate") {
      return sourcePackageValidationFailure(
        `Source module ${module.path} has unsupported environment ${module.environment}.`,
      );
    }
    if (typeof module.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(module.sha256)) {
      return sourcePackageValidationFailure(`Source module ${module.path} has an invalid sha256.`);
    }
    if (module.source !== undefined && typeof module.source !== "string") {
      return sourcePackageValidationFailure(`Source module ${module.path} source must be a string.`);
    }
    if (module.sourceMap !== undefined && typeof module.sourceMap !== "string") {
      return sourcePackageValidationFailure(`Source module ${module.path} sourceMap must be a string.`);
    }
    modules.push({ ...module });
  }
  modules.sort((left, right) => left.path.localeCompare(right.path));
  if (!seen.has(sourcePackage.execution)) {
    return sourcePackageValidationFailure(`Source package execution module ${sourcePackage.execution} is missing.`);
  }
  if (sourcePackage.schema !== undefined && !seen.has(sourcePackage.schema)) {
    return sourcePackageValidationFailure(`Source package schema module ${sourcePackage.schema} is missing.`);
  }
  const functions = [...sourcePackage.functions].sort();
  for (const fn of functions) {
    if (typeof fn !== "string" || !seen.has(fn)) {
      return sourcePackageValidationFailure(`Source package function module ${String(fn)} is missing.`);
    }
  }
  return {
    success: true,
    sourcePackage: {
      modules,
      functions,
      ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
      execution: sourcePackage.execution,
    },
  };
}

function sourcePackageValidationFailure(message: string): SourcePackageValidationResult {
  return {
    success: false,
    message,
  };
}

function throwDeploymentValidation(message: string): never {
  throw new DeploymentValidationError({ message });
}

export function validateDiagnostics(value: unknown): PushDiagnostic[] {
  const result = normalizeDiagnostics(value);
  if (!result.success) {
    throwDeploymentValidation(result.message);
  }
  return result.diagnostics;
}

export const decodeDiagnostics = Effect.fn("DeploymentValidation.decodeDiagnostics")(
  function* (value: unknown): Effect.fn.Return<PushDiagnostic[], DeploymentValidationError> {
    const result = normalizeDiagnostics(value);
    if (!result.success) {
      return yield* Effect.fail(new DeploymentValidationError({ message: result.message }));
    }
    return result.diagnostics;
  },
);

type DiagnosticsValidationResult =
  | {
      readonly success: true;
      readonly diagnostics: PushDiagnostic[];
    }
  | {
      readonly success: false;
      readonly message: string;
    };

function normalizeDiagnostics(value: unknown): DiagnosticsValidationResult {
  if (value === undefined) {
    return {
      success: true,
      diagnostics: [],
    };
  }
  if (!Array.isArray(value)) {
    return diagnosticsValidationFailure("Push diagnostics must be an array.");
  }
  const diagnostics: PushDiagnostic[] = [];
  for (const [index, diagnostic] of value.slice(-100).entries()) {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      return diagnosticsValidationFailure(`Push diagnostic at index ${index} must be an object.`);
    }
    const record = diagnostic as Partial<PushDiagnostic>;
    if (record.level !== "log" && record.level !== "warn" && record.level !== "error") {
      return diagnosticsValidationFailure(`Push diagnostic at index ${index} has an invalid level.`);
    }
    if (typeof record.message !== "string") {
      return diagnosticsValidationFailure(`Push diagnostic at index ${index} has an invalid message.`);
    }
    diagnostics.push({
      level: record.level,
      message: record.message,
    });
  }
  return {
    success: true,
    diagnostics,
  };
}

function diagnosticsValidationFailure(message: string): DiagnosticsValidationResult {
  return {
    success: false,
    message,
  };
}

export function analyzedStartPushRequest(
  request: ProtocolAnalyzedStartPushRequest,
): AnalyzedStartPushRequest {
  const sourcePackage = validateSourcePackage(request.sourcePackage as PushSourcePackage);
  const diagnostics = request.diagnostics === undefined
    ? undefined
    : validateDiagnostics(request.diagnostics);
  if (request.analysis === undefined) {
    const error = request.error;
    if (error === undefined) {
      throw new Error("Parsed failed push request is missing error.");
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
}

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
  const sourcePackage = validateSourcePackage(request.sourcePackage);
  const error = request.error;
  const analysis = request.analysis === undefined ? undefined : validateAnalysis(request.analysis);
  const diagnostics = validateDiagnostics(request.diagnostics);
  if (analysis === undefined) {
    if (typeof error !== "string" || error.length === 0) {
      throwDeploymentValidation("A push without analysis must include an error message.");
    }
    return {
      sourcePackage,
      error,
      diagnostics,
    };
  }
  const hasCodegenAnalysis = Object.prototype.hasOwnProperty.call(request, "codegenAnalysis");
  const codegenAnalysis = validateCodegenAnalysis(
    hasCodegenAnalysis ? request.codegenAnalysis : codegenAnalysisFromDeploymentAnalysis(analysis),
    analysis,
  );
  return {
    sourcePackage,
    analysis,
    codegenAnalysis,
    diagnostics,
  };
}

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
  if (!isRecord(schema)) {
    throwDeploymentValidation("Schema must be an object.");
  }
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version) || schema.version < 0) {
    throwDeploymentValidation("Schema version must be a non-negative integer.");
  }
  if (!Array.isArray(schema.tables)) throwDeploymentValidation("Schema tables must be an array.");
  if (!Array.isArray(schema.indexes)) throwDeploymentValidation("Schema indexes must be an array.");

  const tableIds = new Set<number>();
  const normalizedTables = schema.tables.map(table => {
    if (!isRecord(table)) {
      throwDeploymentValidation("Schema table entry must be an object.");
    }
    const tableId = table.tableId;
    if (typeof tableId !== "number" || !Number.isInteger(tableId) || tableId <= 0) {
      throwDeploymentValidation(`Invalid table id for ${table.name}.`);
    }
    if (tableIds.has(tableId)) throwDeploymentValidation(`Duplicate table id ${tableId}.`);
    tableIds.add(tableId);
    const tableName = table.name;
    if (typeof tableName !== "string" || tableName.length === 0) {
      throwDeploymentValidation(`Table ${tableId} has an invalid name.`);
    }
    return {
      tableId,
      name: tableName,
      state: parseTableState(table.state),
      validator: safeValidator(table.validator ?? null, `$schema.tables.${tableName}.validator`),
      placement: validatePlacement(table.placement, `$schema.tables.${tableName}.placement`),
    };
  });

  const indexIds = new Set<number>();
  const normalizedIndexes = schema.indexes.map(index => {
    if (!isRecord(index)) {
      throwDeploymentValidation("Schema index entry must be an object.");
    }
    const indexId = index.indexId;
    if (typeof indexId !== "number" || !Number.isInteger(indexId) || indexId <= 0) {
      throwDeploymentValidation(`Invalid index id for ${index.name}.`);
    }
    if (indexIds.has(indexId)) throwDeploymentValidation(`Duplicate index id ${indexId}.`);
    indexIds.add(indexId);
    const tableId = index.tableId;
    if (typeof tableId !== "number" || !tableIds.has(tableId)) {
      throwDeploymentValidation(`Index ${index.name} references unknown table id ${String(index.tableId)}.`);
    }
    const indexName = index.name;
    if (typeof indexName !== "string" || indexName.length === 0) {
      throwDeploymentValidation(`Index ${indexId} has an invalid name.`);
    }
    if (!Array.isArray(index.fields) || !index.fields.every(field => typeof field === "string")) {
      throwDeploymentValidation(`Index ${indexName} has invalid fields.`);
    }
    return {
      indexId,
      tableId,
      name: indexName,
      fields: [...index.fields],
      state: parseIndexState(index.state),
    };
  });

  return { version: schema.version, tables: normalizedTables, indexes: normalizedIndexes };
}

export function validateFunctions(functions: unknown): DeploymentFunctions {
  if (!isRecord(functions)) {
    throw new HttpError(400, "Function metadata must be an object.");
  }
  if (!Array.isArray(functions.functions)) {
    throw new HttpError(400, "Function metadata must include a functions array.");
  }
  const seen = new Set<string>();
  const normalized = functions.functions.map((metadata, index) => {
    if (!isRecord(metadata)) {
      throw new HttpError(400, `Function metadata at index ${index} must be an object.`);
    }
    const path = metadata.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new HttpError(400, `Function metadata at index ${index} has an invalid path.`);
    }
    if (seen.has(path)) throw new HttpError(400, `Duplicate function metadata path: ${path}.`);
    seen.add(path);
    const kind = parseFunctionKind(metadata.kind, `$functions.${path}.kind`);
    const visibility = parseVisibility(metadata.visibility ?? "public", `$functions.${path}.visibility`);
    const args = safeValidator(metadata.args ?? null, `$functions.${path}.args`);
    const returns = safeValidator(metadata.returns ?? null, `$functions.${path}.returns`);
    const route = validateFunctionRoutePolicy(metadata.route, `$functions.${path}.route`);
    const partition = validateFunctionPartitionPolicy(
      metadata.partition,
      `$functions.${path}.partition`,
    );
    const position = validateSourcePosition(metadata.position, `$functions.${path}.position`);
    return {
      path,
      kind,
      visibility,
      args,
      returns,
      route,
      partition,
      ...(position === undefined ? {} : { position }),
    };
  });
  return { functions: normalized };
}

export function validateAnalysis(analysis: unknown): DeploymentAnalysis {
  if (!isRecord(analysis)) {
    throwDeploymentValidation("Deployment analysis must be an object.");
  }
  const schema = validateSchema(analysis.schema);
  const functions = validateFunctions(analysis.functions);
  validateFunctionPartitions(functions, schema);
  return {
    schema,
    functions,
  };
}

export function validateCodegenAnalysis(
  codegenAnalysis: unknown,
  analysis: DeploymentAnalysis,
): DeploymentCodegenAnalysis {
  if (!isRecord(codegenAnalysis)) {
    throwDeploymentValidation("Codegen analysis must be an object.");
  }
  const schema = validateSchema(codegenAnalysis.schema);
  if (canonicalJson(schema) !== canonicalJson(analysis.schema)) {
    throwDeploymentValidation("Codegen analysis schema must match deployment analysis schema.");
  }
  if (!Array.isArray(codegenAnalysis.functions)) {
    throwDeploymentValidation("Codegen analysis functions must be an array.");
  }

  const metadataByPath = new Map(analysis.functions.functions.map(metadata => [metadata.path, metadata]));
  const seenModuleNames = new Set<string>();
  const seenPaths = new Set<string>();
  const modules = codegenAnalysis.functions.map((module, moduleIndex) => {
    if (!isRecord(module)) {
      throwDeploymentValidation(`Codegen module at index ${moduleIndex} must be an object.`);
    }
    if (typeof module.moduleName !== "string" || module.moduleName.length === 0) {
      throwDeploymentValidation(`Codegen module at index ${moduleIndex} has an invalid moduleName.`);
    }
    if (!Array.isArray(module.functions)) {
      throwDeploymentValidation(`Codegen module ${module.moduleName} functions must be an array.`);
    }
    const moduleName = module.moduleName;
    if (seenModuleNames.has(moduleName)) {
      throwDeploymentValidation(`Duplicate codegen module metadata: ${moduleName}.`);
    }
    seenModuleNames.add(moduleName);
    return {
      moduleName,
      functions: module.functions.map((fn, functionIndex) => {
        if (!isRecord(fn)) {
          throwDeploymentValidation(`Codegen function ${moduleName}[${functionIndex}] must be an object.`);
        }
        if (fn.moduleName !== moduleName) {
          throwDeploymentValidation(
            `Codegen function ${moduleName}[${functionIndex}] moduleName must match its module.`,
          );
        }
        if (typeof fn.exportName !== "string" || fn.exportName.length === 0) {
          throwDeploymentValidation(
            `Codegen function ${moduleName}[${functionIndex}] has an invalid exportName.`,
          );
        }
        const exportName = fn.exportName;
        const path = functionPathFromCodegen(moduleName, exportName);
        const metadata = metadataByPath.get(path);
        if (metadata === undefined) {
          throwDeploymentValidation(`Codegen function ${path} has no deployment function metadata.`);
        }
        if (seenPaths.has(path)) {
          throwDeploymentValidation(`Duplicate codegen function metadata path: ${path}.`);
        }
        seenPaths.add(path);
        const kind = parseFunctionKind(fn.kind, `$codegen.functions.${path}.kind`);
        const visibility = parseVisibility(fn.visibility, `$codegen.functions.${path}.visibility`);
        const args = safeValidator(fn.args, `$codegen.functions.${path}.args`);
        if (args === null) {
          throwDeploymentValidation(`$codegen.functions.${path}.args: Validator is required.`);
        }
        const returns = safeValidator(fn.returns ?? null, `$codegen.functions.${path}.returns`);
        const partition = validateFunctionPartitionPolicy(
          fn.partition,
          `$codegen.functions.${path}.partition`,
        );
        const position = validateSourcePosition(fn.position, `$codegen.functions.${path}.position`);
        assertCodegenFunctionMatchesMetadata(path, {
          kind,
          visibility,
          args,
          returns,
          partition,
          position,
        }, metadata);
        return {
          moduleName,
          exportName,
          kind,
          visibility,
          args,
          returns,
          partition,
          ...(position === undefined ? {} : { position }),
        };
      }),
    };
  });
  if (seenPaths.size !== metadataByPath.size) {
    throwDeploymentValidation("Codegen analysis functions must cover every deployment function.");
  }
  return { schema, functions: modules };
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
): void {
  const expected = {
    kind: metadata.kind,
    visibility: metadata.visibility ?? "public",
    args: metadata.args ?? { type: "any" },
    returns: metadata.returns ?? null,
    partition: metadata.partition ?? null,
    position: metadata.position,
  };
  if (canonicalJson(codegen) !== canonicalJson(expected)) {
    throwDeploymentValidation(`Codegen function ${path} must match deployment function metadata.`);
  }
}

function functionPathFromCodegen(moduleName: string, exportName: string): string {
  return exportName === "default" ? moduleName : `${moduleName}:${exportName}`;
}

function validateFunctionPartitions(
  functions: DeploymentFunctions,
  schema: DeploymentSchema,
): void {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  for (const metadata of functions.functions) {
    const partition = metadata.partition;
    if (partition === undefined || partition === null) continue;
    const table = tables.get(partition.table);
    if (table === undefined || table.state === "deleted") {
      throwDeploymentValidation(`${metadata.path}.partition: Unknown partition table ${partition.table}.`);
    }
    if (table.placement.kind !== "partitionBy") {
      throwDeploymentValidation(`${metadata.path}.partition: Table ${partition.table} is not partitioned.`);
    }
    if (partition.type === "partitionCreateRoot") {
      if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
        throwDeploymentValidation(
          `${metadata.path}.partition: create-root partition requires ${partition.table} to be partitioned by _id.`,
        );
      }
      if (metadata.route !== null && metadata.route !== undefined) {
        throwDeploymentValidation(
          `${metadata.path}.partition: create-root partition cannot declare route metadata.`,
        );
      }
      continue;
    }
    if (table.placement.field !== partition.partitionField) {
      throwDeploymentValidation(
        `${metadata.path}.partition: Selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
      );
    }
    const expectedSelector = selectorNameForPartitionField(table.placement.field);
    if (partition.selector !== expectedSelector) {
      throwDeploymentValidation(
        `${metadata.path}.partition: Expected selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
      );
    }
    if (!validatorHasRequiredField(metadata.args ?? null, partition.argField)) {
      throwDeploymentValidation(
        `${metadata.path}.partition: args.${partition.argField} is not a required argument.`,
      );
    }
    if (
      metadata.route !== null &&
      metadata.route !== undefined &&
      metadata.route.type === "args" &&
      metadata.route.field !== partition.argField
    ) {
      throwDeploymentValidation(
        `${metadata.path}.partition: partition argument ${partition.argField} must match route argument ${metadata.route.field}.`,
      );
    }
  }
}

function parseTableState(value: unknown): NonNullable<SchemaTable["state"]> {
  if (value === undefined) return "active";
  if (value === "active" || value === "hidden" || value === "deleted") return value;
  throw new HttpError(400, "Schema table has invalid state.");
}

function parseIndexState(value: unknown): NonNullable<DeploymentSchema["indexes"][number]["state"]> {
  if (value === undefined) return "enabled";
  if (value === "enabled" || value === "staged" || value === "disabled") return value;
  throw new HttpError(400, "Schema index has invalid state.");
}

function validateSourcePosition(
  value: unknown,
  path: string,
): AnalyzedSourcePosition | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${path}: Invalid source position.`);
  }
  const position = value as Partial<AnalyzedSourcePosition>;
  if (typeof position.path !== "string" || position.path.length === 0) {
    throw new HttpError(400, `${path}.path: Source position path must be a non-empty string.`);
  }
  if (
    typeof position.startLine !== "number" ||
    !Number.isInteger(position.startLine) ||
    position.startLine <= 0
  ) {
    throw new HttpError(400, `${path}.startLine: Source position line must be a positive integer.`);
  }
  if (
    typeof position.startColumn !== "number" ||
    !Number.isInteger(position.startColumn) ||
    position.startColumn <= 0
  ) {
    throw new HttpError(400, `${path}.startColumn: Source position column must be a positive integer.`);
  }
  return {
    path: position.path,
    startLine: position.startLine,
    startColumn: position.startColumn,
  };
}

function validateFunctionRoutePolicy(
  value: unknown,
  path: string,
): FunctionRoutePolicy | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${path}: Invalid route policy.`);
  }
  const route = value as Partial<FunctionRoutePolicy>;
  if (route.type === "args" && typeof route.field === "string" && route.field.length > 0) {
    return { type: "args", field: route.field };
  }
  throw new HttpError(400, `${path}: Invalid route policy.`);
}

function validateFunctionPartitionPolicy(
  value: unknown,
  path: string,
): FunctionPartitionMetadata | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, `${path}: Invalid partition policy.`);
  }
  const partition = value as Partial<FunctionPartitionMetadata>;
  if (
    partition.type === "partitionCreateRoot" &&
    typeof partition.table === "string" &&
    partition.table.length > 0 &&
    partition.partitionField === "_id"
  ) {
    return {
      type: "partitionCreateRoot",
      table: partition.table,
      partitionField: "_id",
    };
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
    return {
      type: "partition",
      table: partition.table,
      selector: partition.selector,
      partitionField: partition.partitionField,
      argField: partition.argField,
    };
  }
  throw new HttpError(400, `${path}: Invalid partition policy.`);
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

function validatePlacement(value: unknown, path: string): SchemaTable["placement"] {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("kind" in value)) {
    throw new HttpError(400, `${path}: Invalid placement.`);
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
  throw new HttpError(400, `${path}: Invalid placement.`);
}

function parseFunctionKind(value: unknown, path: string): DeploymentFunctionKind {
  if (
    value === "query" ||
    value === "mutation" ||
    value === "action" ||
    value === "workflowMutation"
  ) {
    return value;
  }
  throw new HttpError(400, `${path}: Invalid function kind ${value}.`);
}

function parseVisibility(value: unknown, path: string): FunctionVisibility {
  if (value === "public" || value === "internal") return value;
  throw new HttpError(400, `${path}: Invalid function visibility ${value}.`);
}

function safeValidator(value: unknown, path: string): ValidatorJson | null {
  try {
    return assertValidatorJson(jsonValue(value, path), path);
  } catch (error) {
    if (error instanceof BackendValidationError) {
      throw new HttpError(400, `Invalid validator metadata: ${error.message}`);
    }
    throw error;
  }
}

function jsonValue(value: unknown, path: string): Json | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const parsed = jsonValue(item, `${path}[${index}]`);
      if (parsed === undefined) throw new HttpError(400, `${path}[${index}]: Expected JSON value.`);
      return parsed;
    });
  }
  if (isRecord(value)) {
    const record: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      const parsed = jsonValue(item, `${path}.${key}`);
      if (parsed === undefined) throw new HttpError(400, `${path}.${key}: Expected JSON value.`);
      record[key] = parsed;
    }
    return record;
  }
  throw new HttpError(400, `${path}: Expected JSON value.`);
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
