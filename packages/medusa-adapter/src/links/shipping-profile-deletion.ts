import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { ProductShippingProfile, getModuleService } from "@medusajs/link-modules";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { jsonEqual } from "flarex-protocol/json";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../repository/call-receipt";
import { projectNativeRow } from "../repository/result";
import { compileCompleteRow } from "../value/complete-row";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { commerceCommandPreparation } from "../module/commands";
import { defineGraphReadCommand } from "../local-graph/commands";
import { decodeGraphCount } from "../local-graph/query";
import { moduleAliases } from "../local-graph/module";
import type { GraphModuleDefinition } from "../local-graph/model";
import { QueryLimit } from "../query/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import { captureProductShippingProfileLinkMetadata } from "./product-shipping-profile-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";
import { linkLogicalEventPolicy } from "./events";
import { compileLinkLifecycleReceipt } from "./lifecycle-receipt";
import { decodeLinkCascade } from "./cascade-result";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const Endpoint = Schema.Struct({ fulfillment: Schema.Struct({ shipping_profile_id: Ids }) });
const decodeEndpoint = commerceDecoder(Schema.Tuple([Endpoint]), "invalidInput");
const Fields = Schema.Tuple([Schema.Literal("product_id"), Schema.Literal("shipping_profile_id")]);
const Read = Schema.Struct({ filters: Schema.Struct({ shipping_profile_id: Ids }), config: Schema.Struct({
  select: Fields, relations: Schema.Array(Schema.String).check(Schema.isMaxLength(0)),
  order: Schema.Struct({ product_id: Schema.Literal("ASC") }), skip: Schema.Literal(0), take: QueryLimit,
}) });
const decodeRead = commerceDecoder(Read, "invalidInput");
const decodeReadReceipt = commerceDecoder(Read, "receiptMismatch");
const Pair = Schema.Struct({ product_id: Id, shipping_profile_id: Id });
const decodePair = commerceDecoder(Pair, "receiptMismatch");
const Rows = Schema.Array(Pair).check(Schema.isMaxLength(8));
const decodeCount = commerceDecoder(Schema.Tuple([Rows,
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 8 })),
]), "storedCorruption");
const nativeJoiner = getModuleService(ProductShippingProfile).prototype.__joinerConfig();

/** Genuine endpoint routing over the installed stored Product-ShippingProfile
 * family. The retained native selector may restore its older tombstones. */
