import { Data, Effect, Schema } from "effect";
import {
  encodeFlarexId,
  isFlarexIdForTable,
  parseFlarexId,
} from "flarex/ids";
import {
  decodeActiveDeploymentStatusEffect,
  DeploymentRoute,
} from "flarex-protocol/deployment";
import { isWritableJsonObject } from "flarex-protocol/json";
import { selectorNameForPartitionField } from "flarex-protocol/partition-selector";
import { HttpError, readResponseJsonEffect } from "./http";
import {
  indexBoundsForExpressions,
  type IndexRangeExpression,
} from "./indexKeys";
import { deploymentObjectName } from "./routing";
import {
  PartitionRequestError,
  PartitionFetchError,
  PartitionResponseError,
  SingleShardTransaction,
  TransactionInvariantError,
  type TransactionOperationError,
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

export type InvokeExecutionOperation =
  | "ensure-schema"
  | "begin"
  | "handler"
  | "commit";

export class InvokeExecutionOperationError
  extends Data.TaggedError("InvokeExecutionOperationError")<{
    readonly operation: InvokeExecutionOperation;
    readonly status: number;
    readonly message: string;
    readonly cause: unknown;
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

export type InvokeExecutionError =
  | InvokeRuntimeError
  | InvokeValidationError
  | InvokeExecutionOperationError;

type InvokeDatabaseOperationError =
  | InvokeDocumentIdParseError
  | InvokeDocumentIdTableMismatchError
  | InvokeDocumentNotFoundError
  | InvokeDocumentPlacementError
  | InvokeDocumentTableNotFoundError
  | InvokeDocumentValidationError
  | InvokeQueryPlanningError
  | InvokeTableNotFoundError;

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
  // Deliberate runtime bridge: public invoke compatibility API returns Promise.
  return await Effect.runPromise(
    executeInvokeEffect(env, deploymentId, request, functions).pipe(
      Effect.mapError(invokeExecutionErrorToAdapterError),
    ),
  );
}

export const executeInvokeEffect = Effect.fn("Invoke.execute")(function* (
  env: InvokeEnv,
  deploymentId: string,
  request: InvokeRequest,
  functions: BackendFunctionRegistry,
): Effect.fn.Return<InvokeResponse, InvokeExecutionError> {
  const activeDeployment = yield* loadActiveDeploymentEffect(env, deploymentId);
  const { fn, metadata, schema } = yield* resolveInvokeFunctionForRequest(
    activeDeployment,
    request,
    functions,
  );
  const scope = yield* resolveFunctionExecutionScopeEffect(
    metadata?.partition ?? fn.partition ?? null,
    metadata?.route ?? fn.route ?? null,
    request,
    schema,
  );
  yield* invokeExecutionOperation("ensure-schema", () =>
    SingleShardTransaction.ensureSchemaEffect(env, deploymentId, scope.partitionKey, schema)
  );
  const createRootOptions = scope.kind === "partitionCreateRoot"
    ? {
        createRoot: {
          rootTableId: (yield* tableForNameEffect(schema, scope.table)).tableId,
          preallocatedRootId: scope.preallocatedRootId,
        },
      }
    : {};
  const tx = yield* invokeExecutionOperation("begin", () =>
    SingleShardTransaction.beginEffect(env, deploymentId, scope.partitionKey, createRootOptions)
  );
  const value = yield* invokeExecutionOperation("handler", () =>
    Promise.resolve(
      fn.kind === "query"
        ? fn.handler({ db: readerFor(tx, schema) }, request.args)
        : fn.handler({ db: writerFor(tx, schema) }, request.args),
    )
  );
  yield* validateReturnEffect(metadata?.returns ?? fn.returns, value, schema);

  if (fn.kind === "query") {
    return { value, readSet: tx.currentReadSet(), readTs: tx.beginTs };
  }

  const commit = yield* invokeExecutionOperation("commit", () => commitMutationEffect(tx, request));
  return {
    value,
    committedTs: commit.committedTs,
    writes: commit.writes,
  };
});

function invokeExecutionOperation<A>(
  operation: InvokeExecutionOperation,
  execute: () => Promise<A> | Effect.Effect<A, TransactionOperationError>,
): Effect.Effect<A, InvokeExecutionOperationError | InvokeValidationError> {
  return Effect.try({
    try: execute,
    catch: cause => invokeExecutionOperationError(operation, cause),
  }).pipe(
    Effect.flatMap(operationResult => {
      if (Effect.isEffect(operationResult)) {
        return operationResult.pipe(
          Effect.mapError(cause => invokeExecutionOperationError(operation, cause)),
        );
      }
      return Effect.tryPromise({
        try: () => operationResult,
        catch: cause => invokeExecutionOperationError(operation, cause),
      });
    }),
  );
}

function invokeExecutionOperationError(
  operation: InvokeExecutionOperation,
  cause: unknown,
): InvokeExecutionOperationError | InvokeValidationError {
  if (cause instanceof InvokeDatabaseOperationFailure) {
    return cause.error;
  }
  if (isTransactionOperationError(cause)) {
    return new InvokeExecutionOperationError({
      operation,
      status: cause instanceof PartitionResponseError ? cause.status : 500,
      message: transactionOperationErrorMessage(cause),
      cause,
    });
  }
  if (cause instanceof HttpError) {
    return new InvokeExecutionOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  if (cause instanceof PartitionRequestError) {
    return new InvokeExecutionOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new InvokeExecutionOperationError({
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function isTransactionOperationError(cause: unknown): cause is TransactionOperationError {
  return cause instanceof PartitionFetchError ||
    cause instanceof PartitionResponseError ||
    cause instanceof TransactionInvariantError;
}

function transactionOperationErrorMessage(error: TransactionOperationError): string {
  if (error instanceof PartitionResponseError) {
    return `Partition request failed with status ${error.status}.`;
  }
  return error.message;
}

class InvokeDatabaseOperationFailure extends Error {
  constructor(readonly error: InvokeExecutionOperationError | InvokeValidationError) {
    super(`Invoke database operation failed: ${error._tag}`);
  }
}

function invokeDatabaseOperation<A>(
  effect: Effect.Effect<
    A,
    InvokeDatabaseOperationError | InvokeExecutionOperationError | InvokeValidationError
  >,
): Promise<A> {
  // User handlers consume ctx.db through Promise-returning methods; this is the
  // deliberate bridge from typed database effects back to that public API shape.
  return Effect.runPromise(effect).catch((cause: unknown) => {
    if (cause instanceof InvokeExecutionOperationError || isInvokeValidationError(cause)) {
      throw new InvokeDatabaseOperationFailure(cause);
    }
    throw cause;
  });
}

function isInvokeValidationError(error: unknown): error is InvokeValidationError {
  return error instanceof InvokeActiveFunctionMetadataNotFoundError ||
    error instanceof InvokeArgumentValidationError ||
    error instanceof InvokeDocumentIdParseError ||
    error instanceof InvokeDocumentIdTableMismatchError ||
    error instanceof InvokeDocumentNotFoundError ||
    error instanceof InvokeDocumentPlacementError ||
    error instanceof InvokeDocumentTableNotFoundError ||
    error instanceof InvokeDocumentValidationError ||
    error instanceof InvokeFunctionKindMismatchError ||
    error instanceof InvokeFunctionNotFoundError ||
    error instanceof InvokeKindValidationError ||
    error instanceof InvokePartitionValidationError ||
    error instanceof InvokeQueryPlanningError ||
    error instanceof InvokeRequestKindMismatchError ||
    error instanceof InvokeReturnValidationError ||
    error instanceof InvokeTableNotFoundError ||
    error instanceof InvokeUnsupportedFunctionKindError;
}

export function invokeExecutionOperationErrorToAdapterError(
  error: InvokeExecutionOperationError,
): HttpError | PartitionRequestError {
  if (error.cause instanceof PartitionRequestError) {
    return error.cause;
  }
  if (error.cause instanceof PartitionResponseError) {
    return new PartitionRequestError(error.cause.status, error.cause.body);
  }
  return new HttpError(error.status, error.message);
}

export function invokeExecutionErrorToAdapterError(
  error: InvokeExecutionError,
): HttpError | PartitionRequestError {
  if (error instanceof InvokeExecutionOperationError) {
    return invokeExecutionOperationErrorToAdapterError(error);
  }
  if (error instanceof InvokeActiveDeploymentLoadError) {
    return invokeActiveDeploymentLoadErrorToHttpError(error);
  }
  return invokeValidationErrorToHttpError(error);
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

export const partitionKeyFromArgsEffect = Effect.fn("Invoke.partitionKeyFromArgs")(function* (
  request: Pick<InvokeRequest, "path" | "args">,
  field: string,
  label: string,
): Effect.fn.Return<string, InvokePartitionValidationError> {
  if (!isWritableJsonObject(request.args)) {
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
  const runTransaction = <A>(operation: InvokeTransactionOperation<A>) =>
    invokeExecutionOperation("handler", () => invokeTransactionOperationResult(operation));
  return {
    get: id => invokeDatabaseOperation(getDocumentEffect(tx, schema, id, runTransaction)),
    query: table => backendQuery(tx, schema, table),
    queryIndex: async options => {
      const documents = await invokeDatabaseOperation(runTransaction(tx.queryIndexEffect(options)));
      return documents.map(document => documentValue(document.id, document.value));
    },
  };
}

export type InvokeTransactionOperation<A> =
  | (() => Promise<A>)
  | Effect.Effect<A, TransactionOperationError>;

export type InvokeTransactionRunner<E> = <A>(
  operation: InvokeTransactionOperation<A>,
) => Effect.Effect<A, E>;

function invokeTransactionOperationResult<A>(
  operation: InvokeTransactionOperation<A>,
): Promise<A> | Effect.Effect<A, TransactionOperationError> {
  return Effect.isEffect(operation) ? operation : operation();
}

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
  const document = yield* runTransaction(tx.getEffect(metadata.tableId, id));
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
    const runTransaction = <A>(operation: InvokeTransactionOperation<A>) =>
      invokeExecutionOperation("handler", () => invokeTransactionOperationResult(operation));
    const resolvedLimit = queryLimit ?? limit;
    const resolvedCursor = queryCursor ?? cursor;
    return invokeDatabaseOperation(queryDocumentsEffect(
      tx,
      schema,
      {
        table,
        ...(index === undefined ? {} : { index }),
        ...(range === undefined ? {} : { range }),
        ...(resolvedLimit === undefined ? {} : { limit: resolvedLimit }),
        ...(resolvedCursor === undefined ? {} : { cursor: resolvedCursor }),
        ...(order === undefined ? {} : { order }),
      },
      runTransaction,
    ));
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
      await invokeDatabaseOperation(validateUniqueQueryResultEffect(documents));
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
  const result = yield* runTransaction(
    tx.queryIndexPageEffect({
      indexId: metadata.indexId,
      ...bounds,
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.order === undefined ? {} : { order: request.order }),
    }),
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
  const lastDocument = page.at(-1);
  return {
    page,
    isDone: true,
    continueCursor: String(
      lastDocument !== undefined && isWritableJsonObject(lastDocument)
        ? lastDocument._id ?? ""
        : "",
    ),
  };
});

export const requireQueryIndexEffect = Effect.fn("Invoke.requireQueryIndex")(function* (
  index: string | undefined,
): Effect.fn.Return<string, InvokeQueryPlanningError> {
  if (index === undefined) {
    return yield* queryPlanningFailure("Flarex table scans are not implemented. Use withIndex().");
  }
  return index;
});

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
  const runTransaction = <A>(operation: InvokeTransactionOperation<A>) =>
    invokeExecutionOperation("handler", () => invokeTransactionOperationResult(operation));
  return {
    ...readerFor(tx, schema),
    insert: (table, value, id) =>
      invokeDatabaseOperation(insertDocumentEffect(tx, schema, table, value, id, runTransaction)),
    replace: (id, value) =>
      invokeDatabaseOperation(replaceDocumentEffect(tx, schema, id, value, runTransaction)),
    patch: (id, value) =>
      invokeDatabaseOperation(patchDocumentEffect(tx, schema, id, value, runTransaction)),
    delete: id =>
      invokeDatabaseOperation(deleteDocumentEffect(tx, schema, id, runTransaction)),
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
  return yield* runTransaction(tx.insertEffect(metadata.tableId, value, id));
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
  yield* runTransaction(tx.replaceEffect(metadata.tableId, id, value));
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
  const current = yield* runTransaction(tx.getEffect(metadata.tableId, id));
  if (current === null) {
    return yield* Effect.fail(new InvokeDocumentNotFoundError({ id }));
  }
  const next = { ...(current.value as Record<string, Json>), ...value };
  yield* validateDocumentEffect(metadata, next, schema);
  yield* validateDocumentPlacementEffect(metadata, next, tx.partitionKey);
  yield* runTransaction(tx.patchEffect(metadata.tableId, id, value));
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
  const current = yield* runTransaction(tx.getEffect(metadata.tableId, id));
  if (current !== null) {
    yield* validateDocumentPlacementEffect(metadata, current.value, tx.partitionKey);
  }
  yield* runTransaction(tx.deleteEffect(metadata.tableId, id));
});

function commitMutationEffect(
  tx: SingleShardTransaction,
  request: InvokeRequest,
): Effect.Effect<CommitResponse, TransactionOperationError> {
  return tx.commitEffect({
    source: `invoke:${request.path}`,
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
  });
}

export async function loadActiveDeployment(
  env: InvokeEnv,
  deploymentId: string,
): Promise<ActiveDeploymentStatus> {
  // Deliberate runtime bridge: legacy active-deployment helper returns Promise.
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
  const body = yield* readActiveDeploymentResponseJson(deploymentId, response);
  return yield* decodeActiveDeploymentResponse(deploymentId, body);
});

export const readActiveDeploymentResponseJson = Effect.fn(
  "Invoke.readActiveDeploymentResponseJson",
)(function* (
  deploymentId: string,
  response: Pick<Response, "json">,
): Effect.fn.Return<unknown, InvokeActiveDeploymentLoadError> {
  return yield* readResponseJsonEffect(response).pipe(
    Effect.mapError(error => activeDeploymentLoadError(deploymentId, 500, error)),
  );
});

export const decodeActiveDeploymentResponse = Effect.fn(
  "Invoke.decodeActiveDeploymentResponse",
)(function* (
  deploymentId: string,
  value: unknown,
): Effect.fn.Return<ActiveDeploymentStatus, InvokeActiveDeploymentLoadError> {
  const status = yield* decodeActiveDeploymentStatusEffect(value).pipe(
    Effect.mapError(error => activeDeploymentLoadError(deploymentId, 500, error)),
  );
  return status as ActiveDeploymentStatus;
});

export async function loadActiveFunctionMetadata(
  env: InvokeEnv,
  deploymentId: string,
  path: string,
): Promise<{ deployment: ActiveDeploymentStatus; metadata: DeploymentFunctionMetadata }> {
  // Deliberate runtime bridge: legacy metadata helper returns Promise.
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
  if (isWritableJsonObject(value)) {
    return { ...value, _id: id };
  }
  return value;
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

export const validateDocumentPlacementEffect = Effect.fn(
  "Invoke.validateDocumentPlacement",
)(function* (
  table: SchemaTable,
  value: Json,
  partitionKey: string,
): Effect.fn.Return<void, InvokeDocumentPlacementError> {
  const placementField = ownerFieldForPlacement(table);
  if (placementField === null) return;
  if (!isWritableJsonObject(value)) {
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
