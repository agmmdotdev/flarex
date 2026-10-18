import { Effect, Result, Schema } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileCompleteRow } from "../../value/complete-row";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import type { CommerceRelation, CommerceRelations } from "../../query/relations";
import type { captureFulfillmentCreationMetadata } from "./shipping-profile-schema";

export const FulfillmentCreationId = Schema.String.check(Schema.isLengthBetween(1, 256));
const Text = Schema.optionalKey(Schema.NullOr(Schema.String));
const JsonData = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
const BusinessDate = Schema.optionalKey(Schema.NullOr(Schema.String));
export const FulfillmentCreationAddress = Schema.Struct({ company: Text, first_name: Text, last_name: Text,
  address_1: Text, address_2: Text, city: Text, country_code: Text, province: Text, postal_code: Text, phone: Text, metadata: JsonData });
export const FulfillmentCreationItem = Schema.Struct({ title: Schema.String, sku: Schema.String, barcode: Schema.String,
  quantity: Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]), line_item_id: Text, inventory_item_id: Text });
export const FulfillmentCreationLabel = Schema.Struct({ tracking_number: Schema.String, tracking_url: Schema.String, label_url: Schema.String });
export const FulfillmentCreate = Schema.Struct({ location_id: FulfillmentCreationId, provider_id: FulfillmentCreationId,
  shipping_option_id: Schema.optionalKey(Schema.NullOr(FulfillmentCreationId)),
  delivery_address: Schema.optionalKey(Schema.NullOr(FulfillmentCreationAddress)),
  items: Schema.NullOr(Schema.Array(FulfillmentCreationItem).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  labels: Schema.optionalKey(Schema.Array(FulfillmentCreationLabel).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  data: JsonData, metadata: JsonData, requires_shipping: Schema.optionalKey(Schema.Boolean),
  packed_at: BusinessDate, shipped_at: BusinessDate, delivered_at: BusinessDate, canceled_at: BusinessDate,
  marked_shipped_by: Text, created_by: Text,
  // Native strips order before DAL creation. Location is provider context from
  // the singleton workflow Query; neither field is a persistence column.
  order: Schema.optionalKey(Schema.JsonObject), location: Schema.optionalKey(Schema.JsonObject),
});
export const decodeFulfillmentCreate = commerceDecoder(FulfillmentCreate, "invalidInput");
export const decodeFulfillmentCancellationId = commerceDecoder(FulfillmentCreationId, "invalidInput");
export const FulfillmentProviderUpdate = Schema.Struct({ id: FulfillmentCreationId,
  data: Schema.Record(Schema.String, Schema.Never), labels: Schema.Array(Schema.Never) });
export const FulfillmentCancellationUpdate = Schema.Struct({ id: FulfillmentCreationId, canceled_at: Schema.String });
export const decodeFulfillmentNativeUpdate = commerceDecoder(Schema.Union([FulfillmentProviderUpdate, FulfillmentCancellationUpdate]), "unsupportedProfile");
const decodeObjects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeObject = commerceDecoder(Schema.JsonObject, "storedCorruption");
const decodeReference = commerceDecoder(Schema.NullOr(Schema.Struct({ id: FulfillmentCreationId })), "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureFulfillmentCreationMetadata>>["frame"];

/** Checked native DML owns every persisted scalar, default, FK and quantity. */
export function compileFulfillmentCreationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    if (metadata.tables.length !== 12) return yield* Result.fail(commerceError("unsupportedProfile"));
    const entities = [];
    for (const [name, model, maximum] of [["fulfillment_address", "FulfillmentAddress", 1], ["fulfillment", "Fulfillment", 1],
      ["fulfillment_label", "FulfillmentLabel", 4], ["fulfillment_item", "FulfillmentItem", 4],
      ["fulfillment_provider", "FulfillmentProvider", 1], ["shipping_option", "ShippingOption", 1]] as const) {
      const table = metadata.tables.find(table => table.name === name);
      if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table, model, maximum, decodeRow: yield* compileCompleteRow(table) });
    }
    const [address, fulfillment, label, item, provider, option] = entities;
    if (!address || !fulfillment || !label || !item || !provider || !option ||
      fulfillment.table.cascades.delete.join(",") !== "delivery_address,items,labels") return yield* Result.fail(commerceError("unsupportedProfile"));
    const one = (name: string, target: typeof address, foreignKey: string): Result.Result<CommerceRelation, ReturnType<typeof commerceError>> => {
      const relation = fulfillment.table.relationships.find(value => value.name === name);
      return relation !== undefined && ["hasOneWithFK", "belongsTo"].includes(relation.type) &&
        fulfillment.table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === foreignKey && key.referencedTable === target.table.name && key.referencedColumns[0] === "id")
        ? Result.succeed({ name, targetTable: target.table.name, targetPrimaryKeys: ["id"], sourcePrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: [foreignKey] } })
        : Result.fail(commerceError("unsupportedProfile"));
    };
    const relations = new Map<string, CommerceRelation>();
    for (const [name, target, foreignKey] of [["delivery_address", address, "delivery_address_id"], ["provider", provider, "provider_id"], ["shipping_option", option, "shipping_option_id"]] as const)
      relations.set(name, yield* one(name, target, foreignKey));
    for (const [name, target] of [["items", item], ["labels", label]] as const) {
      const relation = describeToManyRelation(fulfillment.table, name, metadata.tables);
      if (relation?.join.type !== "hasMany" || relation.targetTable !== target.table.name || relation.join.foreignKeys[0] !== "fulfillment_id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      relations.set(name, relation);
    }
    const queryRelations: CommerceRelations = new Map([[fulfillment.table.name, relations]]);
    const referenceFields = [{ name: "provider", column: "provider_id", entity: provider },
      { name: "shipping_option", column: "shipping_option_id", entity: option },
      { name: "delivery_address", column: "delivery_address_id", entity: address }] as const;
    const defaults = new Map<string, JsonObject>();
    for (const entity of entities) defaults.set(entity.table.name, Object.fromEntries(entity.table.columns.flatMap(column =>
      ["id", "created_at", "updated_at", "deleted_at"].includes(column.name) ? [] :
        column.defaultValue !== undefined ? [[column.name, column.defaultValue]] : column.nullable ? [[column.name, null]] : [])));
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const value = yield* decodeObject(input);
      const { delivery_address, provider: providerValue, shipping_option, items, labels, ...scalar } = value;
      const root = yield* fulfillment.decodeRow({ shipping_option_id: null, delivery_address_id: null, ...scalar });
      if (root.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
      for (const [name, supplied, key] of [["provider", providerValue, "provider_id"], ["shipping_option", shipping_option, "shipping_option_id"]] as const) {
        if (supplied === undefined && name === "shipping_option") continue;
        const reference = yield* decodeReference(supplied);
        if ((reference?.id ?? null) !== root[key]) return yield* Result.fail(commerceError("storedCorruption"));
      }
      if (delivery_address === undefined) {
        if (root.delivery_address_id !== null) return yield* Result.fail(commerceError("storedCorruption"));
      } else if (delivery_address === null) {
        if (root.delivery_address_id !== null) return yield* Result.fail(commerceError("storedCorruption"));
      } else if (isJsonObject(delivery_address) && Object.keys(delivery_address).length === 1) {
        if ((yield* decodeReference(delivery_address))?.id !== root.delivery_address_id) return yield* Result.fail(commerceError("storedCorruption"));
      } else if ((yield* address.decodeRow(delivery_address)).id !== root.delivery_address_id) return yield* Result.fail(commerceError("storedCorruption"));
      for (const [members, entity] of [[items, item], [labels, label]] as const) {
        if (members === undefined) continue;
        const identities = new Set<Json>();
        for (const member of yield* decodeObjects(members)) {
          const row = yield* entity.decodeRow(member);
          if (identities.has(row.id ?? null) || row.fulfillment_id !== root.id || row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
          identities.add(row.id ?? null);
        }
      }
      return value;
    });
    const initialize = (root: JsonObject, rows?: ReadonlyMap<string, readonly JsonObject[]>): JsonObject => ({ ...root,
      provider: root.provider_id == null ? null : { id: root.provider_id },
      ...(rows === undefined ? { shipping_option: root.shipping_option_id == null ? null : { id: root.shipping_option_id },
        delivery_address: root.delivery_address_id == null ? null : { id: root.delivery_address_id } }
        : { delivery_address: rows.get(address.table.name)?.find(value => value.id === root.delivery_address_id) ?? null,
          items: [...rows.get(item.table.name) ?? []], labels: [...rows.get(label.table.name) ?? []] }),
    });
    const initializeCreation = (root: JsonObject, rows: ReadonlyMap<string, readonly JsonObject[]>, input: Result.Result.Success<ReturnType<typeof decodeFulfillmentCreate>>) => {
      const result = { ...initialize(root, rows) };
      if (input.shipping_option_id === undefined) delete result.shipping_option_id;
      if (input.delivery_address == null) { delete result.delivery_address; delete result.delivery_address_id; }
      return result;
    };
    // Native MikroORM scalar reads auto-join owning references with the target
    // soft-delete filter. A hidden target masks the DTO FK, never the stored FK.
    const initializeRead = (root: JsonObject, populated: JsonObject): JsonObject => {
      const result = { ...root };
      for (const field of referenceFields) {
        const target = populated[field.name] ?? null, id = isJsonObject(target) && typeof target.id === "string" ? target.id : null;
        result[field.column] = id; result[field.name] = id === null ? null : { id };
      }
      return result;
    };
    const serialize = Effect.fn("FulfillmentCreation.serialize")(function* (input: Json) {
      const values = Array.isArray(input) ? input : [input], output: JsonObject[] = [];
      for (const value of values) {
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
        const projected = { ...value };
        if (Array.isArray(projected.items)) projected.items = yield* projectExactNumericColumns(projected.items, [{ name: "quantity" }], "reserialize");
        output.push(yield* Effect.fromResult(decodeOutput(projected)));
      }
      return Array.isArray(input) ? output : output[0]!;
    });
    return { tables: metadata.tables, entities, address, fulfillment, label, item, provider, option, queryRelations, referenceFields,
      defaults, decodeOutput, initialize, initializeCreation, initializeRead, serialize };
  });
}

/** Only native-generated business dates cross this foreign DAL boundary.
 * Copy own data without evaluating getters; managed fields stay unadmitted. */
export function captureFulfillmentBusinessDates(input: unknown) {
  return Result.gen(function* () {
    const values = yield* Result.try({ try: () => {
      if (input === null || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return undefined;
      return Object.getOwnPropertyDescriptors(input);
    }, catch: cause => commerceError("invalidInput", cause) });
    if (values === undefined) return yield* Result.fail(commerceError("invalidInput"));
    const output: Record<string, unknown> = {};
    for (const name of Reflect.ownKeys(values)) {
      const descriptor = typeof name === "string" ? values[name] : undefined;
      if (typeof name !== "string" || !descriptor || !("value" in descriptor) || !descriptor.enumerable) return yield* Result.fail(commerceError("invalidInput"));
      output[name] = ["packed_at", "shipped_at", "delivered_at", "canceled_at"].includes(name) && descriptor.value instanceof Date
        ? yield* Result.try({ try: () => Date.prototype.toISOString.call(descriptor.value), catch: cause => commerceError("invalidInput", cause) }) : descriptor.value;
    }
    return yield* captureCommerceInput(output);
  });
}
