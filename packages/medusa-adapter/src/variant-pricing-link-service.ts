import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import type { FindConfig } from "@medusajs/types";
import type { CommerceProfileState, LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureVariantPricingLinkMetadata } from "./product-variant-pricing-schema";
import { prepareLinkService } from "./link-service";
import { linkEventPolicy } from "./link-events";
import { withCommerceService } from "./commerce-service-bridge";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import { QueryLimit, QueryOffset } from "./query-decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";
import { PricingId as Id } from "./pricing-input";

const Ids = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(4)).pipe(Schema.mutable)]);
const Pair = Schema.Struct({ product: Schema.Struct({ variant_id: Id }), pricing: Schema.Struct({ price_set_id: Id }), data: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id) })) });
const Batch = Schema.Array(Pair).check(Schema.isMaxLength(4)).pipe(Schema.mutable);
const decodeLinks = commerceDecoder(Schema.Union([Pair, Batch]), "invalidInput");
const decodeArguments = commerceDecoder(Schema.Tuple([Batch]), "invalidInput");
const decodeCreated = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id, variant_id: Id, price_set_id: Id }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({ variant_id: Schema.optionalKey(Ids), price_set_id: Schema.optionalKey(Ids), id: Schema.optionalKey(Ids) })),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))), relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
    skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit), order: Schema.optionalKey(Schema.Struct({ variant_id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })), withDeleted: Schema.optionalKey(Schema.Boolean) })),
}), "invalidInput");
export const prepareVariantPricingLink = Effect.fn("VariantPricingLink.prepare")(function* () {
  const native = yield* prepareLinkService(yield* captureVariantPricingLinkMetadata());
  const use = (ctx: CommerceCommandContext, work: (scope: {
    readonly create: (input: unknown) => Promise<unknown>;
    readonly service: Pick<ReturnType<typeof native.bind>["service"], "listAndCount">;
    readonly context: { readonly manager: typeof ctx.manager; readonly transactionManager: typeof ctx.manager };
  }) => Promise<unknown>) => withCommerceService(ctx, owner => {
    const binding = native.bind(ctx, owner), router = new Link([binding.loaded]);
    const context = { manager: ctx.manager, transactionManager: ctx.manager };
    return { context, service: { listAndCount: binding.service.listAndCount },
      create: (input: unknown) => owner.run(binding.bound.bridge.checked(ctx, Effect.gen(function* () {
        const links = yield* Effect.fromResult(decodeLinks(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
        return yield* Effect.tryPromise({ try: signal => owner.callback(() => router.create(structuredClone(links), context), signal), catch: cause => commerceError("adapterFailure", cause) });
      }))),
    };
  }, work);
  const commands = commerceServiceCommands(use);
  const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
    Effect.fn("VariantPricingLink.command")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
  const create = commands.write("linkCreate", prepare(decodeLinks), (service, data) => service.create(data));
  const count = commands.read("linkCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCount(args.filters, args.config as FindConfig<unknown> | undefined, context));
  const graph: GraphModuleDefinition = { aliases: yield* Effect.fromResult(moduleAliases(native.joiner)), reads: [{ model: native.entityName, command: count, table: native.prepared.table, paths: [], orderable: ["variant_id"], uniqueOrder: ["variant_id"], multipleOrder: false, decode: decodeGraphCount }] };
  const method = yield* Effect.fromResult(defineWorkflowMethod({ command: create, arguments: decodeArguments, encode: ([links]) => links, output: decodeCreated, moduleEvents: [native.entityName + ".attached"] }));
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "link", source: { name: native.serviceName, profile: "medusa.variant-pricing.link-workflow" }, methods: { create: method }, graph, refusedMethods: ["dismiss", "delete", "restore", "list"] }));
  const eventPolicy = (descriptor: CommerceProfileState, deliver: LocalCommerceEventPolicy["deliver"]) => linkEventPolicy("product_variant_price_set", native.serviceName, native.entityName, descriptor, deliver);
  return { create, count, commands: [create, count], workflow, graph, eventPolicy, withService: use };
});