export function prepareShippingProfileDeletionLinkResource(services: { readonly shipping: unknown }) {
  return Result.gen(function* () {
    const shipping = linkWorkflowServiceDefinition(services.shipping);
    if (shipping === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (shipping.admission !== "shipping-profile-deletions" || shipping.lifecycle.maximumRows !== 8 || shipping.lifecycle.completeHistory !== true ||
      shipping.routing.__joinerConfig.serviceName !== ProductShippingProfile.serviceName)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const actualJoiner = yield* captureCommerceInput(shipping.routing.__joinerConfig);
    const expectedJoiner = yield* captureCommerceInput(nativeJoiner);
    if (!jsonEqual(actualJoiner, expectedJoiner)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const softDelete = shipping.softDeleteMethod, restore = shipping.restoreMethod;
    if (softDelete === undefined || restore === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeMap = commerceDecoder(Schema.Struct({
      product_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
      shipping_profile_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
    }), "storedCorruption");
    const output = (value: Parameters<typeof decodeLinkCascade>[0]) => Result.gen(function* () {
      const tuple = yield* decodeLinkCascade(value);
      // The native common step does not inspect router errors-as-data. Refuse
      // before exposing success, including a service exception the router caught.
      if (tuple[0] !== null) return yield* Result.fail(commerceError("adapterFailure"));
      for (const [name, map] of Object.entries(tuple[1])) {
        if (name !== ProductShippingProfile.serviceName) return yield* Result.fail(commerceError("storedCorruption"));
        const decoded = yield* decodeMap(map);
        if (Object.keys(decoded).length !== 0 && (decoded.product_id === undefined || decoded.shipping_profile_id === undefined ||
          decoded.product_id.length !== decoded.shipping_profile_id.length)) return yield* Result.fail(commerceError("storedCorruption"));
      }
      return tuple;
    });
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.shipping-profile.deletion-links",
      services: [shipping.routing], lifecycle: shipping.lifecycle }, dependencies: [softDelete, restore],
      methods: { delete: { arguments: decodeEndpoint, output }, restore: { arguments: decodeEndpoint, output } },
      bind: invoke => {
        const loaded = { ...structuredClone(shipping.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(restore, selector, config) };
        const native = new Link([loaded]);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}

/** Separate admission never loads Product-SalesChannel or Product authority.
 * Query bounds the complete active set; both lifecycle directions bound history. */
export const prepareShippingProfileDeletionLinks = Effect.fn("ShippingProfileDeletionLinks.prepare")(function* () {
  const metadata = yield* captureProductShippingProfileLinkMetadata();
  const shipping = yield* prepareLinkService(metadata, 8, true);
  const native = yield* Effect.fromResult(prepareLinkWorkflowService(shipping, "shippingProfileProductLink", "shipping-profile-deletions"));
  const softDelete = native.softDeleteMethod, restore = native.restoreMethod;
  const softDeleteCommand = native.softDelete, restoreCommand = native.restore;
  const softDeleteName = native.softDeleteName, restoreName = native.restoreName;
  const returnLinkableKeys = shipping.routing.__joinerConfig.primaryKeys;
  if (softDelete === undefined || restore === undefined || softDeleteCommand === undefined || restoreCommand === undefined ||
    softDeleteName === undefined || restoreName === undefined || returnLinkableKeys === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const prepare = commerceCommandPreparation("ShippingProfileDeletionLinks.prepareRead");
  const countName = "shippingProfileProductLinkCount";
  const count = defineGraphReadCommand(countName, Effect.fn("ShippingProfileDeletionLinks.count")(function* (ctx: CommerceCommandContext, input: Json) {
    const args = yield* prepare(decodeRead)(ctx, input);
    const result = yield* shipping.useService(ctx, ({ service, context }) => service.listAndCount(args.filters, {
      ...args.config, select: [...args.config.select], relations: [...args.config.relations],
    }, context));
    const [rows, total] = yield* Effect.fromResult(decodeGraphCount(result)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (total > 8 || rows.length !== total) return yield* ctx.refuse(commerceError("limitExceeded"));
    return yield* Effect.fromResult(decodeCount([rows, total])).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
  }));
  const graph: GraphModuleDefinition = { aliases: yield* Effect.fromResult(moduleAliases(shipping.joiner)), reads: [{
    model: shipping.entityName, command: count, table: shipping.prepared.table, paths: [], orderable: ["product_id"],
    uniqueOrder: [], multipleOrder: false, decode: decodeCount,
  }] };
  const complete = yield* Effect.fromResult(compileCompleteRow(metadata.frame));
  const validateLifecycle = yield* Effect.fromResult(compileLinkLifecycleReceipt({ table: metadata.frame,
    endpoints: ["product_id", "shipping_profile_id"], returnLinkableKeys, maximumEndpoints: 4, maximumRows: 8,
    softDeleteCommand: softDeleteName, restoreCommand: restoreName, selectionPlan: shipping.prepared.lifecycleReadPlan }));
  const basePolicy = linkLogicalEventPolicy(shipping.prepared.table.name, shipping.serviceName, shipping.entityName,
    ["product_id", "shipping_profile_id"], [native.createName], [], [softDeleteName], [restoreName]);
  const encoder = new TextEncoder();
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ShippingProfileDeletionLinks.validateCall")(function* (call, activity) {
    if (call.commandName === softDeleteName || call.commandName === restoreName) yield* validateLifecycle(call, activity);
    if (call.commandName === countName) {
      const args = yield* Effect.fromResult(decodeReadReceipt(call.input));
      const nativeQuery = yield* Effect.fromResult(captureCommerceInput(buildQuery(args.filters, {
        ...args.config, select: [...args.config.select], relations: [...args.config.relations],
      })));
      const plan = yield* Effect.fromResult(shipping.prepared.readPlan(nativeQuery, args.config.take));
      // The same shared compiler owns real DAL execution and this pure expected
      // query. Body observations alone cannot prove a genuine empty selection.
      if (activity.relationalReads.length !== 2 || activity.relationalReads.some(read =>
        read.table !== metadata.frame.name || !jsonEqual(read.query, plan.query) || read.total > 8 || read.returned !== read.total))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const ids = new Set(args.filters.shipping_profile_id), observed = new Map<string, { readonly product_id: string; readonly shipping_profile_id: string; readonly deleted_at: Json | undefined }>();
      for (const item of activity.observedRows) {
        if (item.table !== metadata.frame.name) return yield* Effect.fail(commerceError("receiptMismatch"));
        const row = yield* Effect.fromResult(complete(projectNativeRow(item.row))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const pair = yield* Effect.fromResult(decodePair({ product_id: row.product_id, shipping_profile_id: row.shipping_profile_id }));
        observed.set(JSON.stringify([pair.product_id, pair.shipping_profile_id]), { ...pair, deleted_at: row.deleted_at });
      }
      const members = [...observed.values()].filter(row => row.deleted_at === null && typeof row.shipping_profile_id === "string" && ids.has(row.shipping_profile_id));
      const compare = (left: string, right: string) => compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
      const expected = members.sort((left, right) => compare(left.product_id, right.product_id) || compare(left.shipping_profile_id, right.shipping_profile_id))
        .map(row => ({ product_id: row.product_id, shipping_profile_id: row.shipping_profile_id }));
      if (call.mode !== "read" || expected.length > 8 || activity.relationalReads.some(read => read.total !== expected.length) ||
        !jsonEqual(call.result, [expected, expected.length]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    yield* basePolicy.validateLogicalCall(call, activity);
  });
  const logicalEventPolicy = (): ReturnType<typeof linkLogicalEventPolicy> => ({ capture: basePolicy.capture, validateLogicalCall });
  const nativeServices = { shipping: native };
  const resource = yield* Effect.fromResult(prepareShippingProfileDeletionLinkResource(nativeServices));
  const commands = [native.create, native.list, count, softDeleteCommand, restoreCommand];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "product_shipping_profile_deletion_links",
    source: { name: "flarex-product-links", profile: "shipping-profile-deletions" }, graph,
    methods: { create: native.createMethod, list: native.listMethod, softDelete, restore },
    logical: { ...logicalEventPolicy(), commands } }));
  return { shipping: { workflow, commands, logicalEventPolicy, count }, nativeServices, resource };
});
