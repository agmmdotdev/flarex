import type {
  FieldTypeFromFieldPath,
  GenericDocument,
  GenericTableInfo,
  IndexNames,
  NamedIndex,
} from "./dataModel";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { v } from "./values";

export type IndexRangeExpression = {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  value: unknown;
};

export abstract class IndexRange {
  declare private readonly _isIndexRange: undefined;
}

type Tail<Fields extends readonly string[]> = Fields extends readonly [
  string,
  ...infer Rest extends string[],
]
  ? Rest
  : [];

export type IndexRangeBuilder<
  Document extends GenericDocument,
  Fields extends readonly string[],
> = number extends Fields["length"]
  ? LowerBoundIndexRangeBuilder<Document, Fields[number]> & {
      eq(field: Fields[number], value: FieldTypeFromFieldPath<Document, Fields[number]>): IndexRange;
    }
  : Fields extends readonly [infer Field extends string, ...string[]]
  ? LowerBoundIndexRangeBuilder<Document, Field> & {
      eq(
        field: Field,
        value: FieldTypeFromFieldPath<Document, Field>,
      ): Tail<Fields> extends [] ? IndexRange : IndexRangeBuilder<Document, Tail<Fields>>;
    }
  : IndexRange;

export interface LowerBoundIndexRangeBuilder<
  Document extends GenericDocument,
  Field extends string,
> extends UpperBoundIndexRangeBuilder<Document, Field> {
  gt(
    field: Field,
    value: FieldTypeFromFieldPath<Document, Field>,
  ): UpperBoundIndexRangeBuilder<Document, Field>;
  gte(
    field: Field,
    value: FieldTypeFromFieldPath<Document, Field>,
  ): UpperBoundIndexRangeBuilder<Document, Field>;
}

export interface UpperBoundIndexRangeBuilder<
  Document extends GenericDocument,
  Field extends string,
> extends IndexRange {
  lt(field: Field, value: FieldTypeFromFieldPath<Document, Field>): IndexRange;
  lte(field: Field, value: FieldTypeFromFieldPath<Document, Field>): IndexRange;
}

export type DatabaseQueryRequest = {
  table: string;
  index?: string;
  range?: { readonly expressions: readonly IndexRangeExpression[] };
  limit?: number;
  order?: "asc" | "desc";
  cursor?: string;
};

export type DatabaseQueryResult = {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
};
export type DatabaseQueryTerminal =
  | { readonly kind: "collect" }
  | { readonly kind: "take"; readonly count: number }
  | { readonly kind: "paginate"; readonly numItems: number };

/** One-argument executors remain supported by named compatibility hosts. */
export type DatabaseQueryExecutor = (
  request: DatabaseQueryRequest,
  terminal?: DatabaseQueryTerminal,
) => Promise<DatabaseQueryResult>;

/** Trusted runtime admission covers the terminal, including its postprocessing. */
export type DatabaseQueryTerminalExecution = <Value>(
  operation: () => Promise<Value>,
) => Promise<Value>;

const ordinaryQueryErrors = new WeakSet<object>();

export function databaseQueryError(message: string): Error {
  const error = new Error(message);
  ordinaryQueryErrors.add(error);
  return error;
}

export function isDatabaseQueryError(value: unknown): boolean {
  return typeof value === "object" && value !== null && ordinaryQueryErrors.has(value);
}

export type ManagedDatabaseQueryResult<Value> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "queryError"; readonly message: string };

export interface ManagedDatabaseQueryCapability {
  readonly queryStart: (
    request: DatabaseQueryRequest,
    terminal: DatabaseQueryTerminal,
  ) => Promise<ManagedDatabaseQueryResult<{ readonly queryId: string }>>;
  readonly queryNext: (
    queryId: string,
    maxResults: number,
  ) => Promise<ManagedDatabaseQueryResult<DatabaseQueryResult>>;
  readonly queryCleanup: (
    queryId: string,
  ) => Promise<ManagedDatabaseQueryResult<null>>;
}

export type PaginationOptions = {
  numItems: number;
  cursor: string | null;
};

export type PaginationResult<Document> = {
  page: Document[];
  isDone: boolean;
  continueCursor: string;
};

export const paginationOptsValidator = v.object({
  numItems: v.number(),
  cursor: v.union(v.string(), v.null()),
});

