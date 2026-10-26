import { Effect, Schema, type Result } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { ScalarId } from "../../repository/scalar-id-read";
import type { prepareOrderFinanceRepository } from "./finance-repository";

const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.ORDER), object: Schema.String,
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);

/** Native mutation events are confined to the checked financial model closure.
 * Receipt policies separately bind their exact identities and mutation order. */
export const orderFinanceEventCapture = (prepared: Result.Result.Success<ReturnType<typeof prepareOrderFinanceRepository>>) =>
  Effect.fn("OrderFinance.captureEvent")(function* (input: unknown) {
    const event = yield* decode(input);
    yield* Effect.fromResult(prepared.contracts.entity(event.metadata.object));
    if (event.name !== buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: event.metadata.object, action: event.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return event;
  });
