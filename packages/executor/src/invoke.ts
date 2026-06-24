import {
  DeploymentSchemaMetadataUnavailableError,
  FunctionKindMismatchError,
  FunctionVisibilityMismatchError,
  FunctionNotInvokableError,
  PartitionValidationError,
} from "./errors";
import { getActiveFunction } from "./functions";
import type {
  DeploymentSchemaMetadata,
  FlarexExecutorPersistence,
  FunctionExecutionScope,
  FunctionPartitionCreateRootPolicy,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  InvokableFunctionKind,
  PrepareInvokeInput,
  PrepareInvokeResult,
  SchemaIndexMetadata,
  SchemaTableMetadata,
  TablePlacement,
} from "./types";

export async function prepareInvoke(
  persistence: FlarexExecutorPersistence,
  input: PrepareInvokeInput,
): Promise<PrepareInvokeResult> {
  const active = await getActiveFunction(persistence, input);
  if (!isInvokableFunctionKind(active.function.kind)) {
    throw new FunctionNotInvokableError(
      input.deploymentId,
      input.path,
      active.function.kind,
    );
  }
  if (input.kind !== undefined && input.kind !== active.function.kind) {
    throw new FunctionKindMismatchError(
      input.deploymentId,
      input.path,
      input.kind,
      active.function.kind,
    );
  }
  const expectedVisibility = input.visibility ?? "public";
  const actualVisibility = active.function.visibility ?? "public";
  if (expectedVisibility !== actualVisibility) {
    throw new FunctionVisibilityMismatchError(
      input.deploymentId,
      input.path,
      expectedVisibility,
      actualVisibility,
    );
  }
  const schema = deploymentSchemaFromAnalysis(
    active.package.analysisJson,
    active.package.deploymentId,
    active.package.packageId,
  );

  return {
    ...active,
    function: {
      ...active.function,
      kind: active.function.kind,
    },
    schema,
    scope: resolveFunctionExecutionScope(
      active.function.partition,
      active.function.route,
      input,
      schema,
    ),
    executionModule: active.package.executionModule,
  };
}

export function deploymentSchemaFromAnalysis(
  analysisJson: unknown,
  deploymentId: string,
  packageId: string,
): DeploymentSchemaMetadata {
  const analysis = asRecord(analysisJson);
  if (analysis === null) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson must be an object",
    );
  }

  const schema = asRecord(analysis.schema);
  if (schema === null) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema must be an object",
    );
  }
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version)) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema.version must be an integer",
    );
  }
  if (!Array.isArray(schema.tables)) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema.tables must be an array",
    );
  }
  if (!Array.isArray(schema.indexes)) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema.indexes must be an array",
    );
  }

  return {
    version: schema.version,
    tables: schema.tables.map((table, index) =>
      schemaTableFromJson(table, deploymentId, packageId, index),
    ),
    indexes: schema.indexes.map((indexMetadata, index) =>
      schemaIndexFromJson(indexMetadata, deploymentId, packageId, index),
    ),
  };
}

function schemaTableFromJson(
  value: unknown,
  deploymentId: string,
  packageId: string,
  index: number,
): SchemaTableMetadata {
  const table = asRecord(value);
  if (table === null) {
    throw invalidSchemaMetadata(deploymentId, packageId, `table at index ${index} must be an object`);
  }
  if (typeof table.tableId !== "number" || !Number.isInteger(table.tableId)) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `table at index ${index} tableId must be an integer`,
    );
  }
  if (typeof table.name !== "string" || table.name.length === 0) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `table at index ${index} name must be a non-empty string`,
    );
  }
  if (
    table.state !== undefined &&
    table.state !== "active" &&
    table.state !== "hidden" &&
    table.state !== "deleted"
  ) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `table at index ${index} state is invalid`,
    );
  }

  return {
    tableId: table.tableId,
    name: table.name,
    ...(table.state === undefined ? {} : { state: table.state }),
    placement: tablePlacementFromJson(
      table.placement,
      deploymentId,
      packageId,
      index,
    ),
  };
}

