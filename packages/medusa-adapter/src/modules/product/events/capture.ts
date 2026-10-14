import { moduleEventDecoder } from "../../../module/events";
import { Effect, Schema } from "effect";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";

export const EventId = Schema.String.check(Schema.isLengthBetween(1, 256));

const messageSchema = (maximumIds: number) => Schema.Struct({
  name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRODUCT), object: Schema.String, action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  // The pinned subscriber emits scalar IDs; service bulk operations can retain
  // an ID array. Preserve both message forms without regrouping them.
  data: Schema.Struct({ id: Schema.Union([EventId, Schema.Array(EventId).check(Schema.isMinLength(1), Schema.isMaxLength(maximumIds))]) }),
});

/** Adapter-owned capture and fact validation, shared by local delivery and
 * durable workflow publication. Neither consumer invents a dummy destination. */
export function productModuleEventCapture(catalog: ProductRuntimeMetadata, resources: CommerceResources) {
  const decode = moduleEventDecoder(messageSchema(resources.eventIds), resources);
  const capture = Effect.fn("ProductEvents.capture")(function* (input: unknown) {
    const message = yield* decode(input);
    const candidates = catalog.entities.filter(entity => entity !== catalog.assignment);
    if (!candidates.some(entity => entity.eventObject === message.metadata.object &&
      (message.metadata.action === CommonEvents.CREATED ? entity.createdEvent : message.metadata.action === CommonEvents.UPDATED ? entity.updatedEvent : message.metadata.action === CommonEvents.RESTORED ? entity.restoredEvent : entity.deletedEvent) === message.name)) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  return capture;
}
