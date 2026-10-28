import { checkoutLinkReadPolicy } from "./checkout-link-read-receipt";
import { Effect, Result, Schema } from "effect";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { CustomerAccountHolder } from "@medusajs/link-modules";
import { commerceCommandPreparation } from "../module/commands";
import { defineGraphReadCommand } from "../local-graph/commands";
import { moduleAliases } from "../local-graph/module";
import { nativeLinkGraphEndpoints, nativeLinkGraphPaths, nativeLinkGraphServices } from "../local-graph/links";
import { decodeGraphCount } from "../local-graph/query";
import { defineWorkflowModule } from "../workflow/module";
import { commerceDecoder } from "../value/decoder";
import { ScalarId as Id } from "../repository/scalar-id-read";
import { prepareLinkService } from "./service";
import { linkLogicalEventPolicy } from "./events";
import { captureCustomerAccountHolderLinkMetadata } from "./customer-account-holder-schema";
import { captureCommerceInput } from "../value/input";

const Filter = Schema.Union([Id, Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4))]);
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  id: Schema.optionalKey(Filter), customer_id: Schema.optionalKey(Filter), account_holder_id: Schema.optionalKey(Filter),
})), config: Schema.optionalKey(Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable)),
  skip: Schema.optionalKey(Schema.Literal(0)), take: Schema.optionalKey(Schema.Literals([4, 15, 256])),
  order: Schema.optionalKey(Schema.Struct({ customer_id: Schema.optionalKey(Schema.Literal("ASC")) })),
})) }), "invalidInput");

/** Genuine Customer-AccountHolder Link supplies native account reuse. */
export const prepareCustomerAccountHolderLinkRead = Effect.fn("CustomerAccountHolderLink.prepareRead")(function* () {
  const metadata = yield* captureCustomerAccountHolderLinkMetadata(), prepared = yield* prepareLinkService(metadata);
  const prepare = commerceCommandPreparation("CustomerAccountHolderLink.prepareInput")(decodeRead);
  const count = defineGraphReadCommand("customerAccountHolderCount", Effect.fn("CustomerAccountHolderLink.count")(function* (ctx: CommerceCommandContext, input: Json) {
    const args = yield* prepare(ctx, input);
    const result = yield* prepared.useService(ctx, ({ service, context }) => service.listAndCount(args.filters,
      { ...args.config, take: args.config?.take ?? 4 }, context));
    const [rows, total] = yield* Effect.fromResult(decodeGraphCount(result))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (total > 4 || rows.length !== total) return yield* ctx.refuse(commerceError("limitExceeded"));
    return [rows, total];
  }));
  const aliases = yield* Effect.fromResult(moduleAliases(prepared.joiner)), model = aliases[0]?.model;
  if (model === undefined || aliases.some(alias => alias.model !== model)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const endpoints = yield* Effect.fromResult(nativeLinkGraphEndpoints(prepared.joiner, [
    { path: "customer", maximumSources: 4, maximumTargets: 4 },
    { path: "account_holder", maximumSources: 4, maximumTargets: 4 },
  ]));
  const remotePaths = [
    ...(yield* Effect.fromResult(nativeLinkGraphPaths(prepared.joiner, [
      { root: "Customer", path: "account_holders", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 4 },
      { root: "AccountHolder", path: "customer", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 },
    ], undefined, [CustomerAccountHolder]))),

  ];
  const basePolicy = linkLogicalEventPolicy(metadata.frame.name, prepared.serviceName, prepared.entityName, ["customer_id", "account_holder_id"]);
  const policy = yield* Effect.fromResult(checkoutLinkReadPolicy(metadata.frame, ["customer_id", "account_holder_id"], "customerAccountHolderCount",
    "CustomerAccountHolderLink.validateRead", basePolicy, input => Result.gen(function* () {
      const args = yield* decodeRead(input);
      const plan = yield* captureCommerceInput(buildQuery(args.filters, { ...args.config, take: args.config?.take ?? 4,
        ...(args.config?.select === undefined ? {} : { select: [...args.config.select] }),
        ...(args.config?.relations === undefined ? {} : { relations: [...args.config.relations] }),
      })).pipe(Result.flatMap(query => prepared.prepared.readPlan(query, defaultCommerceResources.queryRows)));
      return { plan, includes: (row: JsonObject) => row.deleted_at === null &&
        (["id", "customer_id", "account_holder_id"] as const).every(name => {
          const filter = args.filters?.[name], value = row[name];
          return filter === undefined || typeof value === "string" && (typeof filter === "string" ? filter === value : filter.includes(value));
        }) };
    })));
  const commands = [count];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "customer_account_holder_links",
    source: { name: prepared.serviceName, profile: "customer-account-holder-read" }, methods: {},
    graph: { aliases, services: yield* Effect.fromResult(nativeLinkGraphServices(prepared.joiner)),
      reads: [{ model, command: count, table: prepared.prepared.table, paths: [], orderable: ["customer_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }],
      linkEndpoints: endpoints, remotePaths }, logical: { ...policy, commands } }));
  return { metadata, prepared, workflow, count, commands, logicalEventPolicy: () => policy };
});