function tablePlacementFromJson(
  value: unknown,
  deploymentId: string,
  packageId: string,
  tableIndex: number,
): TablePlacement {
  const placement = asRecord(value);
  if (placement === null) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `table at index ${tableIndex} placement must be an object`,
    );
  }
  if (placement.kind === "global") {
    return { kind: "global" };
  }
  if (
    placement.kind === "partitionBy" &&
    typeof placement.field === "string" &&
    placement.field.length > 0
  ) {
    return {
      kind: "partitionBy",
      field: placement.field,
    };
  }
  if (
    placement.kind === "colocateWith" &&
    typeof placement.table === "string" &&
    placement.table.length > 0 &&
    typeof placement.field === "string" &&
    placement.field.length > 0
  ) {
    return {
      kind: "colocateWith",
      table: placement.table,
      field: placement.field,
    };
  }

  throw invalidSchemaMetadata(
    deploymentId,
    packageId,
    `table at index ${tableIndex} placement is invalid`,
  );
}

function schemaIndexFromJson(
  value: unknown,
  deploymentId: string,
  packageId: string,
  index: number,
): SchemaIndexMetadata {
  const indexMetadata = asRecord(value);
  if (indexMetadata === null) {
    throw invalidSchemaMetadata(deploymentId, packageId, `index at index ${index} must be an object`);
  }
  if (typeof indexMetadata.indexId !== "number" || !Number.isInteger(indexMetadata.indexId)) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `index at index ${index} indexId must be an integer`,
    );
  }
  if (typeof indexMetadata.tableId !== "number" || !Number.isInteger(indexMetadata.tableId)) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `index at index ${index} tableId must be an integer`,
    );
  }
  if (typeof indexMetadata.name !== "string" || indexMetadata.name.length === 0) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `index at index ${index} name must be a non-empty string`,
    );
  }
  if (!Array.isArray(indexMetadata.fields) || !indexMetadata.fields.every(field => typeof field === "string")) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `index at index ${index} fields must be a string array`,
    );
  }
  if (
    indexMetadata.state !== undefined &&
    indexMetadata.state !== "enabled" &&
    indexMetadata.state !== "staged" &&
    indexMetadata.state !== "disabled"
  ) {
    throw invalidSchemaMetadata(
      deploymentId,
      packageId,
      `index at index ${index} state is invalid`,
    );
  }

  return {
    indexId: indexMetadata.indexId,
    tableId: indexMetadata.tableId,
    name: indexMetadata.name,
    fields: [...indexMetadata.fields],
    ...(indexMetadata.state === undefined ? {} : { state: indexMetadata.state }),
  };
}

export function resolveFunctionExecutionScope(
  partition: FunctionPartitionPolicy | FunctionPartitionCreateRootPolicy | null | undefined,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<PrepareInvokeInput, "path" | "args" | "partitionKey">,
  schema: DeploymentSchemaMetadata,
): FunctionExecutionScope {
  if (partition === undefined || partition === null) {
    throw new PartitionValidationError(
      `function ${request.path} must declare partition metadata.`,
    );
  }
  if (partition.type === "partitionCreateRoot") {
    return resolveCreateRootExecutionScope(partition, route, request, schema);
  }

  validatePartitionPolicyAgainstSchema(partition, request.path, schema);
  if (
    route !== null &&
    route !== undefined &&
    route.type === "args" &&
    route.field !== partition.argField
  ) {
    throw new PartitionValidationError(
      `${request.path} partition argument ${partition.argField} must match route argument ${route.field}.`,
    );
  }
  const partitionKey = partitionKeyFromArgs(
    request,
    partition.argField,
    `partition ${partition.table}.${partition.selector}`,
  );
  if (request.partitionKey !== partitionKey) {
    throw new PartitionValidationError(
      `partitionKey must match args.${partition.argField} for ${request.path}.`,
    );
  }

  return {
    kind: "partition",
    table: partition.table,
    selector: partition.selector,
    partitionField: partition.partitionField,
    argField: partition.argField,
    partitionKey,
  };
}

