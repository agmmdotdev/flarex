import { Effect, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { decodeRelationalRowKey, type CommerceProfileState, type LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";

/** Native module messages must match the selected command's complete row facts.
 * This authenticates local delivery only; it does not grant outbox authority. */
export function salesChannelEventPolicy(descriptor: CommerceProfileState,
  deliver: LocalCommerceEventPolicy["deliver"],
): LocalCommerceEventPolicy {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = Schema.decodeUnknownEffect(Schema.Struct({
    name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.SALES_CHANNEL), object: Schema.Literal("sales_channel"),
      action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(descriptor.resources.eventIds))]) }),
  }), { onExcessProperty: "error" });
  const capture = Effect.fn("SalesChannelEvents.capture")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, descriptor.resources));
    const message = yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action: message.metadata.action })) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  return { capture, deliver,
    validate: Effect.fn("SalesChannelEvents.validate")(function* (events, rows, command, lifecycle = []) {
      if (lifecycle.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      const expected = new Set<string>();
      for (const row of rows) {
        const action = row.operation === "insert" ? CommonEvents.CREATED : row.operation === "update" ? CommonEvents.UPDATED : CommonEvents.DELETED;
        const expectedCommand = row.operation === "insert" ? "salesChannelCreate" : row.operation === "update" ? "salesChannelUpdate" : "salesChannelDelete";
        if (command !== expectedCommand || row.tableId !== "sales_channel") return yield* Effect.fail(commerceError("receiptMismatch"));
        const key = yield* decodeRelationalRowKey(descriptor.layout, row.tableId, row.keyBytes, row.codecVersion)
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const id = key.components[0];
        if (key.components.length !== 1 || id?.columnId !== "id" || typeof id.value !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
        const identity = action + ":" + id.value;
        if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
        expected.add(identity);
      }
      for (const event of events) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!expected.delete(message.metadata.action + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (expected.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}
