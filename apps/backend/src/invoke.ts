import { HttpError } from "./http";
import {
  indexBoundsForExpressions,
  type IndexRangeExpression,
} from "./indexKeys";
import { isFlarexIdForTable, parseFlarexId } from "./ids";
import { deploymentObjectName } from "./routing";
import {
  PartitionRequestError,
  SingleShardTransaction,
} from "./transaction";
import type {
  BackendFunctionKind,
  CommitResponse,
  DeploymentFunctionMetadata,
  DeploymentSchema,
  DeploymentFunctionKind,
  Env,
  InvokeRequest,
  InvokeResponse,
  Json,
  SchemaTable,
  ValidatorJson,
} from "./types";
import { BackendValidationError, validateJsonValue } from "./validation";

type InvokeEnv = Pick<Env, "DEPLOYMENTS" | "PARTITIONS">;

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
      handler: (ctx: BackendQueryCtx, args: Json) => Promise<Json> | Json;
    }
  | {
      kind: "mutation";
      args?: ValidatorJson;
      returns?: ValidatorJson | null;
      handler: (ctx: BackendMutationCtx, args: Json) => Promise<Json> | Json;
    };

export type BackendFunctionRegistry = Record<string, BackendRegisteredFunction>;

export async function executeInvoke(
  env: InvokeEnv,
  deploymentId: string,
  request: InvokeRequest,
  functions: BackendFunctionRegistry,
): Promise<InvokeResponse> {
  const fn = functions[request.path];
  if (!fn) {
    throw new HttpError(404, `Unknown Flarex function: ${request.path}`);
  }
  const metadata = await loadFunctionMetadata(env, deploymentId, request.path);
  const declaredKind = metadata?.kind ?? fn.kind;
  if (!isInvokableKind(declaredKind)) {
    throw new HttpError(400, `${declaredKind} execution is not implemented by /invoke.`);
  }
  if (declaredKind !== fn.kind) {
    throw new HttpError(
      500,
      `Function metadata kind mismatch for ${request.path}. Metadata has ${declaredKind}, handler is ${fn.kind}.`,
    );
  }

  if (request.kind !== undefined && request.kind !== declaredKind) {
    throw new HttpError(
      400,
      `Function kind mismatch. Request has ${request.kind}, function is ${declaredKind}.`,
    );
  }
  const schema = await loadSchema(env, deploymentId);
  try {
    const args = metadata?.args ?? fn.args;
    if (args !== undefined && args !== null) {
      validateJsonValue(args, request.args, "$args", { validateId: idValidatorForSchema(schema) });
    }
  } catch (error) {
    if (error instanceof BackendValidationError) {
      throw new HttpError(400, `ArgumentValidationError: ${error.message}`);
    }
    throw error;
  }
  await SingleShardTransaction.ensureSchema(env, deploymentId, request.partitionKey, schema);
  const tx = await SingleShardTransaction.begin(env, deploymentId, request.partitionKey);
  const value =
    fn.kind === "query"
      ? await fn.handler({ db: readerFor(tx, schema) }, request.args)
      : await fn.handler({ db: writerFor(tx, schema) }, request.args);
  validateReturn(metadata?.returns ?? fn.returns, value, schema);

  if (fn.kind === "query") {
    return { value, readSet: tx.currentReadSet() };
  }

  const commit = await commitMutation(tx, request);
  return {
    value,
    committedTs: commit.committedTs,
    writes: commit.writes,
  };
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

function readerFor(tx: SingleShardTransaction, schema: DeploymentSchema): BackendDatabaseReader {
  return {
    get: async id => {
      const document = await tx.get(tableIdFromDocumentId(id, schema), id);
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
    const tableId = tableIdForName(schema, table);
    const metadata = schema.indexes.find(
      candidate =>
        candidate.tableId === tableId &&
        candidate.name === index &&
        (candidate.state === undefined || candidate.state === "enabled"),
    );
    if (!metadata) throw new HttpError(400, `Unknown index ${table}.${index}.`);

    const expressions = range?.expressions ?? [];
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
    return {
      page: result.documents.map(document => documentValue(document.id, document.value)),
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

function writerFor(tx: SingleShardTransaction, schema: DeploymentSchema): BackendDatabaseWriter {
  return {
    ...readerFor(tx, schema),
    insert: async (table, value, id) => {
      const metadata = tableForName(schema, table);
      validateDocument(metadata, value, schema);
      const tableId = metadata.tableId;
      if (id !== undefined) validateDocumentIdTable(id, tableId);
      return tx.insert(tableId, value, id);
    },
    replace: async (id, value) => {
      const metadata = tableFromDocumentId(id, schema);
      validateDocument(metadata, value, schema);
      tx.replace(metadata.tableId, id, value);
    },
    patch: async (id, value) => {
      const metadata = tableFromDocumentId(id, schema);
      const current = await tx.get(metadata.tableId, id);
      if (current === null) throw new HttpError(404, `Document not found: ${id}`);
      const next = { ...(current.value as Record<string, Json>), ...value };
      validateDocument(metadata, next, schema);
      await tx.patch(metadata.tableId, id, value);
    },
    delete: async id => {
      tx.delete(tableIdFromDocumentId(id, schema), id);
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

async function loadSchema(env: InvokeEnv, deploymentId: string): Promise<DeploymentSchema> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  const response = await deployment.fetch("https://flarex.internal/schema");
  if (!response.ok) {
    throw new HttpError(response.status, `Failed to load schema for deployment ${deploymentId}.`);
  }
  return response.json() as Promise<DeploymentSchema>;
}

async function loadFunctionMetadata(
  env: InvokeEnv,
  deploymentId: string,
  path: string,
): Promise<DeploymentFunctionMetadata | null> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  const response = await deployment.fetch(
    `https://flarex.internal/function?path=${encodeURIComponent(path)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new HttpError(
      response.status,
      `Failed to load function metadata for ${deploymentId}:${path}.`,
    );
  }
  return response.json() as Promise<DeploymentFunctionMetadata>;
}

function isInvokableKind(kind: DeploymentFunctionKind): kind is BackendFunctionKind {
  return kind === "query" || kind === "mutation";
}

function tableIdForName(schema: DeploymentSchema, table: string): number {
  return tableForName(schema, table).tableId;
}

function tableForName(schema: DeploymentSchema, table: string): SchemaTable {
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

function validateReturn(
  validator: ValidatorJson | null | undefined,
  value: Json,
  schema: DeploymentSchema,
): void {
  if (validator === undefined || validator === null) return;
  try {
    validateJsonValue(validator, value, "$return", { validateId: idValidatorForSchema(schema) });
  } catch (error) {
    if (error instanceof BackendValidationError) {
      throw new HttpError(400, `ReturnValidationError: ${error.message}`);
    }
    throw error;
  }
}

function idValidatorForSchema(schema: DeploymentSchema) {
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
