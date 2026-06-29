import { Data, Effect } from "effect";
import { DeploymentRoute } from "flarex-protocol/deployment";
import { HttpError } from "./http";
import {
  indexBoundsForExpressions,
  type IndexRangeExpression,
} from "./indexKeys";
import { encodeFlarexId, isFlarexIdForTable, parseFlarexId } from "./ids";
import { deploymentObjectName } from "./routing";
import {
  PartitionRequestError,
  SingleShardTransaction,
} from "./transaction";
import type {
  ActiveDeploymentStatus,
  BackendFunctionKind,
  CommitResponse,
  DeploymentFunctionMetadata,
  DeploymentSchema,
  DeploymentFunctionKind,
  Env,
  FunctionExecutionScope,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  InvokeRequest,
  InvokeResponse,
  Json,
  SchemaTable,
  ValidatorJson,
} from "./types";
import { BackendValidationError, validateJsonValue } from "./validation";

type InvokeEnv = Pick<Env, "DEPLOYMENTS" | "PARTITIONS">;

export class InvokeActiveFunctionMetadataNotFoundError
  extends Data.TaggedError("InvokeActiveFunctionMetadataNotFoundError")<{
    readonly path: string;
  }> {}

export class InvokeFunctionNotFoundError
  extends Data.TaggedError("InvokeFunctionNotFoundError")<{
    readonly path: string;
  }> {}

export class InvokeUnsupportedFunctionKindError
  extends Data.TaggedError("InvokeUnsupportedFunctionKindError")<{
    readonly path: string;
    readonly kind: DeploymentFunctionKind;
  }> {}

export class InvokeFunctionKindMismatchError
  extends Data.TaggedError("InvokeFunctionKindMismatchError")<{
    readonly path: string;
    readonly metadataKind: DeploymentFunctionKind;
    readonly handlerKind: BackendFunctionKind;
  }> {}

export class InvokeRequestKindMismatchError
  extends Data.TaggedError("InvokeRequestKindMismatchError")<{
    readonly requestKind: BackendFunctionKind;
    readonly functionKind: BackendFunctionKind;
  }> {}

export class InvokeArgumentValidationError
  extends Data.TaggedError("InvokeArgumentValidationError")<{
    readonly message: string;
  }> {}

export class InvokeReturnValidationError
  extends Data.TaggedError("InvokeReturnValidationError")<{
    readonly message: string;
  }> {}

export type InvokeFunctionValidationError =
  | InvokeActiveFunctionMetadataNotFoundError
  | InvokeArgumentValidationError
  | InvokeFunctionKindMismatchError
  | InvokeFunctionNotFoundError
  | InvokeRequestKindMismatchError
  | InvokeUnsupportedFunctionKindError;

export type InvokeReturnValidationFailure = InvokeReturnValidationError;

export type InvokeValidationError =
  | InvokeFunctionValidationError
  | InvokeReturnValidationFailure;

export type BackendQueryCtx = {
  db: BackendDatabaseReader;
};

export type BackendMutationCtx = {
  db: BackendDatabaseWriter;
};

export type BackendDatabaseReader = {
  get(id: string): Promise<Json | null>;
  query(table: string): BackendQueryInitializer;
  queryIndex(options: {
    indexId: number;
    lower?: string;
    upper?: string;
    limit?: number;
  }): Promise<Json[]>;
};

export type BackendIndexRange = {
  expressions: IndexRangeExpression[];
};

export type BackendOrderedQuery = {
  order(order: "asc" | "desc"): BackendOrderedQuery;
  collect(): Promise<Json[]>;
  take(limit: number): Promise<Json[]>;
  first(): Promise<Json | null>;
  unique(): Promise<Json | null>;
  paginate(options: {
    numItems: number;
    cursor: string | null;
  }): Promise<{ page: Json[]; isDone: boolean; continueCursor: string }>;
};

