import { HttpError } from "../http";
import type {
  AnalyzedSourcePosition,
  DeploymentFunctionKind,
  DeploymentFunctions,
  DeploymentSchema,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  FunctionVisibility,
  Json,
  PushDiagnostic,
  PushSourcePackage,
  SchemaTable,
  ValidatorJson,
} from "../types";
import { assertValidatorJson, BackendValidationError } from "../validation";

export function validateSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  if (!Array.isArray(sourcePackage.modules)) {
    throw new HttpError(400, "Source package modules must be an array.");
  }
  if (!Array.isArray(sourcePackage.functions)) {
    throw new HttpError(400, "Source package functions must be an array.");
  }
  if (typeof sourcePackage.execution !== "string" || sourcePackage.execution.length === 0) {
    throw new HttpError(400, "Source package execution module is required.");
  }
  const seen = new Set<string>();
  const modules = sourcePackage.modules.map(module => {
    if (typeof module.path !== "string" || module.path.length === 0) {
      throw new HttpError(400, "Source package module has an invalid path.");
    }
    if (seen.has(module.path)) throw new HttpError(400, `Duplicate source module path: ${module.path}.`);
    seen.add(module.path);
    if (module.environment !== "isolate") {
      throw new HttpError(400, `Source module ${module.path} has unsupported environment ${module.environment}.`);
    }
    if (typeof module.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(module.sha256)) {
      throw new HttpError(400, `Source module ${module.path} has an invalid sha256.`);
    }
    if (module.source !== undefined && typeof module.source !== "string") {
      throw new HttpError(400, `Source module ${module.path} source must be a string.`);
    }
    if (module.sourceMap !== undefined && typeof module.sourceMap !== "string") {
      throw new HttpError(400, `Source module ${module.path} sourceMap must be a string.`);
    }
    return { ...module };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (!seen.has(sourcePackage.execution)) {
    throw new HttpError(400, `Source package execution module ${sourcePackage.execution} is missing.`);
  }
  if (sourcePackage.schema !== undefined && !seen.has(sourcePackage.schema)) {
    throw new HttpError(400, `Source package schema module ${sourcePackage.schema} is missing.`);
  }
  const functions = [...sourcePackage.functions].sort();
  for (const fn of functions) {
    if (typeof fn !== "string" || !seen.has(fn)) {
      throw new HttpError(400, `Source package function module ${String(fn)} is missing.`);
    }
  }
  return {
    modules,
    functions,
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    execution: sourcePackage.execution,
  };
}

export function validateDiagnostics(value: unknown): PushDiagnostic[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Push diagnostics must be an array.");
  }
  return value.slice(-100).map((diagnostic, index) => {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      throw new HttpError(400, `Push diagnostic at index ${index} must be an object.`);
    }
    const record = diagnostic as Partial<PushDiagnostic>;
    if (record.level !== "log" && record.level !== "warn" && record.level !== "error") {
      throw new HttpError(400, `Push diagnostic at index ${index} has an invalid level.`);
    }
    if (typeof record.message !== "string") {
      throw new HttpError(400, `Push diagnostic at index ${index} has an invalid message.`);
    }
    return {
      level: record.level,
      message: record.message,
    };
  });
}

export function validateSchema(schema: unknown): DeploymentSchema {
  if (!isRecord(schema)) {
    throw new HttpError(400, "Schema must be an object.");
  }
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version) || schema.version < 0) {
    throw new HttpError(400, "Schema version must be a non-negative integer.");
  }
  if (!Array.isArray(schema.tables)) throw new HttpError(400, "Schema tables must be an array.");
  if (!Array.isArray(schema.indexes)) throw new HttpError(400, "Schema indexes must be an array.");

  const tableIds = new Set<number>();
  const normalizedTables = schema.tables.map(table => {
    if (!isRecord(table)) {
      throw new HttpError(400, "Schema table entry must be an object.");
    }
    const tableId = table.tableId;
    if (typeof tableId !== "number" || !Number.isInteger(tableId) || tableId <= 0) {
      throw new HttpError(400, `Invalid table id for ${table.name}.`);
    }
    if (tableIds.has(tableId)) throw new HttpError(400, `Duplicate table id ${tableId}.`);
    tableIds.add(tableId);
    const tableName = table.name;
    if (typeof tableName !== "string" || tableName.length === 0) {
      throw new HttpError(400, `Table ${tableId} has an invalid name.`);
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
      throw new HttpError(400, "Schema index entry must be an object.");
    }
    const indexId = index.indexId;
    if (typeof indexId !== "number" || !Number.isInteger(indexId) || indexId <= 0) {
      throw new HttpError(400, `Invalid index id for ${index.name}.`);
    }
    if (indexIds.has(indexId)) throw new HttpError(400, `Duplicate index id ${indexId}.`);
    indexIds.add(indexId);
    const tableId = index.tableId;
    if (typeof tableId !== "number" || !tableIds.has(tableId)) {
      throw new HttpError(400, `Index ${index.name} references unknown table id ${String(index.tableId)}.`);
    }
    const indexName = index.name;
    if (typeof indexName !== "string" || indexName.length === 0) {
      throw new HttpError(400, `Index ${indexId} has an invalid name.`);
    }
    if (!Array.isArray(index.fields) || !index.fields.every(field => typeof field === "string")) {
      throw new HttpError(400, `Index ${indexName} has invalid fields.`);
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

export function validateFunctionPartitions(
  functions: DeploymentFunctions,
  schema: DeploymentSchema,
): void {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  for (const metadata of functions.functions) {
    const partition = metadata.partition;
    if (partition === undefined || partition === null) continue;
    const table = tables.get(partition.table);
    if (table === undefined || table.state === "deleted") {
      throw new HttpError(400, `${metadata.path}.partition: Unknown partition table ${partition.table}.`);
    }
    if (table.placement.kind !== "partitionBy") {
      throw new HttpError(400, `${metadata.path}.partition: Table ${partition.table} is not partitioned.`);
    }
    if (partition.type === "partitionCreateRoot") {
      if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
        throw new HttpError(
          400,
          `${metadata.path}.partition: create-root partition requires ${partition.table} to be partitioned by _id.`,
        );
      }
      if (metadata.route !== null && metadata.route !== undefined) {
        throw new HttpError(
          400,
          `${metadata.path}.partition: create-root partition cannot declare route metadata.`,
        );
      }
      continue;
    }
    if (table.placement.field !== partition.partitionField) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: Selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
      );
    }
    const expectedSelector = selectorNameForPartitionField(table.placement.field);
    if (partition.selector !== expectedSelector) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: Expected selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
      );
    }
    if (!validatorHasRequiredField(metadata.args ?? null, partition.argField)) {
      throw new HttpError(
        400,
        `${metadata.path}.partition: args.${partition.argField} is not a required argument.`,
      );
    }
    if (
      metadata.route !== null &&
      metadata.route !== undefined &&
      metadata.route.type === "args" &&
      metadata.route.field !== partition.argField
    ) {
      throw new HttpError(
        400,
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

export function validateSourcePosition(
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

export function validateFunctionPartitionPolicy(
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

export function parseFunctionKind(value: unknown, path: string): DeploymentFunctionKind {
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

export function parseVisibility(value: unknown, path: string): FunctionVisibility {
  if (value === "public" || value === "internal") return value;
  throw new HttpError(400, `${path}: Invalid function visibility ${value}.`);
}

export function safeValidator(value: unknown, path: string): ValidatorJson | null {
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

export function canonicalJson(value: unknown): string {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