export interface OrderedQuery<TableInfo extends GenericTableInfo> {
  order(order: "asc" | "desc"): OrderedQuery<TableInfo>;
  collect(): Promise<Array<TableInfo["document"]>>;
  take(count: number): Promise<Array<TableInfo["document"]>>;
  first(): Promise<TableInfo["document"] | null>;
  unique(): Promise<TableInfo["document"] | null>;
  paginate(options: PaginationOptions): Promise<PaginationResult<TableInfo["document"]>>;
}

export interface QueryInitializer<TableInfo extends GenericTableInfo>
  extends OrderedQuery<TableInfo> {
  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    range?: (
      builder: IndexRangeBuilder<TableInfo["document"], NamedIndex<TableInfo, IndexName>>,
    ) => IndexRange,
  ): OrderedQuery<TableInfo>;
}

class RuntimeIndexRangeBuilder extends IndexRange {
  #expressions: readonly IndexRangeExpression[] = [];
  #consumed = false;

  #consume(): void {
    if (this.#consumed) {
      throw databaseQueryError("IndexRangeBuilder has already been used! Chain your method calls like q => q.eq(...).eq(...).");
    }
    this.#consumed = true;
  }

  #append(op: IndexRangeExpression["op"], field: string, value: unknown): RuntimeIndexRangeBuilder {
    // The source consumes before serializing the bound, including invalid values.
    this.#consume();
    const captured = value === undefined ? undefined : normalizeFlarexValueV1(value).value;
    const next = new RuntimeIndexRangeBuilder();
    next.#expressions = Object.freeze([
      ...this.#expressions, Object.freeze({ op, field, value: captured }),
    ]);
    return next;
  }

  eq(field: string, value: unknown): RuntimeIndexRangeBuilder { return this.#append("eq", field, value); }
  gt(field: string, value: unknown): RuntimeIndexRangeBuilder { return this.#append("gt", field, value); }
  gte(field: string, value: unknown): RuntimeIndexRangeBuilder { return this.#append("gte", field, value); }
  lt(field: string, value: unknown): RuntimeIndexRangeBuilder { return this.#append("lt", field, value); }
  lte(field: string, value: unknown): RuntimeIndexRangeBuilder { return this.#append("lte", field, value); }

  static export(builder: IndexRange): NonNullable<DatabaseQueryRequest["range"]> {
    if (typeof builder !== "object" || builder === null || !(#expressions in builder)) {
      throw databaseQueryError("An index range callback must return its chained range builder.");
    }
    builder.#consume();
    return Object.freeze({ expressions: builder.#expressions });
  }
}

// Capture this private export capability before application callbacks can inspect the builder.
const exportIndexRange = RuntimeIndexRangeBuilder.export;

class RuntimeQueryInitializer<TableInfo extends GenericTableInfo> implements QueryInitializer<TableInfo> {
  readonly #table: string;
  readonly #executor: DatabaseQueryExecutor;
  readonly #terminalExecution: DatabaseQueryTerminalExecution;

  constructor(table: string, executor: DatabaseQueryExecutor, terminalExecution: DatabaseQueryTerminalExecution) {
    this.#table = table;
    this.#executor = executor;
    this.#terminalExecution = terminalExecution;
  }

  #fullTableScan(): RuntimeQuery<TableInfo> {
    return new RuntimeQuery(this.#executor, { table: this.#table }, this.#terminalExecution);
  }

  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    range?: (
      builder: IndexRangeBuilder<TableInfo["document"], NamedIndex<TableInfo, IndexName>>,
    ) => IndexRange,
  ): OrderedQuery<TableInfo> {
    requireArgument(indexName, "withIndex", "indexName");
    const builder = new RuntimeIndexRangeBuilder();
    const built = range === undefined ? builder : range(builder as never);
    const captured = exportIndexRange(built);
    return new RuntimeQuery(this.#executor, {
      table: this.#table, index: indexName, range: captured,
    }, this.#terminalExecution);
  }

  order(order: "asc" | "desc"): OrderedQuery<TableInfo> { return this.#fullTableScan().order(order); }
  collect(): Promise<Array<TableInfo["document"]>> { return this.#fullTableScan().collect(); }
  take(count: number): Promise<Array<TableInfo["document"]>> { return this.#fullTableScan().take(count); }
  first(): Promise<TableInfo["document"] | null> { return this.#fullTableScan().first(); }
  unique(): Promise<TableInfo["document"] | null> { return this.#fullTableScan().unique(); }
  paginate(options: PaginationOptions): Promise<PaginationResult<TableInfo["document"]>> {
    return this.#fullTableScan().paginate(options);
  }
}

class RuntimeQuery<TableInfo extends GenericTableInfo> implements OrderedQuery<TableInfo> {
  readonly #executor: DatabaseQueryExecutor;
  readonly #request: DatabaseQueryRequest;
  readonly #terminalExecution: DatabaseQueryTerminalExecution;
  #state: "preparing" | "executing" | "closed" | "consumed" = "preparing";

  constructor(executor: DatabaseQueryExecutor, request: DatabaseQueryRequest, terminalExecution: DatabaseQueryTerminalExecution) {
    this.#executor = executor;
    this.#request = request;
    this.#terminalExecution = terminalExecution;
  }

  #takeQuery(): DatabaseQueryRequest {
    if (this.#state !== "preparing") {
      throw databaseQueryError("A query can only be chained once and can't be chained after iteration begins.");
    }
    this.#state = "closed";
    return this.#request;
  }

  #startQuery(): DatabaseQueryRequest {
    if (this.#state === "executing") throw databaseQueryError("Iteration can only begin on a query once.");
    if (this.#state === "closed" || this.#state === "consumed") {
      throw databaseQueryError(this.#state === "consumed"
        ? "This query is closed and can't emit any more values."
        : "This query has been chained with another operator and can't be reused.");
    }
    this.#state = "executing";
    return this.#request;
  }

  collect(): Promise<Array<TableInfo["document"]>> {
    return this.#terminalExecution(async () => {
      const request = this.#startQuery();
      try { return (await this.#execute(request, {}, { kind: "collect" })).page; }
      finally { this.#state = "consumed"; }
    });
  }

  async #take(count: number): Promise<Array<TableInfo["document"]>> {
    requireCount(count, "take");
    const request = this.#takeQuery();
    if (count === 0) return [];
    return (await this.#execute(request, { limit: count }, { kind: "take", count })).page;
  }

  take(count: number): Promise<Array<TableInfo["document"]>> {
    return this.#terminalExecution(() => this.#take(count));
  }

  first(): Promise<TableInfo["document"] | null> {
    return this.#terminalExecution(async () => (await this.#take(1))[0] ?? null);
  }

  unique(): Promise<TableInfo["document"] | null> {
    return this.#terminalExecution(async () => {
      const documents = await this.#take(2);
      if (documents.length > 1) throw databaseQueryError("Query returned more than one document.");
      return documents[0] ?? null;
    });
  }

  order(order: "asc" | "desc"): OrderedQuery<TableInfo> {
    requireArgument(order, "order", "order");
    const request = this.#takeQuery();
    if (request.order !== undefined) throw databaseQueryError("Queries may only specify order at most once");
    return new RuntimeQuery(this.#executor, { ...request, order }, this.#terminalExecution);
  }

  paginate(options: PaginationOptions): Promise<PaginationResult<TableInfo["document"]>> {
    return this.#terminalExecution(async () => {
      requireArgument(options, "paginate", "options");
      requireCount(options.numItems, "paginate");
      if (options.numItems === 0) throw databaseQueryError("paginate requires a positive number of items.");
      const request = this.#takeQuery();
      return this.#execute(request, {
        limit: options.numItems,
        ...(options.cursor === null ? {} : { cursor: options.cursor }),
      }, { kind: "paginate", numItems: options.numItems });
    });
  }

  #execute(request: DatabaseQueryRequest, overrides: Partial<DatabaseQueryRequest>, terminal: DatabaseQueryTerminal): Promise<
    PaginationResult<TableInfo["document"]>
  > {
    return this.#executor({ ...request, ...overrides }, terminal) as Promise<PaginationResult<TableInfo["document"]>>;
  }
}

export function createQueryInitializer<TableInfo extends GenericTableInfo>(
  table: string,
  executor: DatabaseQueryExecutor,
  terminalExecution: DatabaseQueryTerminalExecution = operation => operation(),
): QueryInitializer<TableInfo> {
  return new RuntimeQueryInitializer(table, executor, terminalExecution);
}

function requireArgument(value: unknown, method: string, name: string): void {
  if (value === undefined) {
    const error = new TypeError(`Must provide arg 1 \`${name}\` to \`${method}\``);
    ordinaryQueryErrors.add(error);
    throw error;
  }
}

function requireCount(count: number, terminal: string): void {
  requireArgument(count, terminal, "n");
  if (!Number.isSafeInteger(count) || count < 0) {
    throw databaseQueryError(`${terminal} requires a nonnegative safe integer.`);
  }
}