function resolveCreateRootExecutionScope(
  partition: FunctionPartitionCreateRootPolicy,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<PrepareInvokeInput, "path" | "args" | "partitionKey">,
  schema: DeploymentSchemaMetadata,
): FunctionExecutionScope {
  if (route !== null && route !== undefined) {
    throw new PartitionValidationError(
      `create-root partition for ${request.path} cannot declare route metadata.`,
    );
  }
  const table = tableForName(schema, partition.table);
  if (table.placement.kind !== "partitionBy") {
    throw new PartitionValidationError(
      `${request.path} create-root partition table ${partition.table} is not partitioned.`,
    );
  }
  if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
    throw new PartitionValidationError(
      `${request.path} create-root partition requires ${partition.table} to be partitioned by _id.`,
    );
  }

  const preallocatedRootId = encodeFlarexId(table.tableId);
  if (request.partitionKey !== undefined && request.partitionKey !== preallocatedRootId) {
    throw new PartitionValidationError(
      `partitionKey cannot be supplied for create-root ${request.path}; backend preallocated ${preallocatedRootId}.`,
    );
  }

  return {
    kind: "partitionCreateRoot",
    table: partition.table,
    partitionField: "_id",
    partitionKey: preallocatedRootId,
    preallocatedRootId,
  };
}

function validatePartitionPolicyAgainstSchema(
  partition: FunctionPartitionPolicy,
  path: string,
  schema: DeploymentSchemaMetadata,
): void {
  const table = tableForName(schema, partition.table);
  if (table.placement.kind !== "partitionBy") {
    throw new PartitionValidationError(
      `${path} partition table ${partition.table} is not partitioned.`,
    );
  }
  if (table.placement.field !== partition.partitionField) {
    throw new PartitionValidationError(
      `${path} partition selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
    );
  }
  const expectedSelector = selectorNameForPartitionField(table.placement.field);
  if (partition.selector !== expectedSelector) {
    throw new PartitionValidationError(
      `${path} expected partition selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
    );
  }
}

function partitionKeyFromArgs(
  request: Pick<PrepareInvokeInput, "path" | "args">,
  field: string,
  label: string,
): string {
  if (typeof request.args !== "object" || request.args === null || Array.isArray(request.args)) {
    throw new PartitionValidationError(
      `${request.path} ${label} requires object arguments.`,
    );
  }
  const value = request.args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new PartitionValidationError(
      `${request.path} ${label} requires a non-empty string argument.`,
    );
  }
  return value;
}

export function tableForName(
  schema: DeploymentSchemaMetadata,
  tableName: string,
): SchemaTableMetadata {
  const table = schema.tables.find(
    candidate => candidate.name === tableName && candidate.state !== "deleted",
  );
  if (table === undefined) {
    throw new PartitionValidationError(`Unknown table: ${tableName}.`);
  }
  return table;
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

export function encodeFlarexId(tableId: number, documentId: string = crypto.randomUUID()): string {
  if (!Number.isInteger(tableId) || tableId < 0) {
    throw new Error(`Flarex table id must be a non-negative integer, got ${tableId}.`);
  }
  if (documentId.length === 0) {
    throw new Error("Flarex document id suffix must not be empty.");
  }
  return `${tableId}:${documentId}`;
}

function invalidSchemaMetadata(
  deploymentId: string,
  packageId: string,
  message: string,
): DeploymentSchemaMetadataUnavailableError {
  return new DeploymentSchemaMetadataUnavailableError(
    deploymentId,
    packageId,
    message,
  );
}

function isInvokableFunctionKind(value: string): value is InvokableFunctionKind {
  return value === "query" || value === "mutation";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
