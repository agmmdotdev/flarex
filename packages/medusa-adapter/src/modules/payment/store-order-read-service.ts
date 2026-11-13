import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { PaymentCollection } from "@medusajs/payment/models";
import { PaymentModuleService } from "@medusajs/payment/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { prepareIdReadRepository } from "../../repository/id-read";
import { ScalarId, ScalarIdRead } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { defineWorkflowModule } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { capturePaymentMetadata } from "./schema";
import { definePaymentPersistenceModule } from "./module";

const Read = Schema.Struct({ ...ScalarIdRead.fields, filters: Schema.optionalKey(Schema.Struct({
  id: Schema.optionalKey(Schema.Union([ScalarId, Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(200))])),
})) });
const decodeRead = commerceDecoder(Read, "invalidInput");

/** Fifty Store Orders may each reference four genuine Payment Collections.
 * This read-only profile grants no Session or provider lifecycle capability. */
export const makeStoreOrderPaymentReadCommands = Effect.fn("Payment.storeOrderRead")(function* (logger: Logger) {
  const metadata = yield* capturePaymentMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const table = metadata.frame.tables.find(table => table.name === "payment_collection");
    if (table === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const name = "paymentCollectionCountForStoreOrders";
    const prepared = yield* prepareIdReadRepository(table, "PaymentCollection", [table], new Map(), [], name,
      { hasManyPaths: [], decodeRead, maximumRows: 200 });
    const module = yield* definePaymentPersistenceModule({ name: "flarex-payment-store-order-read", profile: "payment.store-order-read",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, events: bound.mutationEvents, eventBus,
          repository: model => model === PaymentCollection ? bound.repository : bound.denied };
      }, service: native => ({ listAndCountPaymentCollections: native.listAndCountPaymentCollections.bind(native) }),
    }, logger).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const count = commerceServiceCommands(module.use).read(name, commerceCommandPreparation("PaymentStoreOrder.prepare")(decodeRead),
      ({ service, context }, input) => {
        const { select, relations, ...configuration } = input.config ?? {};
        return service.listAndCountPaymentCollections(input.filters ?? {}, { ...configuration,
          ...(select === undefined ? {} : { select: [...select] }),
          ...(relations === undefined ? {} : { relations: [...relations] }),
        }, context);
      });
    const joiner = PaymentModuleService.prototype.__joinerConfig();
    const graph = yield* withNativeGraphMetadata({ aliases: (yield* moduleAliases(joiner)).filter(alias => alias.model === "PaymentCollection"),
      reads: [{ model: "PaymentCollection", command: count, table: prepared.table, paths: [],
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, [joiner], metadata.frame.tables);
    const workflow = yield* defineWorkflowModule({ name: Modules.PAYMENT, source: module.description, methods: {}, graph,
      logical: { ...prepared.policy, commands: [count] } });
    return { workflow, commands: [count], count, prepared };
  }));
});
