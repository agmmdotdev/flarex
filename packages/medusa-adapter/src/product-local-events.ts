import { Effect, Schema } from "effect";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceDecoder } from "./commerce-decoder";

export const decodeLocalEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
export const decodeLocalEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");

const Message = Schema.Struct({
  name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRODUCT), object: Schema.String, action: Schema.Literal(CommonEvents.CREATED) }),
  data: Schema.Struct({ id: Schema.String.check(Schema.isLengthBetween(1, 256)) }),
});
const decode = Schema.decodeUnknownEffect(Message, { onExcessProperty: "error" });
const captureMessage = Effect.fn("ProductEvents.capture")(function* (catalog: ProductRuntimeMetadata, input: unknown) {
  const value = yield* Effect.fromResult(captureCommerceInput(input));
  const message = yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
  if (!catalog.entities.some(entity => entity.eventObject === message.metadata.object && entity.createdEvent === message.name)) return yield* Effect.fail(commerceError("unadmittedEvent"));
  return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
});

/** Adapter-owned message contract; core supplies unforgeable row observations.
 * The destination is explicitly local and receives no transaction manager. */
export function productLocalEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata,
  deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>,
): LocalCommerceEventPolicy {
  const capture = (input: unknown) => captureMessage(catalog, input);
  return { capture, deliver,
    validate: Effect.fn("ProductEvents.validate")(function* (events, rows) {
      const expected = new Set<string>();
      for (const row of rows) {
        if (row.operation !== "insert") return yield* Effect.fail(commerceError("unadmittedEvent"));
        const key = yield* decodeRelationalRowKey(descriptor.layout, row.tableId, row.keyBytes, row.codecVersion)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (catalog.writablePivots.some(table => table.name === row.tableId)) continue;
        const object = catalog.entities.find(entity => entity.table.name === row.tableId);
        const id = key.components[0];
        if (object === undefined || key.components.length !== 1 || id?.columnId !== "id" || typeof id.value !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        const identity = object.eventObject + ":" + id.value;
        if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      for (const event of events) {
        const message = yield* capture(event);
        const identity = message.metadata.object + ":" + message.data.id;
        if (!expected.delete(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}
