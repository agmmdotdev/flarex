import { Effect, Result, Schema } from "effect";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileRowProjection } from "../../value/complete-row";
import { NativePreimageConfig } from "../../workflow/preimage";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { FulfillmentCreationId, captureFulfillmentBusinessDates, type compileFulfillmentCreationContracts } from "./fulfillment-create-input";

const Text = Schema.optionalKey(Schema.String);
const Managed = { created_at: Text, updated_at: Text, deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)) };
/** Native retained projections and existing-label normalization are internal
 * module inputs. The shipment root separately admits only complete new labels. */
export const FulfillmentShipmentLabel = Schema.Struct({ id: Schema.optionalKey(FulfillmentCreationId), tracking_number: Text,
  tracking_url: Text, label_url: Text, fulfillment_id: Schema.optionalKey(FulfillmentCreationId), ...Managed });
export const FulfillmentShipmentUpdate = Schema.Struct({ shipped_at: Schema.NullOr(Schema.String),
  marked_shipped_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
  labels: Schema.optionalKey(Schema.NullOr(Schema.Array(FulfillmentShipmentLabel).pipe(Schema.mutable).check(Schema.isMaxLength(4)))) });
export const FulfillmentShipmentRead = Schema.Struct({ id: FulfillmentCreationId, config: Schema.optionalKey(NativePreimageConfig) });
export const FulfillmentDeliveryUpdate = Schema.Struct({ delivered_at: Schema.NullOr(Schema.String) });
export const FulfillmentDeliveryList = Schema.Struct({ filters: Schema.Struct({ id: Schema.Array(FulfillmentCreationId).check(Schema.isLengthBetween(1, 1)) }),
  config: Schema.Struct({ select: Schema.Array(Schema.Literals(["id", "delivered_at", "canceled_at"])).check(Schema.isLengthBetween(1, 3)),
    relations: Schema.Array(Schema.Never).check(Schema.isMaxLength(0)), order: Schema.Struct({ id: Schema.Literal("ASC") }) }) });
export const decodeFulfillmentDeliveryList = commerceDecoder(FulfillmentDeliveryList, "unsupportedProfile");
const decodeUpdate = commerceDecoder(Schema.Union([FulfillmentShipmentUpdate, FulfillmentDeliveryUpdate]), "invalidInput");
const decodeUpdateInput = commerceDecoder(Schema.Struct({ id: FulfillmentCreationId, update: Schema.Unknown }), "invalidInput");
export const decodeFulfillmentShipmentRead = commerceDecoder(FulfillmentShipmentRead, "invalidInput");
export const decodeFulfillmentShipmentUpdate = (input: unknown) => captureFulfillmentBusinessDates(input).pipe(Result.flatMap(decodeUpdate));
export const decodeFulfillmentShipmentCommand = (input: unknown) => Result.gen(function* () {
  const value = yield* decodeUpdateInput(input);
  return { id: value.id, update: yield* decodeFulfillmentShipmentUpdate(value.update) };
});
type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentCreationContracts>>;

export function compileFulfillmentShipmentContracts(contracts: Contracts) {
  return Result.gen(function* () {
    const location = contracts.fulfillment.table.columns.find(column => column.name === "location_id");
    if (location?.type !== "text" || location.nullable) return yield* Result.fail(commerceError("unsupportedProfile"));
    const rootProjection = yield* compileRowProjection(contracts.fulfillment.table), labelProjection = yield* compileRowProjection(contracts.label.table),
      itemProjection = yield* compileRowProjection(contracts.item.table);
    const objects = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption"),
      object = commerceDecoder(Schema.JsonObject, "storedCorruption"), reference = commerceDecoder(Schema.NullOr(Schema.Struct({ id: FulfillmentCreationId })), "storedCorruption");
    const decodePreimage = (input: unknown) => Result.gen(function* () {
      const value = yield* object(input);
      const { labels, items, provider, shipping_option, delivery_address, ...scalar } = value;
      const root = yield* rootProjection(scalar);
      if (typeof root.id !== "string" || root.id.length === 0 || root.deleted_at !== undefined && root.deleted_at !== null)
        return yield* Result.fail(commerceError("storedCorruption"));
      for (const value of [provider, shipping_option, delivery_address]) if (value !== undefined) yield* reference(value);
      for (const [children, decode] of [[labels, labelProjection], [items, itemProjection]] as const) {
        if (children === undefined) continue;
        const seen = new Set<Json>();
        for (const child of yield* objects(children)) {
          const row = yield* decode(child);
          if (typeof row.id !== "string" || seen.has(row.id) || row.fulfillment_id !== undefined && row.fulfillment_id !== root.id ||
            row.deleted_at !== undefined && row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
          seen.add(row.id);
        }
      }
      return value;
    });
    const serialize = Effect.fn("FulfillmentShipment.serialize")(function* (input: Json) {
      const rows = Array.isArray(input) ? input : [input], output: JsonObject[] = [];
      for (const value of rows) {
        if (!isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
        // location_id is a required checked native root column. Projected
        // workflow reads may omit it; full create/cancel outputs cannot.
        if (Object.hasOwn(value, "location_id")) {
          const serialized = yield* contracts.serialize(value);
          if (!isJsonObject(serialized)) return yield* Effect.fail(commerceError("storedCorruption"));
          output.push(serialized);
        } else {
          const projected = { ...value };
          if (Array.isArray(projected.items)) projected.items = yield* projectExactNumericColumns(projected.items, [{ name: "quantity" }], "reserialize");
          output.push(yield* Effect.fromResult(decodePreimage(projected)));
        }
      }
      return Array.isArray(input) ? output : output[0]!;
    });
    return { decodePreimage, serialize };
  });
}
