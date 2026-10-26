import { Effect, Result, Schema } from "effect";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { jsonEqual } from "flarex-protocol/json";
import { OrderPaymentCollection } from "@medusajs/link-modules";
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
import { captureOrderPaymentCollectionLinkMetadata } from "./order-payment-collection-schema";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { projectNativeRow } from "../repository/result";
import { projectRows } from "../query/projection";
import { compileCompleteRow } from "../value/complete-row";
import { captureCommerceInput } from "../value/input";

const Filter = Schema.Union([Id, Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4))]);
const decodeRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({
  id: Schema.optionalKey(Filter), order_id: Schema.optionalKey(Filter), payment_collection_id: Schema.optionalKey(Filter),
})), config: Schema.optionalKey(Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.Never).pipe(Schema.mutable)),
  skip: Schema.optionalKey(Schema.Literal(0)), take: Schema.optionalKey(Schema.Literals([4, 15, 256])),
  order: Schema.optionalKey(Schema.Struct({ order_id: Schema.optionalKey(Schema.Literal("ASC")) })),
})) }), "invalidInput");

/** Genuine stored Module Link reads. Payment workflows receive no Link create,
 * cascade or dismissal capability; installed rows remain authoritative. */
export const prepareOrderPaymentCollectionLinkRead = Effect.fn("OrderPaymentCollectionLink.prepareRead")(function* () {
  const metadata = yield* captureOrderPaymentCollectionLinkMetadata(), prepared = yield* prepareLinkService(metadata);
  const prepare = commerceCommandPreparation("OrderPaymentCollectionLink.prepareInput")(decodeRead);
  const count = defineGraphReadCommand("orderPaymentCollectionCount", Effect.fn("OrderPaymentCollectionLink.count")(function* (ctx: CommerceCommandContext, input: Json) {
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
    { path: "order", maximumSources: 4, maximumTargets: 4 },
    { path: "payment_collection", maximumSources: 4, maximumTargets: 4 },
  ]));
  const remotePaths = [
    ...(yield* Effect.fromResult(nativeLinkGraphPaths(prepared.joiner, [
      { root: "Order", path: "payment_collections", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 4 },
      { root: "PaymentCollection", path: "order", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 },
    ], undefined, [OrderPaymentCollection]))),
    // Native batch refunds start at Payment and traverse its checked local
    // collection before this genuine stored Link. Metadata owns both joins.
    ...(yield* Effect.fromResult(nativeLinkGraphPaths(prepared.joiner, [
      { root: "Payment", path: "payment_collection.order", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 },
    ], "PaymentCollection", [OrderPaymentCollection]))),
  ];
  const basePolicy = linkLogicalEventPolicy(metadata.frame.name, prepared.serviceName, prepared.entityName, ["order_id", "payment_collection_id"]);
  const complete = yield* Effect.fromResult(compileCompleteRow(metadata.frame));
  const encoder = new TextEncoder();
  const compareText = (left: string, right: string) => compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
  const compareEndpoints = (left: JsonObject, right: JsonObject) => compareText(String(left.order_id), String(right.order_id)) ||
    compareText(String(left.payment_collection_id), String(right.payment_collection_id));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("OrderPaymentCollectionLink.validateRead")(function* (call, activity) {
    yield* basePolicy.validateLogicalCall(call, activity);
    if (call.commandName !== "orderPaymentCollectionCount" || call.mode !== "read")
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const args = yield* Effect.fromResult(decodeRead(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const plan = yield* Effect.fromResult(captureCommerceInput(buildQuery(args.filters, {
      ...args.config,
      take: args.config?.take ?? 4,
      ...(args.config?.select === undefined ? {} : { select: [...args.config.select] }),
      ...(args.config?.relations === undefined ? {} : { relations: [...args.config.relations] }),
    })).pipe(Result.flatMap(query => prepared.prepared.readPlan(query, defaultCommerceResources.queryRows))))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (activity.relationalReads.length !== 2 || activity.relationalReads.some(read => read.table !== metadata.frame.name ||
      !jsonEqual(read.query, plan.query) || read.total > 4 || read.returned !== read.total))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = new Map<string, JsonObject>();
    for (const item of activity.observedRows) {
      if (item.table !== metadata.frame.name) return yield* Effect.fail(commerceError("receiptMismatch"));
      const row = yield* Effect.fromResult(complete(projectNativeRow(item.row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const key = JSON.stringify([row.order_id, row.payment_collection_id]);
      if (observed.has(key)) return yield* Effect.fail(commerceError("receiptMismatch"));
      observed.set(key, row);
    }
    const selected = [...observed.values()].filter(row => row.deleted_at === null &&
      (["id", "order_id", "payment_collection_id"] as const).every(name => {
        const filter = args.filters?.[name], value = row[name];
        return filter === undefined || typeof value === "string" && (typeof filter === "string" ? filter === value : filter.includes(value));
      }));
    const [rows, total] = yield* Effect.fromResult(decodeGraphCount(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const expected = yield* Effect.fromResult(projectRows(selected, plan.projection.node)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    // This Link ABI orders by Order only, with no promised order among equal
    // Orders. Authenticate the complete endpoint/body set and that primary
    // ordering without inventing a secondary native ordering obligation.
    if (selected.length > 4 || total !== selected.length || rows.length !== total ||
      activity.relationalReads.some(read => read.total !== total) ||
      rows.some((row, index) => typeof row.order_id !== "string" || index > 0 &&
        compareText(String(rows[index - 1]?.order_id), row.order_id) > 0) ||
      !jsonEqual([...rows].sort(compareEndpoints), [...expected].sort(compareEndpoints)))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  const policy = { capture: basePolicy.capture, validateLogicalCall };
  const commands = [count];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "order_payment_collection_links",
    source: { name: prepared.serviceName, profile: "order-payment-collection-read" }, methods: {},
    graph: { aliases, services: yield* Effect.fromResult(nativeLinkGraphServices(prepared.joiner)),
      reads: [{ model, command: count, table: prepared.prepared.table, paths: [], orderable: ["order_id"], uniqueOrder: [], multipleOrder: false, decode: decodeGraphCount }],
      linkEndpoints: endpoints, remotePaths }, logical: { ...policy, commands } }));
  return { prepared, workflow, count, commands, logicalEventPolicy: () => policy };
});
