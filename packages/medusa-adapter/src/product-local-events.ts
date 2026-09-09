import { Effect, Schema } from "effect";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceDecoder } from "./commerce-decoder";

export const decodeLocalEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
export const decodeLocalEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");

const EventId = Schema.String.check(Schema.isLengthBetween(1, 256));
const messageSchema = (maximumIds: number) => Schema.Struct({
  name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRODUCT), object: Schema.String, action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  // The pinned subscriber emits scalar IDs; service bulk operations can retain
  // an ID array. Preserve both message forms without regrouping them.
  data: Schema.Struct({ id: Schema.Union([EventId, Schema.Array(EventId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumIds))]) }),
});


/** Adapter-owned message contract; core supplies unforgeable row observations.
 * The destination is explicitly local and receives no transaction manager. */
export function productLocalEventPolicy(descriptor: CommerceProfileState, catalog: ProductRuntimeMetadata,
  deliver: (events: readonly Json[]) => Effect.Effect<void, CommerceTransactionError>,
): LocalCommerceEventPolicy {
  const decode = Schema.decodeUnknownEffect(messageSchema(descriptor.resources.eventIds), { onExcessProperty: "error" });
  const capture = Effect.fn("ProductEvents.capture")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, descriptor.resources));
    const message = yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    const candidates = catalog.entities.filter(entity => entity !== catalog.assignment);
    if (!candidates.some(entity => entity.eventObject === message.metadata.object &&
      (message.metadata.action === CommonEvents.CREATED ? entity.createdEvent : message.metadata.action === CommonEvents.UPDATED ? entity.updatedEvent : message.metadata.action === CommonEvents.RESTORED ? entity.restoredEvent : entity.deletedEvent) === message.name)) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  return { capture, deliver,
    validate: Effect.fn("ProductEvents.validate")(function* (events, rows, commandName, lifecycle = []) {
      const expected = new Set<string>();
      const observations = new Map<string, typeof lifecycle[number]>();
      for (const observation of lifecycle) {
        const key = yield* decodeRelationalRowKey(descriptor.layout, observation.tableId, observation.keyBytes, 1)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const id = key.components[0]?.value;
        if (key.components.length !== 1 || typeof id !== "string" ||
          !(commandName === (observation.operation === "restore" ? "productRestore" : "productSoftDelete") || (commandName === "productSoftDeleteVariant" && observation.operation === "softDelete" && observation.tableId === catalog.variant.table.name)) ||
          (observation.operation === "restore" ? observation.afterDeletedAt !== null : observation.afterDeletedAt === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
        const identity = observation.tableId + ":" + id;
        if (observations.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        observations.set(identity, observation);
      }
      for (const row of rows) {
        const key = yield* decodeRelationalRowKey(descriptor.layout, row.tableId, row.keyBytes, row.codecVersion)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if ((row.operation === "insert" || row.operation === "delete") && catalog.writablePivots.some(table => table.name === row.tableId)) continue;
        const object = catalog.entities.find(entity => entity.table.name === row.tableId);
        const id = key.components[0];
        if (object === undefined || key.components.length !== 1 || id?.columnId !== "id" || typeof id.value !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        if (object === catalog.assignment) {
          if (!((row.operation === "insert" && commandName === "productCreateassignment") || (row.operation === "delete" && ["productDeleteproduct", "productDeleteassignment"].includes(commandName)))) return yield* Effect.fail(commerceError("unadmittedEvent"));
          continue;
        }
        // The pinned physical-delete internal service dispatches only root IDs;
        // dependent removals still require complete core relational delete facts.
        if (row.operation === "delete" && commandName === "productDeleteproduct" && [catalog.option, catalog.value, catalog.variant, catalog.image].includes(object)) continue;
        if (row.operation === "delete" && commandName === "productDeleteoption" && object === catalog.value) continue;
        // Pinned reference detachment emits no Product mutation callback.
        if (row.operation === "update" && object === catalog.product && ["productDeletetype", "productDeletecollection"].includes(commandName)) continue;
        const observationKey = row.tableId + ":" + id.value;
        const observation = observations.get(observationKey);
        if (observation !== undefined && row.operation !== "update") return yield* Effect.fail(commerceError("receiptMismatch"));
        observations.delete(observationKey);
        const action = observation !== undefined ? (observation.operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED)
          : row.operation === "insert" ? CommonEvents.CREATED : row.operation === "update" ? CommonEvents.UPDATED : CommonEvents.DELETED;
        const identity = action + ":" + object.eventObject + ":" + id.value;
        // Pinned Category rank/path maintenance can update the same row several
        // times in one command; its message aggregator retains one update event.
        // Keep every core fact and authenticate that single event identity only
        // for these Category commands. Other duplicate facts remain refused.
        const categoryMaintenance = object === catalog.category && row.operation === "update" && observation === undefined &&
          ["productCreatecategory", "productupdatecategory", "productupsertcategory", "productDeletecategory"].includes(commandName);
        if (expected.has(identity) && !categoryMaintenance) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      for (const event of events) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          const identity = message.metadata.action + ":" + message.metadata.object + ":" + id;
          if (!expected.delete(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size !== 0 || observations.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}