export type BackendQueryInitializer = BackendOrderedQuery & {
  withIndex(
    index: string,
    range?: (builder: BackendIndexRangeBuilder) => BackendIndexRange,
  ): BackendOrderedQuery;
};

export type BackendIndexRangeBuilder = BackendIndexRange & {
  eq(field: string, value: Json): BackendIndexRangeBuilder;
  gt(field: string, value: Json): BackendIndexRangeBuilder;
  gte(field: string, value: Json): BackendIndexRangeBuilder;
  lt(field: string, value: Json): BackendIndexRangeBuilder;
  lte(field: string, value: Json): BackendIndexRangeBuilder;
};

export type BackendDatabaseWriter = BackendDatabaseReader & {
  insert(table: string, value: Json, id?: string): Promise<string>;
  replace(id: string, value: Json): Promise<void>;
  patch(id: string, value: Record<string, Json>): Promise<void>;
  delete(id: string): Promise<void>;
};

export type BackendRegisteredFunction =
  | {
      kind: "query";
      args?: ValidatorJson;
      returns?: ValidatorJson | null;
      route?: FunctionRoutePolicy | null;
      partition?: FunctionPartitionMetadata | null;
      handler: (ctx: BackendQueryCtx, args: Json) => Promise<Json> | Json;
    }
  | {
      kind: "mutation";
      args?: ValidatorJson;
      returns?: ValidatorJson | null;
      route?: FunctionRoutePolicy | null;
      partition?: FunctionPartitionMetadata | null;
      handler: (ctx: BackendMutationCtx, args: Json) => Promise<Json> | Json;
    };

export type BackendFunctionRegistry = Record<string, BackendRegisteredFunction>;

