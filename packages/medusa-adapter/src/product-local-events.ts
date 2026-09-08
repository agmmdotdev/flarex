import { Effect, Schema } from "effect";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, commerceLimits, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceDecoder } from "./commerce-decoder";

export const decodeLocalEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
export const decodeLocalEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");

const EventId = Schema.String.check(Schema.isLengthBetween(1, 256));
const Message = Schema.Struct({
  name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRODUCT), object: Schema.String, action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED]) }),
  // The pinned moduleEventBuilderFactory preserves a bulk operation as one
  // message whose data.id contains every entity ID.
  data: Schema.Struct({ id: Schema.Union([EventId, Schema.Array(EventId).check(Schema.isMinLength(1), Schema.isMaxLength(commerceLimits.catalogRows))]) }),
});
const decode = Schema.decodeUnknownEffect(Message, { onExcessProperty: "error" });
const captureMessage = Effect.fn("ProductEvents.capture")(function* (catalog: ProductRuntimeMetadata, input: unknown) {
  const value = yield* Effect.fromResult(captureCommerceInput(input));
  const message = yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
  const candidates = catalog.entities.filter(entity => entity !== catalog.assignment);
  if (!candidates.some(entity => entity.eventObject === message.metadata.object &&
    (message.metadata.action === CommonEvents.CREATED ? entity.createdEvent : message.metadata.action === CommonEvents.UPDATED ? entity.updatedEvent : entity.deletedEvent) === message.name)) return yield* Effect.fail(commerceError("unadmittedEvent"));
  return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
});

/** Adapter-owned message contract; core supplies unforgeable row observations.
 * The destination is explicitly local and receives no transaction manager. */
export function productLocalEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata,
  deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>,
): LocalCommerceEventPolicy {
  const capture = (input: unknown) => captureMessage(catalog, input);
  return { capture, deliver,
    validate: Effect.fn("ProductEvents.validate")(function* (events, rows, commandName) {
      const expected = new Set<string>();
      for (const row of rows) {
        const key = yield* decodeRelationalRowKey(descriptor.layout, row.tableId, row.keyBytes, row.codecVersion)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if ((row.operation === "insert" || row.operation === "delete") && catalog.writablePivots.some(table => table.name === row.tableId)) continue;
        const object = catalog.entities.find(entity => entity.table.name === row.tableId);
        const id = key.components[0];
        if (object === undefined || key.components.length !== 1 || id?.columnId !== "id" || typeof id.value !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        if (object === catalog.assignment) {
          if (row.operation !== "insert" || commandName !== "productCreateassignment") return yield* Effect.fail(commerceError("unadmittedEvent"));
          continue;
        }
        const identity = (row.operation === "insert" ? CommonEvents.CREATED : row.operation === "update" ? CommonEvents.UPDATED : CommonEvents.DELETED) + ":" + object.eventObject + ":" + id.value;
        if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      for (const event of events) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          const identity = message.metadata.action + ":" + message.metadata.object + ":" + id;
          if (!expected.delete(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}
