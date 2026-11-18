import { Effect, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literal("inventory_level"),
    action: Schema.Literals(["created", "updated", "deleted", "restored"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
}), defaultCommerceResources);

/** Native Level event grammar is shared by publication admission and receipt
 * comparison. Command policies retain their own allowed action sets. */
export const captureInventoryLevelEvent = Effect.fn("InventoryLevel.captureEvent")(function* (input: unknown) {
  const message = yield* decodeEvent(input);
  if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: message.metadata.action }))
    return yield* Effect.fail(commerceError("unadmittedEvent"));
  return message;
});
