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
  ExecutionSyscallRequest,
  FunctionExecutionScope,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  InvokeRequest,
  InvokeResponse,
  Json,
  SchemaIndex,
  SchemaTable,
  ValidatorJson,
} from "./types";
import { BackendValidationError, validateJsonValueEffect } from "./validation";

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

export class InvokeTableNotFoundError
  extends Data.TaggedError("InvokeTableNotFoundError")<{
    readonly table: string;
  }> {}

export class InvokeDocumentIdParseError
  extends Data.TaggedError("InvokeDocumentIdParseError")<{
    readonly id: string;
  }> {}

export class InvokeDocumentTableNotFoundError
  extends Data.TaggedError("InvokeDocumentTableNotFoundError")<{
    readonly id: string;
    readonly tableId: number;
  }> {}

export class InvokeDocumentIdTableMismatchError
  extends Data.TaggedError("InvokeDocumentIdTableMismatchError")<{
    readonly id: string;
    readonly expectedTableId: number;
  }> {}

export class InvokeDocumentValidationError
  extends Data.TaggedError("InvokeDocumentValidationError")<{
    readonly message: string;
  }> {}

export class InvokeDocumentPlacementError
  extends Data.TaggedError("InvokeDocumentPlacementError")<{
    readonly message: string;
  }> {}

export class InvokeDocumentNotFoundError
  extends Data.TaggedError("InvokeDocumentNotFoundError")<{
    readonly id: string;
  }> {}

export class InvokePartitionValidationError
  extends Data.TaggedError("InvokePartitionValidationError")<{
    readonly message: string;
    readonly status: 400 | 500;
  }> {}

export class InvokeQueryPlanningError
  extends Data.TaggedError("InvokeQueryPlanningError")<{
    readonly message: string;
  }> {}

export class InvokeActiveDeploymentLoadError
  extends Data.TaggedError("InvokeActiveDeploymentLoadError")<{
    readonly deploymentId: string;
    readonly status: number;
    readonly message: string;
    readonly cause: unknown;
  }> {}

