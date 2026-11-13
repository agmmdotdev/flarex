import { Result, Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import type { SchemaTable } from "../../schema/model";
import type { ScalarFilter, WherePolicy } from "../../query/predicate";
import { QueryLimit, QueryOffset } from "../../query/decoder";
import { StoreOrderFilters, storeOrderRelatedLimit } from "./store-read-input";

export const decodeStoreOrderDalQuery = commerceDecoder(Schema.Struct({ where: Schema.optionalKey(StoreOrderFilters),
  options: Schema.optionalKey(Schema.Struct({
    fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(256))),
    populate: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(32))),
    limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
    orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literals(["ASC", "DESC"]) })),
  })) }), "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile");
const decodeBranches = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "unsupportedProfile");
const ids = commerceDecoder(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(storeOrderRelatedLimit))]), "unsupportedProfile");
const version = commerceDecoder(Schema.Int, "unsupportedProfile");
const draft = commerceDecoder(Schema.Literal(false), "unsupportedProfile");

/** The Store profile's public selectors remain separate from finance writes. */
export function orderStoreWhere(table: SchemaTable): WherePolicy {
  const names = ["id", "order_id", "status", "version", "customer_id", "is_draft_order"];
  return { decode: decodeWhere,
    fields: new Map(names.filter(name => table.columns.some(column => column.name === name)).map((name): [string, ScalarFilter] =>
      [name, name === "version" ? { column: name, decodePredicate: input => version(input).pipe(Result.map(value =>
        ({ kind: "numberIn", column: name, values: [value] }))) }
        : { column: name, decode: name === "is_draft_order" ? draft : ids }])),
    logical: { decodeBranches, nodes: 16, depth: 3, operands: 256, unwrapMembership: value => value } };
}
