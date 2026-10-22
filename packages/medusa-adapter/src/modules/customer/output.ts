import { Result, Schema, type Effect } from "effect";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCompleteRow } from "../../value/complete-row";
import { commerceDecoder } from "../../value/decoder";
import type { captureCustomerMetadata } from "./schema";

type Metadata = Effect.Success<ReturnType<typeof captureCustomerMetadata>>["frame"];
const decodeEmpty = commerceDecoder(Schema.Array(Schema.Never), "storedCorruption");
const decodeObject = commerceDecoder(Schema.JsonObject, "storedCorruption");
const decodeListShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "storedCorruption");
const decodeCreatedShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isLengthBetween(1, 1)), "storedCorruption");

/** Complete scalar DTOs and the native creation-only empty relation shape have
 * separate decoders. Reads never acquire or initialize relation collections. */
export function compileCustomerSelectionOutput(metadata: Metadata) {
  return Result.gen(function* () {
    const customer = metadata.tables.find(table => table.name === "customer"),
      address = metadata.tables.find(table => table.name === "customer_address"),
      membership = metadata.tables.find(table => table.name === "customer_group_customer"),
      group = metadata.tables.find(table => table.name === "customer_group");
    if (metadata.tables.length !== 4 || customer === undefined || address === undefined || membership === undefined || group === undefined ||
      customer.foreignKeys.length || customer.relationships.length !== 2 ||
      !customer.relationships.some(relation => relation.name === "addresses" && relation.type === "hasMany" && relation.targetTable === address.name) ||
      !customer.relationships.some(relation => relation.name === "groups" && relation.type === "manyToMany" && relation.targetTable === group.name))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const account = customer.columns.find(column => column.name === "has_account");
    if (account?.type !== "boolean" || account.nullable || account.defaultValue !== false ||
      !customer.indexes.some(index => index.unique && index.where === "deleted_at IS NULL" &&
        index.columns.length === 2 && index.columns[0] === "email" && index.columns[1] === "has_account"))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [child, onDelete] of [[address, "cascade"], [membership, undefined]] as const) if (!child.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === "customer_id" &&
      key.referencedTable === customer.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id" && key.onDelete === onDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(customer);
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* complete(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const rows: Array<Result.Result.Success<ReturnType<typeof decodeRow>>> = [];
      for (const value of yield* decodeListShape(input)) rows.push(yield* decodeRow(value));
      if (new Set(rows.map(row => row.id)).size !== rows.length) return yield* Result.fail(commerceError("storedCorruption"));
      return rows;
    });
    const decodeCreatedRow = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeObject(input);
      const { groups, addresses, ...scalar } = value, row = yield* decodeRow(scalar);
      const emptyGroups = yield* decodeEmpty(groups), emptyAddresses = yield* decodeEmpty(addresses);
      if (row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
      const created: JsonObject & { readonly id: string; readonly groups: readonly never[]; readonly addresses: readonly never[] } =
        { ...row, groups: emptyGroups, addresses: emptyAddresses };
      return created;
    });
    const descriptors = new Map(customer.relationships.map(relationship => [relationship.name, { relationship }]));
    const initializeRows = (input: unknown) => Result.gen(function* () {
      const rows: JsonObject[] = [];
      for (const value of yield* decodeCreatedShape(input)) rows.push({ ...yield* decodeRow(value) });
      fillEmptyToManyRelations(rows, descriptors);
      const created = [];
      for (const value of rows) created.push(yield* decodeCreatedRow(value));
      return created;
    });
    const entities = [];
    for (const [table, model, maximum] of [[customer, "Customer", 1], [address, "CustomerAddress", 1]] as const)
      entities.push({ table, model, maximum, decodeRow: yield* compileCompleteRow(table) });
    const defaults: Record<string, Json> = {};
    for (const column of customer.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
      if (column.defaultValue !== undefined) defaults[column.name] = column.defaultValue;
      else if (column.nullable) defaults[column.name] = null;
    }
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeObject(input);
      return "groups" in value || "addresses" in value ? yield* decodeCreatedRow(value) : yield* decodeRow(value);
    });
    const Output = Schema.JsonObject.check(Schema.makeFilter(value => Result.isSuccess(decodeOutput(value)) || "Expected a complete Customer DTO"));
    return { customer, address, membership, group, tables: metadata.tables, entities, defaults,
      decodeRow, decodeRows, decodeCreatedRow, initializeRows, decodeOutput, Output };
  });
}
