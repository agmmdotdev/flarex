import type {
  FieldTypeFromFieldPath,
  GenericDocument,
  GenericTableInfo,
  IndexNames,
  NamedIndex,
} from "./dataModel";
import { v } from "./values";

export type IndexRangeExpression = {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  value: unknown;
};

export type IndexRange = {
  readonly expressions: readonly IndexRangeExpression[];
};

type Tail<Fields extends readonly string[]> = Fields extends readonly [
  string,
  ...infer Rest extends string[],
]
  ? Rest
  : [];

export type IndexRangeBuilder<
  Document extends GenericDocument,
  Fields extends readonly string[],
> = Fields extends readonly [infer Field extends string, ...string[]]
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
  range?: IndexRange;
  limit?: number;
  order?: "asc" | "desc";
  cursor?: string;
};

export type DatabaseQueryResult = {
  page: unknown[];
  isDone: boolean;
  continueCursor: string;
};
export type DatabaseQueryExecutor = (request: DatabaseQueryRequest) => Promise<DatabaseQueryResult>;

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

class RuntimeIndexRangeBuilder implements IndexRange {
  constructor(readonly expressions: IndexRangeExpression[] = []) {}

  eq(field: string, value: unknown): RuntimeIndexRangeBuilder {
    return new RuntimeIndexRangeBuilder([...this.expressions, { op: "eq", field, value }]);
  }

  gt(field: string, value: unknown): RuntimeIndexRangeBuilder {
    return new RuntimeIndexRangeBuilder([...this.expressions, { op: "gt", field, value }]);
  }

  gte(field: string, value: unknown): RuntimeIndexRangeBuilder {
    return new RuntimeIndexRangeBuilder([...this.expressions, { op: "gte", field, value }]);
  }

  lt(field: string, value: unknown): RuntimeIndexRangeBuilder {
    return new RuntimeIndexRangeBuilder([...this.expressions, { op: "lt", field, value }]);
  }

  lte(field: string, value: unknown): RuntimeIndexRangeBuilder {
    return new RuntimeIndexRangeBuilder([...this.expressions, { op: "lte", field, value }]);
  }
}

class RuntimeQuery<TableInfo extends GenericTableInfo> implements QueryInitializer<TableInfo> {
  constructor(
    private readonly executor: DatabaseQueryExecutor,
    private readonly request: DatabaseQueryRequest,
  ) {}

  withIndex<IndexName extends IndexNames<TableInfo>>(
    indexName: IndexName,
    range?: (
      builder: IndexRangeBuilder<TableInfo["document"], NamedIndex<TableInfo, IndexName>>,
    ) => IndexRange,
  ): OrderedQuery<TableInfo> {
    const builder = new RuntimeIndexRangeBuilder();
    const built = range?.(builder as never);
    return new RuntimeQuery(this.executor, {
      ...this.request,
      index: indexName,
      ...(built === undefined ? {} : { range: built }),
    });
  }

  collect(): Promise<Array<TableInfo["document"]>> {
    return this.execute().then(result => result.page);
  }

  take(count: number): Promise<Array<TableInfo["document"]>> {
    return this.execute({ limit: count }).then(result => result.page);
  }

  async first(): Promise<TableInfo["document"] | null> {
    return (await this.take(1))[0] ?? null;
  }

  async unique(): Promise<TableInfo["document"] | null> {
    const documents = await this.take(2);
    if (documents.length > 1) throw new Error("Query returned more than one document.");
    return documents[0] ?? null;
  }

  order(order: "asc" | "desc"): OrderedQuery<TableInfo> {
    return new RuntimeQuery(this.executor, { ...this.request, order });
  }

  async paginate(options: PaginationOptions): Promise<PaginationResult<TableInfo["document"]>> {
    const result = await this.execute({
      limit: options.numItems,
      ...(options.cursor === null ? {} : { cursor: options.cursor }),
    });
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  }

  private execute(overrides: Partial<DatabaseQueryRequest> = {}): Promise<
    PaginationResult<TableInfo["document"]>
  > {
    return this.executor({ ...this.request, ...overrides }) as Promise<
      PaginationResult<TableInfo["document"]>
    >;
  }
}

export function createQueryInitializer<TableInfo extends GenericTableInfo>(
  table: string,
  executor: DatabaseQueryExecutor,
): QueryInitializer<TableInfo> {
  return new RuntimeQuery(executor, { table });
}
