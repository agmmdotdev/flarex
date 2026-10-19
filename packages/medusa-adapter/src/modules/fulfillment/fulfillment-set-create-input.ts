import { Result, Schema, type Effect } from "effect";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileFulfillmentLifecycleGraph, type FulfillmentPhysicalProfile } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const FulfillmentSetCreate = Schema.Struct({ name: Schema.String, type: Schema.String });
export const FulfillmentSetCreates = Schema.Array(FulfillmentSetCreate).pipe(Schema.mutable).check(Schema.isMaxLength(1));
export const FulfillmentSetPhysicalDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(1));
export const decodeFulfillmentSetCreates = commerceDecoder(FulfillmentSetCreates, "invalidInput");
export const decodeFulfillmentSetPhysicalDeletionIds = commerceDecoder(FulfillmentSetPhysicalDeletionIds, "invalidInput");
export const decodeFulfillmentSetPhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(1)),
}), "unsupportedProfile");
const decodeRowsShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(1)), "storedCorruption");
const decodeEmpty = commerceDecoder(Schema.Array(Schema.Never), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

/** The full existing graph remains physical-inverse authority. Creation admits
 * just native scalar fields and native empty inverse relation initialization. */
export function compileFulfillmentSetCreationContracts(metadata: Metadata, profile: FulfillmentPhysicalProfile = "standalone") {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentLifecycleGraph(metadata, "fulfillmentSet", profile), table = graph.set;
    for (const [name, type, nullable] of [["id", "id", false], ["name", "text", false], ["type", "text", false], ["metadata", "json", true]] as const) {
      const column = table.columns.find(column => column.name === name);
      if (column === undefined || column.type !== type || column.nullable !== nullable ||
        name === "id" && (!column.primaryKey || column.options?.prefix !== "fuset"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    if (table.foreignKeys.length || table.relationships.length !== 1 || table.relationships[0]?.name !== "service_zones")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* graph.decodeSetRow(input);
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 256)
        return yield* Result.fail(commerceError("storedCorruption"));
      const identified: JsonObject & { readonly id: string } = { ...row, id: row.id };
      return identified;
    });
    const decodeRows = (input: unknown) => Result.gen(function* () {
      const result: Array<JsonObject & { readonly id: string; readonly service_zones: readonly never[] }> = [];
      for (const value of yield* decodeRowsShape(input)) {
        const { service_zones, ...scalar } = value, row = yield* decodeRow(scalar);
        const children = yield* decodeEmpty(service_zones);
        if (row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
        result.push({ ...row, service_zones: children });
      }
      return result;
    });
    const descriptors = new Map(table.relationships.map(relationship => [relationship.name, { relationship }]));
    const initializeRows = (input: unknown) => Result.gen(function* () {
      const rows: JsonObject[] = [];
      for (const value of yield* decodeRowsShape(input)) rows.push({ ...yield* decodeRow(value) });
      fillEmptyToManyRelations(rows, descriptors);
      return yield* decodeRows(rows);
    });
    const defaults: Record<string, Json> = {};
    for (const column of table.columns) if (!["id", "created_at", "updated_at", "deleted_at"].includes(column.name)) {
      if (column.defaultValue !== undefined) defaults[column.name] = column.defaultValue;
      else if (column.nullable) defaults[column.name] = null;
    }
    const Output = Schema.Array(Schema.JsonObject).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeRows(rows)) || "Expected complete native FulfillmentSet creation rows"));
    return { ...graph, entities: [...graph.entities, ...graph.referenceEntities], tables: metadata.tables, defaults, decodeRow, decodeRows, initializeRows, Output };
  });
}