export async function executeInvoke(
  env: InvokeEnv,
  deploymentId: string,
  request: InvokeRequest,
  functions: BackendFunctionRegistry,
): Promise<InvokeResponse> {
  const activeDeployment = await loadActiveDeployment(env, deploymentId);
  const { fn, metadata, schema } = await Effect.runPromise(
    resolveInvokeFunctionForRequest(activeDeployment, request, functions).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
  const scope = resolveFunctionExecutionScope(
    metadata?.partition ?? fn.partition ?? null,
    metadata?.route ?? fn.route ?? null,
    request,
    schema,
  );
  await SingleShardTransaction.ensureSchema(env, deploymentId, scope.partitionKey, schema);
  const tx = await SingleShardTransaction.begin(
    env,
    deploymentId,
    scope.partitionKey,
    scope.kind === "partitionCreateRoot"
      ? {
          createRoot: {
            rootTableId: tableForName(schema, scope.table).tableId,
            preallocatedRootId: scope.preallocatedRootId,
          },
        }
      : {},
  );
  const value =
    fn.kind === "query"
      ? await fn.handler({ db: readerFor(tx, schema) }, request.args)
      : await fn.handler({ db: writerFor(tx, schema) }, request.args);
  await Effect.runPromise(
    validateReturnEffect(metadata?.returns ?? fn.returns, value, schema).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );

  if (fn.kind === "query") {
    return { value, readSet: tx.currentReadSet(), readTs: tx.beginTs };
  }

  const commit = await commitMutation(tx, request);
  return {
    value,
    committedTs: commit.committedTs,
    writes: commit.writes,
  };
}

type ResolvedInvokeFunction = {
  readonly fn: BackendRegisteredFunction;
  readonly metadata: DeploymentFunctionMetadata | undefined;
  readonly schema: DeploymentSchema;
};

export const resolveInvokeFunctionForRequest = Effect.fn(
  "Invoke.resolveFunctionForRequest",
)(function* (
  activeDeployment: ActiveDeploymentStatus,
  request: InvokeRequest,
  functions: BackendFunctionRegistry,
): Effect.fn.Return<ResolvedInvokeFunction, InvokeFunctionValidationError> {
  const activeFunctions = activeDeployment.analysis.functions.functions;
  const activeMetadata = activeFunctions.find(
    candidate => candidate.path === request.path,
  );
  if (activeFunctions.length > 0 && activeMetadata === undefined) {
    return yield* Effect.fail(new InvokeActiveFunctionMetadataNotFoundError({ path: request.path }));
  }

  const fn = functions[request.path];
  if (!fn) {
    return yield* Effect.fail(new InvokeFunctionNotFoundError({ path: request.path }));
  }
  const metadata = activeMetadata;
  const declaredKind = metadata?.kind ?? fn.kind;
  if (!isInvokableKind(declaredKind)) {
    return yield* Effect.fail(new InvokeUnsupportedFunctionKindError({
      path: request.path,
      kind: declaredKind,
    }));
  }
  if (declaredKind !== fn.kind) {
    return yield* Effect.fail(new InvokeFunctionKindMismatchError({
      path: request.path,
      metadataKind: declaredKind,
      handlerKind: fn.kind,
    }));
  }

  if (request.kind !== undefined && request.kind !== declaredKind) {
    return yield* Effect.fail(new InvokeRequestKindMismatchError({
      requestKind: request.kind,
      functionKind: declaredKind,
    }));
  }
  const schema = activeDeployment.analysis.schema;
  yield* validateInvokeArgumentsEffect(metadata?.args ?? fn.args, request.args, schema);
  return { fn, metadata, schema };
});

export const validateInvokeArgumentsEffect = Effect.fn(
  "Invoke.validateArguments",
)(function* (
  validator: ValidatorJson | null | undefined,
  value: Json,
  schema: DeploymentSchema,
): Effect.fn.Return<void, InvokeArgumentValidationError> {
  if (validator === undefined || validator === null) return;
  return yield* Effect.suspend(() => {
    try {
      validateJsonValue(validator, value, "$args", { validateId: idValidatorForSchema(schema) });
      return Effect.void;
    } catch (error) {
      if (error instanceof BackendValidationError) {
        return Effect.fail(new InvokeArgumentValidationError({ message: error.message }));
      }
      return Effect.die(error);
    }
  });
});

export function resolveFunctionExecutionScope(
  partition: FunctionPartitionMetadata | null | undefined,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<InvokeRequest, "path" | "args"> & { partitionKey?: string },
  schema: DeploymentSchema,
  options: {
    allocateRootId?: (table: SchemaTable) => string;
  } = {},
): FunctionExecutionScope {
  if (partition === undefined || partition === null) {
    throw new HttpError(
      400,
      `PartitionValidationError: function ${request.path} must declare partition metadata.`,
    );
  }
  if (partition.type === "partitionCreateRoot") {
    return resolveCreateRootExecutionScope(partition, route, request, schema, options);
  }
  validatePartitionPolicyAgainstSchema(partition, request.path, schema);
  if (
    route !== null &&
    route !== undefined &&
    route.type === "args" &&
    route.field !== partition.argField
  ) {
    throw new HttpError(
      400,
      `PartitionValidationError: ${request.path} partition argument ${partition.argField} must match route argument ${route.field}.`,
    );
  }
  const partitionKey = partitionKeyFromArgs(
    request,
    partition.argField,
    `partition ${partition.table}.${partition.selector}`,
  );
  if (request.partitionKey !== partitionKey) {
    throw new HttpError(
      400,
      `PartitionValidationError: partitionKey must match args.${partition.argField} for ${request.path}.`,
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
  partition: Extract<FunctionPartitionMetadata, { type: "partitionCreateRoot" }>,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<InvokeRequest, "path" | "args"> & { partitionKey?: string },
  schema: DeploymentSchema,
  options: {
    allocateRootId?: (table: SchemaTable) => string;
  },
): FunctionExecutionScope {
  if (route !== null && route !== undefined) {
    throw new HttpError(
      400,
      `PartitionValidationError: create-root partition for ${request.path} cannot declare route metadata.`,
    );
  }
  const table = tableForName(schema, partition.table);
  if (table.placement.kind !== "partitionBy") {
    throw new HttpError(
      400,
      `PartitionValidationError: ${request.path} create-root partition table ${partition.table} is not partitioned.`,
    );
  }
  if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
    throw new HttpError(
      400,
      `PartitionValidationError: ${request.path} create-root partition requires ${partition.table} to be partitioned by _id.`,
    );
  }
  const preallocatedRootId = options.allocateRootId?.(table) ?? encodeFlarexId(table.tableId);
  if (!isFlarexIdForTable(preallocatedRootId, table.tableId)) {
    throw new HttpError(
      500,
      `PartitionValidationError: preallocated root id for ${request.path} must be an ID for table ${partition.table}.`,
    );
  }
  if (request.partitionKey !== undefined && request.partitionKey !== preallocatedRootId) {
    throw new HttpError(
      400,
      `PartitionValidationError: partitionKey cannot be supplied for create-root ${request.path}; backend preallocated ${preallocatedRootId}.`,
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
  schema: DeploymentSchema,
): void {
  const table = tableForName(schema, partition.table);
  if (table.placement.kind !== "partitionBy") {
    throw new HttpError(
      400,
      `PartitionValidationError: ${path} partition table ${partition.table} is not partitioned.`,
    );
  }
  if (table.placement.field !== partition.partitionField) {
    throw new HttpError(
      400,
      `PartitionValidationError: ${path} partition selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
    );
  }
  const expectedSelector = selectorNameForPartitionField(table.placement.field);
  if (partition.selector !== expectedSelector) {
    throw new HttpError(
      400,
      `PartitionValidationError: ${path} expected partition selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
    );
  }
}

function partitionKeyFromArgs(
  request: Pick<InvokeRequest, "path" | "args">,
  field: string,
  label: string,
): string {
  if (typeof request.args !== "object" || request.args === null || Array.isArray(request.args)) {
    throw new HttpError(
      400,
      `PartitionValidationError: ${request.path} ${label} requires object arguments.`,
    );
  }
  const value = request.args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(
      400,
      `PartitionValidationError: ${request.path} ${label} requires a non-empty string argument.`,
    );
  }
  return value;
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

export function invokeErrorResponse(error: unknown): Response {
  if (error instanceof PartitionRequestError) {
    return Response.json(error.body, { status: error.status });
  }
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}

export function readerFor(tx: SingleShardTransaction, schema: DeploymentSchema): BackendDatabaseReader {
  return {
    get: async id => {
      const metadata = tableFromDocumentId(id, schema);
      const document = await tx.get(metadata.tableId, id);
      if (document !== null) validateDocumentPlacement(metadata, document.value, tx.partitionKey);
      return document === null ? null : documentValue(document.id, document.value);
    },
    query: table => backendQuery(tx, schema, table),
    queryIndex: async options => {
      const documents = await tx.queryIndex(options);
      return documents.map(document => documentValue(document.id, document.value));
    },
  };
}

function backendQuery(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  table: string,
  index?: string,
  range?: BackendIndexRange,
  limit?: number,
  cursor?: string,
  order: "asc" | "desc" = "asc",
): BackendQueryInitializer {
  const execute = async (
    queryLimit?: number,
    queryCursor?: string,
  ): Promise<{ page: Json[]; isDone: boolean; continueCursor: string }> => {
    if (index === undefined) {
      throw new HttpError(400, "Flarex table scans are not implemented. Use withIndex().");
    }
    const tableMetadata = tableForName(schema, table);
    const tableId = tableMetadata.tableId;
    const metadata = schema.indexes.find(
      candidate =>
        candidate.tableId === tableId &&
        candidate.name === index &&
        (candidate.state === undefined || candidate.state === "enabled"),
    );
    if (!metadata) throw new HttpError(400, `Unknown index ${table}.${index}.`);

    const expressions = range?.expressions ?? [];
    validateQueryPlacement(tableMetadata, expressions, tx.partitionKey);
    let bounds: { lower?: string; upper?: string };
    try {
      bounds = indexBoundsForExpressions(metadata.fields, expressions);
    } catch (error) {
      throw new HttpError(
        400,
        `Invalid range for index ${table}.${index}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const resolvedLimit = queryLimit ?? limit;
    const resolvedCursor = queryCursor ?? cursor;
    const result = await tx.queryIndexPage({
      indexId: metadata.indexId,
      ...bounds,
      ...(resolvedLimit === undefined ? {} : { limit: resolvedLimit }),
      ...(resolvedCursor === undefined ? {} : { cursor: resolvedCursor }),
      order,
    });
    const documents = result.documents.map(document => {
      validateDocumentPlacement(tableMetadata, document.value, tx.partitionKey);
      return documentValue(document.id, document.value);
    });
    return {
      page: documents,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  };
  const query: BackendQueryInitializer = {
    withIndex: (nextIndex, buildRange) => {
      const builder = backendRangeBuilder();
      return backendQuery(tx, schema, table, nextIndex, buildRange?.(builder), limit, cursor, order);
    },
    order: nextOrder => backendQuery(tx, schema, table, index, range, limit, cursor, nextOrder),
    collect: async () => (await execute()).page,
    take: async count => (await execute(count)).page,
    first: async () => (await execute(1)).page[0] ?? null,
    unique: async () => {
      const documents = (await execute(2)).page;
      if (documents.length > 1) throw new HttpError(400, "Query returned more than one document.");
      return documents[0] ?? null;
    },
    paginate: options =>
      execute(options.numItems, options.cursor === null ? undefined : options.cursor),
  };
  return query;
}

function backendRangeBuilder(
  expressions: BackendIndexRange["expressions"] = [],
): BackendIndexRangeBuilder {
  return {
    expressions,
    eq: (field, value) => backendRangeBuilder([...expressions, { op: "eq", field, value }]),
    gt: (field, value) => backendRangeBuilder([...expressions, { op: "gt", field, value }]),
    gte: (field, value) => backendRangeBuilder([...expressions, { op: "gte", field, value }]),
    lt: (field, value) => backendRangeBuilder([...expressions, { op: "lt", field, value }]),
    lte: (field, value) => backendRangeBuilder([...expressions, { op: "lte", field, value }]),
  };
}

function validateQueryPlacement(
  table: SchemaTable,
  expressions: IndexRangeExpression[],
  partitionKey: string,
): void {
  const placementField = ownerFieldForPlacement(table);
  if (placementField === null) return;
  const equality = expressions.find(
    expression => expression.field === placementField && expression.op === "eq",
  );
  if (equality === undefined) {
    throw new HttpError(
      400,
      `PlacementValidationError: query on ${table.name} must include q.eq("${placementField}", partitionKey).`,
    );
  }
  if (equality.value !== partitionKey) {
    throw new HttpError(
      400,
      `PlacementValidationError: query on ${table.name} must constrain ${placementField} to partitionKey ${partitionKey}.`,
    );
  }
}

export function writerFor(tx: SingleShardTransaction, schema: DeploymentSchema): BackendDatabaseWriter {
  return {
    ...readerFor(tx, schema),
    insert: async (table, value, id) => {
      const metadata = tableForName(schema, table);
      validateDocument(metadata, value, schema);
      validateDocumentPlacement(metadata, value, tx.partitionKey);
      const tableId = metadata.tableId;
      if (id !== undefined) validateDocumentIdTable(id, tableId);
      return tx.insert(tableId, value, id);
    },
    replace: async (id, value) => {
      const metadata = tableFromDocumentId(id, schema);
      validateDocument(metadata, value, schema);
      validateDocumentPlacement(metadata, value, tx.partitionKey);
      tx.replace(metadata.tableId, id, value);
    },
    patch: async (id, value) => {
      const metadata = tableFromDocumentId(id, schema);
      const current = await tx.get(metadata.tableId, id);
      if (current === null) throw new HttpError(404, `Document not found: ${id}`);
      const next = { ...(current.value as Record<string, Json>), ...value };
      validateDocument(metadata, next, schema);
      validateDocumentPlacement(metadata, next, tx.partitionKey);
      await tx.patch(metadata.tableId, id, value);
    },
    delete: async id => {
      const metadata = tableFromDocumentId(id, schema);
      const current = await tx.get(metadata.tableId, id);
      if (current !== null) validateDocumentPlacement(metadata, current.value, tx.partitionKey);
      tx.delete(metadata.tableId, id);
    },
  };
}

function commitMutation(
  tx: SingleShardTransaction,
  request: InvokeRequest,
): Promise<CommitResponse> {
  return tx.commit({
    source: `invoke:${request.path}`,
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
  });
}

export async function loadActiveDeployment(
  env: InvokeEnv,
  deploymentId: string,
): Promise<ActiveDeploymentStatus> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  const response = await deployment.fetch(`https://flarex.internal${DeploymentRoute.activeDeployment}`);
  if (!response.ok) {
    throw new HttpError(response.status, `Failed to load active deployment ${deploymentId}.`);
  }
  return response.json() as Promise<ActiveDeploymentStatus>;
}

export async function loadActiveFunctionMetadata(
  env: InvokeEnv,
  deploymentId: string,
  path: string,
): Promise<{ deployment: ActiveDeploymentStatus; metadata: DeploymentFunctionMetadata }> {
  const deployment = await loadActiveDeployment(env, deploymentId);
  const metadata = deployment.analysis.functions.functions.find(candidate => candidate.path === path);
  if (metadata === undefined) {
    throw new HttpError(404, `Unknown active Flarex function metadata: ${path}`);
  }
  return { deployment, metadata };
}

export function isInvokableKind(kind: DeploymentFunctionKind): kind is BackendFunctionKind {
  return kind === "query" || kind === "mutation";
}

function tableIdForName(schema: DeploymentSchema, table: string): number {
  return tableForName(schema, table).tableId;
}

export function tableForName(schema: DeploymentSchema, table: string): SchemaTable {
  const metadata = schema.tables.find(candidate => candidate.name === table);
  if (!metadata || metadata.state === "deleted") {
    throw new HttpError(400, `Unknown table: ${table}.`);
  }
  return metadata;
}

function tableIdFromDocumentId(id: string, schema: DeploymentSchema): number {
  return tableFromDocumentId(id, schema).tableId;
}

function tableFromDocumentId(id: string, schema: DeploymentSchema): SchemaTable {
  const parsed = parseFlarexId(id);
  if (parsed === null) {
    throw new HttpError(400, `Document id ${id} does not contain a numeric table id prefix.`);
  }
  const metadata = schema.tables.find(table => table.tableId === parsed.tableId && table.state !== "deleted");
  if (!metadata) {
    throw new HttpError(400, `Document id ${id} references unknown table id ${parsed.tableId}.`);
  }
  return metadata;
}

function validateDocumentIdTable(id: string, expectedTableId: number): void {
  if (!isFlarexIdForTable(id, expectedTableId)) {
    throw new HttpError(400, `Document id ${id} does not belong to table id ${expectedTableId}.`);
  }
}

function documentValue(id: string, value: Json): Json {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value, _id: id };
  }
  return value;
}

function validateDocument(table: SchemaTable, value: Json, schema?: DeploymentSchema): void {
  if (table.validator === undefined || table.validator === null) return;
  try {
    const options = schema === undefined ? {} : { validateId: idValidatorForSchema(schema) };
    validateJsonValue(table.validator, value, `$document(${table.name})`, options);
  } catch (error) {
    if (error instanceof BackendValidationError) {
      throw new HttpError(400, `DocumentValidationError: ${error.message}`);
    }
    throw error;
  }
}

function validateDocumentPlacement(
  table: SchemaTable,
  value: Json,
  partitionKey: string,
): void {
  const placementField = ownerFieldForPlacement(table);
  if (placementField === null) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(
      400,
      `PlacementValidationError: $document(${table.name}) must be an object for placement validation.`,
    );
  }
  const placementValue = value[placementField];
  if (typeof placementValue !== "string" || placementValue.length === 0) {
    throw new HttpError(
      400,
      `PlacementValidationError: $document(${table.name}).${placementField} must be a non-empty string matching partitionKey.`,
    );
  }
  if (placementValue !== partitionKey) {
    throw new HttpError(
      400,
      `PlacementValidationError: $document(${table.name}).${placementField} must match partitionKey ${partitionKey}.`,
    );
  }
}

function ownerFieldForPlacement(table: SchemaTable): string | null {
  if (table.placement.kind === "colocateWith") return table.placement.field;
  if (table.placement.kind === "partitionBy" && table.placement.field !== "_id") {
    return table.placement.field;
  }
  return null;
}

export function validateReturn(
  validator: ValidatorJson | null | undefined,
  value: Json,
  schema: DeploymentSchema,
): void {
  Effect.runSync(
    validateReturnEffect(validator, value, schema).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validateReturnEffect = Effect.fn("Invoke.validateReturn")(function* (
  validator: ValidatorJson | null | undefined,
  value: Json,
  schema: DeploymentSchema,
): Effect.fn.Return<void, InvokeReturnValidationError> {
  if (validator === undefined || validator === null) return;
  return yield* Effect.suspend(() => {
    try {
      validateJsonValue(validator, value, "$return", { validateId: idValidatorForSchema(schema) });
      return Effect.void;
    } catch (error) {
      if (error instanceof BackendValidationError) {
        return Effect.fail(new InvokeReturnValidationError({ message: error.message }));
      }
      return Effect.die(error);
    }
  });
});

export function invokeValidationErrorToHttpError(error: InvokeValidationError): HttpError {
  if (error instanceof InvokeActiveFunctionMetadataNotFoundError) {
    return new HttpError(404, `Unknown active Flarex function metadata: ${error.path}`);
  }
  if (error instanceof InvokeFunctionNotFoundError) {
    return new HttpError(404, `Unknown Flarex function: ${error.path}`);
  }
  if (error instanceof InvokeUnsupportedFunctionKindError) {
    return new HttpError(400, `${error.kind} execution is not implemented by /invoke.`);
  }
  if (error instanceof InvokeFunctionKindMismatchError) {
    return new HttpError(
      500,
      `Function metadata kind mismatch for ${error.path}. Metadata has ${error.metadataKind}, handler is ${error.handlerKind}.`,
    );
  }
  if (error instanceof InvokeRequestKindMismatchError) {
    return new HttpError(
      400,
      `Function kind mismatch. Request has ${error.requestKind}, function is ${error.functionKind}.`,
    );
  }
  if (error instanceof InvokeArgumentValidationError) {
    return new HttpError(400, `ArgumentValidationError: ${error.message}`);
  }
  return new HttpError(400, `ReturnValidationError: ${error.message}`);
}

export function idValidatorForSchema(schema: DeploymentSchema) {
  return (expectedTableName: string, id: string, path: string): void => {
    const parsed = parseFlarexId(id);
    if (parsed === null) {
      throw new BackendValidationError(
        `Expected an ID for table ${expectedTableName}.`,
        path,
      );
    }
    const table = schema.tables.find(candidate => candidate.tableId === parsed.tableId);
    if (!table || table.state === "deleted") {
      throw new BackendValidationError(
        `ID references unknown table id ${parsed.tableId}; expected table ${expectedTableName}.`,
        path,
      );
    }
    if (table.name !== expectedTableName) {
      throw new BackendValidationError(
        `Expected an ID for table ${expectedTableName}, got an ID for table ${table.name}.`,
        path,
      );
    }
  };
}

export function parseInvokeKind(value: unknown): BackendFunctionKind | undefined {
  if (value === undefined) return undefined;
  if (value === "query" || value === "mutation") return value;
  throw new HttpError(400, "Invoke kind must be query or mutation.");
}
