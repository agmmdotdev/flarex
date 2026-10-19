import { Effect, Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection } from "../../query/projection";
import { compileWhere } from "../../query/predicate";
import { executeRead, type ReadContext, type ReadPlan } from "../../query/read";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { projectNativeRow } from "../../repository/result";
import { FulfillmentCreationId, type compileFulfillmentCreationContracts } from "./fulfillment-create-input";

const decodeInput = commerceDecoder(Schema.Struct({ where: Schema.Struct({ id: FulfillmentCreationId }), options: Schema.Struct({
  fields: Schema.Tuple([Schema.Literal("id"), Schema.Literal("name"), Schema.Literal("data"), Schema.Literal("metadata")]),
  populate: Schema.Array(Schema.Never).check(Schema.isMaxLength(0)),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}) }), "unsupportedProfile");
type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentCreationContracts>>;

/** Native return creation retrieves this Option projection after inserting
 * the Fulfillment. Native retrieve owns absence; no Option mutation is granted. */
export function prepareFulfillmentReturnQuery(contracts: Contracts) {
  return Result.gen(function* () {
    const option = contracts.option.table;
    const catalog = yield* makeReadCatalog([{ name: option.name, columns: option.columns.map(column => column.name), primaryKeys: ["id"],
      foreignKeys: option.foreignKeys.flatMap(key => key.columns), companions: {} }], new Map());
    const query = (input: unknown) => Result.gen(function* () {
      const args = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeInput));
      const projection = yield* compileProjection(catalog, option.name, args.options.fields, [], {
        keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map(),
      });
      return { table: option.name, projection, paths: [], relationFilters: [], ordering: new Map(), withDeleted: false,
        query: { skip: 0, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
          yield* compileWhere(args.where, scalarIdWhere), { kind: "isNull", column: "deleted_at" },
        ] } }, window: { kind: "catalog", order: "id", select: rows => ({ rows, count: rows.length }) },
      } satisfies ReadPlan;
    });
    const admitSelection: NonNullable<ReadContext["admitSelection"]> = (table, rows) => Result.gen(function* () {
      if (table !== option.name) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > contracts.option.maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* contracts.option.decodeRow(projectNativeRow(row));
    });
    const find = Effect.fn("FulfillmentReturn.findShippingOption")(function* (ctx: ReadContext, input: unknown) {
      const plan = yield* Effect.fromResult(query(input)), selected = yield* executeRead({ ...ctx, admitSelection }, catalog, plan, false);
      return selected.rows;
    });
    return { query, find };
  });
}