export class InvokeKindValidationError
  extends Data.TaggedError("InvokeKindValidationError")<{
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

export type InvokeDocumentValidationFailure =
  | InvokeDocumentIdParseError
  | InvokeDocumentIdTableMismatchError
  | InvokeDocumentNotFoundError
  | InvokeDocumentPlacementError
  | InvokeDocumentTableNotFoundError
  | InvokeDocumentValidationError
  | InvokeTableNotFoundError;

export type InvokePartitionValidationFailure =
  | InvokePartitionValidationError
  | InvokeTableNotFoundError;

export type InvokeQueryPlanningFailure = InvokeQueryPlanningError;

export type InvokeValidationError =
  | InvokeFunctionValidationError
  | InvokeDocumentValidationFailure
  | InvokePartitionValidationFailure
  | InvokeQueryPlanningFailure
  | InvokeReturnValidationFailure
  | InvokeKindValidationError;

export type InvokeRuntimeError =
  | InvokeActiveDeploymentLoadError
  | InvokeActiveFunctionMetadataNotFoundError;

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
  return yield* validateJsonValueEffect(
    validator,
    value,
    "$args",
    { validateId: idValidatorForSchema(schema) },
  ).pipe(
    Effect.mapError(error => new InvokeArgumentValidationError({ message: error.message })),
  );
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
  return Effect.runSync(
    resolveFunctionExecutionScopeEffect(partition, route, request, schema, options).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const resolveFunctionExecutionScopeEffect = Effect.fn(
  "Invoke.resolveFunctionExecutionScope",
)(function* (
  partition: FunctionPartitionMetadata | null | undefined,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<InvokeRequest, "path" | "args"> & { partitionKey?: string },
  schema: DeploymentSchema,
  options: {
    allocateRootId?: (table: SchemaTable) => string;
  } = {},
): Effect.fn.Return<FunctionExecutionScope, InvokePartitionValidationFailure> {
  if (partition === undefined || partition === null) {
    return yield* partitionValidationFailure(
      `function ${request.path} must declare partition metadata.`,
    );
  }
  if (partition.type === "partitionCreateRoot") {
    return yield* resolveCreateRootExecutionScopeEffect(partition, route, request, schema, options);
  }
  yield* validatePartitionPolicyAgainstSchemaEffect(partition, request.path, schema);
  if (
    route !== null &&
    route !== undefined &&
    route.type === "args" &&
    route.field !== partition.argField
  ) {
    return yield* partitionValidationFailure(
      `${request.path} partition argument ${partition.argField} must match route argument ${route.field}.`,
    );
  }
  const partitionKey = yield* partitionKeyFromArgsEffect(
    request,
    partition.argField,
    `partition ${partition.table}.${partition.selector}`,
  );
  if (request.partitionKey !== partitionKey) {
    return yield* partitionValidationFailure(
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
});

function resolveCreateRootExecutionScope(
  partition: Extract<FunctionPartitionMetadata, { type: "partitionCreateRoot" }>,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<InvokeRequest, "path" | "args"> & { partitionKey?: string },
  schema: DeploymentSchema,
  options: {
    allocateRootId?: (table: SchemaTable) => string;
  },
): FunctionExecutionScope {
  return Effect.runSync(
    resolveCreateRootExecutionScopeEffect(partition, route, request, schema, options).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

const resolveCreateRootExecutionScopeEffect = Effect.fn(
  "Invoke.resolveCreateRootExecutionScope",
)(function* (
  partition: Extract<FunctionPartitionMetadata, { type: "partitionCreateRoot" }>,
  route: FunctionRoutePolicy | null | undefined,
  request: Pick<InvokeRequest, "path" | "args"> & { partitionKey?: string },
  schema: DeploymentSchema,
  options: {
    allocateRootId?: (table: SchemaTable) => string;
  },
): Effect.fn.Return<FunctionExecutionScope, InvokePartitionValidationFailure> {
  if (route !== null && route !== undefined) {
    return yield* partitionValidationFailure(
      `create-root partition for ${request.path} cannot declare route metadata.`,
    );
  }
  const table = yield* tableForNameEffect(schema, partition.table);
  if (table.placement.kind !== "partitionBy") {
    return yield* partitionValidationFailure(
      `${request.path} create-root partition table ${partition.table} is not partitioned.`,
    );
  }
  if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
    return yield* partitionValidationFailure(
      `${request.path} create-root partition requires ${partition.table} to be partitioned by _id.`,
    );
  }
  const preallocatedRootId = options.allocateRootId?.(table) ?? encodeFlarexId(table.tableId);
  if (!isFlarexIdForTable(preallocatedRootId, table.tableId)) {
    return yield* partitionValidationFailure(
      `preallocated root id for ${request.path} must be an ID for table ${partition.table}.`,
      500,
    );
  }
  if (request.partitionKey !== undefined && request.partitionKey !== preallocatedRootId) {
    return yield* partitionValidationFailure(
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
});

function validatePartitionPolicyAgainstSchema(
  partition: FunctionPartitionPolicy,
  path: string,
  schema: DeploymentSchema,
): void {
  Effect.runSync(
    validatePartitionPolicyAgainstSchemaEffect(partition, path, schema).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validatePartitionPolicyAgainstSchemaEffect = Effect.fn(
  "Invoke.validatePartitionPolicyAgainstSchema",
)(function* (
  partition: FunctionPartitionPolicy,
  path: string,
  schema: DeploymentSchema,
): Effect.fn.Return<void, InvokePartitionValidationFailure> {
  const table = yield* tableForNameEffect(schema, partition.table);
  if (table.placement.kind !== "partitionBy") {
    return yield* partitionValidationFailure(
      `${path} partition table ${partition.table} is not partitioned.`,
    );
  }
  if (table.placement.field !== partition.partitionField) {
    return yield* partitionValidationFailure(
      `${path} partition selector ${partition.selector} targets ${partition.partitionField}, but ${partition.table} is partitioned by ${table.placement.field}.`,
    );
  }
  const expectedSelector = selectorNameForPartitionField(table.placement.field);
  if (partition.selector !== expectedSelector) {
    return yield* partitionValidationFailure(
      `${path} expected partition selector ${expectedSelector} for ${partition.table} partition field ${JSON.stringify(table.placement.field)}.`,
    );
  }
});

function partitionKeyFromArgs(
  request: Pick<InvokeRequest, "path" | "args">,
  field: string,
  label: string,
): string {
  return Effect.runSync(
    partitionKeyFromArgsEffect(request, field, label).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const partitionKeyFromArgsEffect = Effect.fn("Invoke.partitionKeyFromArgs")(function* (
  request: Pick<InvokeRequest, "path" | "args">,
  field: string,
  label: string,
): Effect.fn.Return<string, InvokePartitionValidationError> {
  if (typeof request.args !== "object" || request.args === null || Array.isArray(request.args)) {
    return yield* partitionValidationFailure(
      `${request.path} ${label} requires object arguments.`,
    );
  }
  const value = request.args[field];
  if (typeof value !== "string" || value.length === 0) {
    return yield* partitionValidationFailure(
      `${request.path} ${label} requires a non-empty string argument.`,
    );
  }
  return value;
});

function partitionValidationFailure(
  message: string,
  status: 400 | 500 = 400,
): Effect.Effect<never, InvokePartitionValidationError> {
  return Effect.fail(new InvokePartitionValidationError({ message, status }));
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

type InvokeTransactionRunner<E> = <A>(
  execute: () => Promise<A>,
) => Effect.Effect<A, E>;

type ExecutionQueryRequest = Extract<ExecutionSyscallRequest, { op: "query" }>["request"];

export const getDocumentEffect = Effect.fn("Invoke.getDocument")(function* <E>(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  id: string,
  runTransaction: InvokeTransactionRunner<E>,
): Effect.fn.Return<
  Json | null,
  InvokeDocumentIdParseError | InvokeDocumentTableNotFoundError | InvokeDocumentPlacementError | E
> {
  const metadata = yield* tableFromDocumentIdEffect(id, schema);
  const document = yield* runTransaction(() => tx.get(metadata.tableId, id));
  if (document !== null) {
    yield* validateDocumentPlacementEffect(metadata, document.value, tx.partitionKey);
  }
  return document === null ? null : documentValue(document.id, document.value);
});

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
    const resolvedIndex = requireQueryIndex(index);
    const tableMetadata = tableForName(schema, table);
    const tableId = tableMetadata.tableId;
    const metadata = findQueryIndex(schema, tableMetadata, resolvedIndex);

    const expressions = range?.expressions ?? [];
    validateQueryPlacement(tableMetadata, expressions, tx.partitionKey);
    const bounds = queryIndexBounds(table, resolvedIndex, metadata, expressions);
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
      validateUniqueQueryResult(documents);
      return documents[0] ?? null;
    },
    paginate: options =>
      execute(options.numItems, options.cursor === null ? undefined : options.cursor),
  };
  return query;
}

export const queryDocumentsEffect = Effect.fn("Invoke.queryDocuments")(function* <E>(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  request: ExecutionQueryRequest,
  runTransaction: InvokeTransactionRunner<E>,
): Effect.fn.Return<
  { page: Json[]; isDone: boolean; continueCursor: string },
  InvokeTableNotFoundError | InvokeQueryPlanningError | InvokeDocumentPlacementError | E
> {
  const index = yield* requireQueryIndexEffect(request.index);
  const table = yield* tableForNameEffect(schema, request.table);
  const metadata = yield* findQueryIndexEffect(schema, table, index);
  const expressions = request.range?.expressions ?? [];
  yield* validateQueryPlacementEffect(table, expressions, tx.partitionKey);
  const bounds = yield* queryIndexBoundsEffect(request.table, index, metadata, expressions);
  const result = yield* runTransaction(() =>
    tx.queryIndexPage({
      indexId: metadata.indexId,
      ...bounds,
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.order === undefined ? {} : { order: request.order }),
    })
  );
  const page: Json[] = [];
  for (const document of result.documents) {
    yield* validateDocumentPlacementEffect(table, document.value, tx.partitionKey);
    page.push(documentValue(document.id, document.value));
  }
  if (request.cursor !== undefined || request.limit !== undefined) {
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  }
  return {
    page,
    isDone: true,
    continueCursor: String(
      typeof page.at(-1) === "object" && page.at(-1) !== null
        ? (page.at(-1) as { _id?: unknown })._id ?? ""
        : "",
    ),
  };
});

function requireQueryIndex(index: string | undefined): string {
  return Effect.runSync(
    requireQueryIndexEffect(index).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const requireQueryIndexEffect = Effect.fn("Invoke.requireQueryIndex")(function* (
  index: string | undefined,
): Effect.fn.Return<string, InvokeQueryPlanningError> {
  if (index === undefined) {
    return yield* queryPlanningFailure("Flarex table scans are not implemented. Use withIndex().");
  }
  return index;
});

function findQueryIndex(
  schema: DeploymentSchema,
  table: SchemaTable,
  index: string,
): SchemaIndex {
  return Effect.runSync(
    findQueryIndexEffect(schema, table, index).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const findQueryIndexEffect = Effect.fn("Invoke.findQueryIndex")(function* (
  schema: DeploymentSchema,
  table: SchemaTable,
  index: string,
): Effect.fn.Return<SchemaIndex, InvokeQueryPlanningError> {
  const metadata = schema.indexes.find(
    candidate =>
      candidate.tableId === table.tableId &&
      candidate.name === index &&
      (candidate.state === undefined || candidate.state === "enabled"),
  );
  if (!metadata) {
    return yield* queryPlanningFailure(`Unknown index ${table.name}.${index}.`);
  }
  return metadata;
});

function queryIndexBounds(
  table: string,
  index: string,
  metadata: SchemaIndex,
  expressions: IndexRangeExpression[],
): { lower?: string; upper?: string } {
  return Effect.runSync(
    queryIndexBoundsEffect(table, index, metadata, expressions).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const queryIndexBoundsEffect = Effect.fn("Invoke.queryIndexBounds")(function* (
  table: string,
  index: string,
  metadata: Pick<SchemaIndex, "fields">,
  expressions: IndexRangeExpression[],
): Effect.fn.Return<{ lower?: string; upper?: string }, InvokeQueryPlanningError> {
  return yield* Effect.suspend(() => {
    try {
      return Effect.succeed(indexBoundsForExpressions(metadata.fields, expressions));
    } catch (error) {
      return queryPlanningFailure(
        `Invalid range for index ${table}.${index}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
});

function validateUniqueQueryResult(documents: Json[]): void {
  Effect.runSync(
    validateUniqueQueryResultEffect(documents).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validateUniqueQueryResultEffect = Effect.fn(
  "Invoke.validateUniqueQueryResult",
)(function* (
  documents: readonly Json[],
): Effect.fn.Return<void, InvokeQueryPlanningError> {
  if (documents.length > 1) {
    return yield* queryPlanningFailure("Query returned more than one document.");
  }
});

function queryPlanningFailure(message: string): Effect.Effect<never, InvokeQueryPlanningError> {
  return Effect.fail(new InvokeQueryPlanningError({ message }));
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
  Effect.runSync(
    validateQueryPlacementEffect(table, expressions, partitionKey).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validateQueryPlacementEffect = Effect.fn(
  "Invoke.validateQueryPlacement",
)(function* (
  table: SchemaTable,
  expressions: IndexRangeExpression[],
  partitionKey: string,
): Effect.fn.Return<void, InvokeDocumentPlacementError> {
  const placementField = ownerFieldForPlacement(table);
  if (placementField === null) return;
  const equality = expressions.find(
    expression => expression.field === placementField && expression.op === "eq",
  );
  if (equality === undefined) {
    return yield* Effect.fail(new InvokeDocumentPlacementError({
      message: `query on ${table.name} must include q.eq("${placementField}", partitionKey).`,
    }));
  }
  if (equality.value !== partitionKey) {
    return yield* Effect.fail(new InvokeDocumentPlacementError({
      message: `query on ${table.name} must constrain ${placementField} to partitionKey ${partitionKey}.`,
    }));
  }
});

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
      if (current === null) {
        throw invokeValidationErrorToHttpError(new InvokeDocumentNotFoundError({ id }));
      }
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

export const insertDocumentEffect = Effect.fn("Invoke.insertDocument")(function* <E>(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  table: string,
  value: Json,
  id: string | undefined,
  runTransaction: InvokeTransactionRunner<E>,
): Effect.fn.Return<
  string,
  | InvokeTableNotFoundError
  | InvokeDocumentValidationError
  | InvokeDocumentPlacementError
  | InvokeDocumentIdTableMismatchError
  | E
> {
  const metadata = yield* tableForNameEffect(schema, table);
  yield* validateDocumentEffect(metadata, value, schema);
  yield* validateDocumentPlacementEffect(metadata, value, tx.partitionKey);
  if (id !== undefined) {
    yield* validateDocumentIdTableEffect(id, metadata.tableId);
  }
  return yield* runTransaction(async () => tx.insert(metadata.tableId, value, id));
});

export const replaceDocumentEffect = Effect.fn("Invoke.replaceDocument")(function* <E>(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  id: string,
  value: Json,
  runTransaction: InvokeTransactionRunner<E>,
): Effect.fn.Return<
  void,
  | InvokeDocumentIdParseError
  | InvokeDocumentTableNotFoundError
  | InvokeDocumentValidationError
  | InvokeDocumentPlacementError
  | E
> {
  const metadata = yield* tableFromDocumentIdEffect(id, schema);
  yield* validateDocumentEffect(metadata, value, schema);
  yield* validateDocumentPlacementEffect(metadata, value, tx.partitionKey);
  yield* runTransaction(async () => tx.replace(metadata.tableId, id, value));
});

export const patchDocumentEffect = Effect.fn("Invoke.patchDocument")(function* <E>(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  id: string,
  value: Record<string, Json>,
  runTransaction: InvokeTransactionRunner<E>,
): Effect.fn.Return<
  void,
  | InvokeDocumentIdParseError
  | InvokeDocumentTableNotFoundError
  | InvokeDocumentNotFoundError
  | InvokeDocumentValidationError
  | InvokeDocumentPlacementError
  | E
> {
  const metadata = yield* tableFromDocumentIdEffect(id, schema);
  const current = yield* runTransaction(() => tx.get(metadata.tableId, id));
  if (current === null) {
    return yield* Effect.fail(new InvokeDocumentNotFoundError({ id }));
  }
  const next = { ...(current.value as Record<string, Json>), ...value };
  yield* validateDocumentEffect(metadata, next, schema);
  yield* validateDocumentPlacementEffect(metadata, next, tx.partitionKey);
  yield* runTransaction(() => tx.patch(metadata.tableId, id, value));
});

export const deleteDocumentEffect = Effect.fn("Invoke.deleteDocument")(function* <E>(
  tx: SingleShardTransaction,
  schema: DeploymentSchema,
  id: string,
  runTransaction: InvokeTransactionRunner<E>,
): Effect.fn.Return<
  void,
  InvokeDocumentIdParseError | InvokeDocumentTableNotFoundError | InvokeDocumentPlacementError | E
> {
  const metadata = yield* tableFromDocumentIdEffect(id, schema);
  const current = yield* runTransaction(() => tx.get(metadata.tableId, id));
  if (current !== null) {
    yield* validateDocumentPlacementEffect(metadata, current.value, tx.partitionKey);
  }
  yield* runTransaction(async () => tx.delete(metadata.tableId, id));
});

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
  return await Effect.runPromise(
    loadActiveDeploymentEffect(env, deploymentId).pipe(
      Effect.mapError(invokeActiveDeploymentLoadErrorToHttpError),
    ),
  );
}

export const loadActiveDeploymentEffect = Effect.fn(
  "Invoke.loadActiveDeployment",
)(function* (
  env: InvokeEnv,
  deploymentId: string,
): Effect.fn.Return<ActiveDeploymentStatus, InvokeActiveDeploymentLoadError> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  const response = yield* Effect.tryPromise({
    try: () => deployment.fetch(`https://flarex.internal${DeploymentRoute.activeDeployment}`),
    catch: cause => activeDeploymentLoadError(deploymentId, 500, cause),
  });
  if (!response.ok) {
    return yield* Effect.fail(activeDeploymentLoadError(
      deploymentId,
      response.status,
      undefined,
    ));
  }
  return yield* Effect.tryPromise({
    try: () => response.json() as Promise<ActiveDeploymentStatus>,
    catch: cause => activeDeploymentLoadError(deploymentId, 500, cause),
  });
});

export async function loadActiveFunctionMetadata(
  env: InvokeEnv,
  deploymentId: string,
  path: string,
): Promise<{ deployment: ActiveDeploymentStatus; metadata: DeploymentFunctionMetadata }> {
  return await Effect.runPromise(
    loadActiveFunctionMetadataEffect(env, deploymentId, path).pipe(
      Effect.mapError(invokeRuntimeErrorToHttpError),
    ),
  );
}

export const loadActiveFunctionMetadataEffect = Effect.fn(
  "Invoke.loadActiveFunctionMetadata",
)(function* (
  env: InvokeEnv,
  deploymentId: string,
  path: string,
): Effect.fn.Return<
  { deployment: ActiveDeploymentStatus; metadata: DeploymentFunctionMetadata },
  InvokeRuntimeError
> {
  const deployment = yield* loadActiveDeploymentEffect(env, deploymentId);
  const metadata = deployment.analysis.functions.functions.find(candidate => candidate.path === path);
  if (metadata === undefined) {
    return yield* Effect.fail(new InvokeActiveFunctionMetadataNotFoundError({ path }));
  }
  return { deployment, metadata };
});

export function isInvokableKind(kind: DeploymentFunctionKind): kind is BackendFunctionKind {
  return kind === "query" || kind === "mutation";
}

function tableIdForName(schema: DeploymentSchema, table: string): number {
  return tableForName(schema, table).tableId;
}

export function tableForName(schema: DeploymentSchema, table: string): SchemaTable {
  return Effect.runSync(
    tableForNameEffect(schema, table).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const tableForNameEffect = Effect.fn("Invoke.tableForName")(function* (
  schema: DeploymentSchema,
  table: string,
): Effect.fn.Return<SchemaTable, InvokeTableNotFoundError> {
  const metadata = schema.tables.find(candidate => candidate.name === table);
  if (!metadata || metadata.state === "deleted") {
    return yield* Effect.fail(new InvokeTableNotFoundError({ table }));
  }
  return metadata;
});

function tableIdFromDocumentId(id: string, schema: DeploymentSchema): number {
  return tableFromDocumentId(id, schema).tableId;
}

function tableFromDocumentId(id: string, schema: DeploymentSchema): SchemaTable {
  return Effect.runSync(
    tableFromDocumentIdEffect(id, schema).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const tableFromDocumentIdEffect = Effect.fn("Invoke.tableFromDocumentId")(function* (
  id: string,
  schema: DeploymentSchema,
): Effect.fn.Return<
  SchemaTable,
  InvokeDocumentIdParseError | InvokeDocumentTableNotFoundError
> {
  const parsed = parseFlarexId(id);
  if (parsed === null) {
    return yield* Effect.fail(new InvokeDocumentIdParseError({ id }));
  }
  const metadata = schema.tables.find(table => table.tableId === parsed.tableId && table.state !== "deleted");
  if (!metadata) {
    return yield* Effect.fail(new InvokeDocumentTableNotFoundError({
      id,
      tableId: parsed.tableId,
    }));
  }
  return metadata;
});

function validateDocumentIdTable(id: string, expectedTableId: number): void {
  Effect.runSync(
    validateDocumentIdTableEffect(id, expectedTableId).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validateDocumentIdTableEffect = Effect.fn(
  "Invoke.validateDocumentIdTable",
)(function* (
  id: string,
  expectedTableId: number,
): Effect.fn.Return<void, InvokeDocumentIdTableMismatchError> {
  if (!isFlarexIdForTable(id, expectedTableId)) {
    return yield* Effect.fail(new InvokeDocumentIdTableMismatchError({ id, expectedTableId }));
  }
});

function documentValue(id: string, value: Json): Json {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...value, _id: id };
  }
  return value;
}

function validateDocument(table: SchemaTable, value: Json, schema?: DeploymentSchema): void {
  Effect.runSync(
    validateDocumentEffect(table, value, schema).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validateDocumentEffect = Effect.fn("Invoke.validateDocument")(function* (
  table: SchemaTable,
  value: Json,
  schema?: DeploymentSchema,
): Effect.fn.Return<void, InvokeDocumentValidationError> {
  if (table.validator === undefined || table.validator === null) return;
  const validator = table.validator;
  const options = schema === undefined ? {} : { validateId: idValidatorForSchema(schema) };
  return yield* validateJsonValueEffect(
    validator,
    value,
    `$document(${table.name})`,
    options,
  ).pipe(
    Effect.mapError(error => new InvokeDocumentValidationError({ message: error.message })),
  );
});

function validateDocumentPlacement(
  table: SchemaTable,
  value: Json,
  partitionKey: string,
): void {
  Effect.runSync(
    validateDocumentPlacementEffect(table, value, partitionKey).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const validateDocumentPlacementEffect = Effect.fn(
  "Invoke.validateDocumentPlacement",
)(function* (
  table: SchemaTable,
  value: Json,
  partitionKey: string,
): Effect.fn.Return<void, InvokeDocumentPlacementError> {
  const placementField = ownerFieldForPlacement(table);
  if (placementField === null) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return yield* Effect.fail(new InvokeDocumentPlacementError({
      message: `$document(${table.name}) must be an object for placement validation.`,
    }));
  }
  const placementValue = value[placementField];
  if (typeof placementValue !== "string" || placementValue.length === 0) {
    return yield* Effect.fail(new InvokeDocumentPlacementError({
      message: `$document(${table.name}).${placementField} must be a non-empty string matching partitionKey.`,
    }));
  }
  if (placementValue !== partitionKey) {
    return yield* Effect.fail(new InvokeDocumentPlacementError({
      message: `$document(${table.name}).${placementField} must match partitionKey ${partitionKey}.`,
    }));
  }
});

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
  return yield* validateJsonValueEffect(
    validator,
    value,
    "$return",
    { validateId: idValidatorForSchema(schema) },
  ).pipe(
    Effect.mapError(error => new InvokeReturnValidationError({ message: error.message })),
  );
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
  if (error instanceof InvokeTableNotFoundError) {
    return new HttpError(400, `Unknown table: ${error.table}.`);
  }
  if (error instanceof InvokeDocumentIdParseError) {
    return new HttpError(400, `Document id ${error.id} does not contain a numeric table id prefix.`);
  }
  if (error instanceof InvokeDocumentTableNotFoundError) {
    return new HttpError(400, `Document id ${error.id} references unknown table id ${error.tableId}.`);
  }
  if (error instanceof InvokeDocumentIdTableMismatchError) {
    return new HttpError(400, `Document id ${error.id} does not belong to table id ${error.expectedTableId}.`);
  }
  if (error instanceof InvokeDocumentValidationError) {
    return new HttpError(400, `DocumentValidationError: ${error.message}`);
  }
  if (error instanceof InvokeDocumentPlacementError) {
    return new HttpError(400, `PlacementValidationError: ${error.message}`);
  }
  if (error instanceof InvokeDocumentNotFoundError) {
    return new HttpError(404, `Document not found: ${error.id}`);
  }
  if (error instanceof InvokePartitionValidationError) {
    return new HttpError(error.status, `PartitionValidationError: ${error.message}`);
  }
  if (error instanceof InvokeQueryPlanningError) {
    return new HttpError(400, error.message);
  }
  if (error instanceof InvokeKindValidationError) {
    return new HttpError(400, error.message);
  }
  return new HttpError(400, `ReturnValidationError: ${error.message}`);
}

export function invokeActiveDeploymentLoadErrorToHttpError(
  error: InvokeActiveDeploymentLoadError,
): HttpError {
  return new HttpError(error.status, error.message);
}

export function invokeRuntimeErrorToHttpError(error: InvokeRuntimeError): HttpError {
  if (error instanceof InvokeActiveDeploymentLoadError) {
    return invokeActiveDeploymentLoadErrorToHttpError(error);
  }
  return invokeValidationErrorToHttpError(error);
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
  return Effect.runSync(
    parseInvokeKindEffect(value).pipe(
      Effect.mapError(invokeValidationErrorToHttpError),
    ),
  );
}

export const parseInvokeKindEffect = Effect.fn("Invoke.parseInvokeKind")(function* (
  value: unknown,
): Effect.fn.Return<BackendFunctionKind | undefined, InvokeKindValidationError> {
  if (value === undefined) return undefined;
  if (value === "query" || value === "mutation") return value;
  return yield* Effect.fail(new InvokeKindValidationError({
    message: "Invoke kind must be query or mutation.",
  }));
});

function activeDeploymentLoadError(
  deploymentId: string,
  status: number,
  cause: unknown,
): InvokeActiveDeploymentLoadError {
  return new InvokeActiveDeploymentLoadError({
    deploymentId,
    status,
    message: `Failed to load active deployment ${deploymentId}.`,
    cause,
  });
}
