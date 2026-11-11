import { Effect, Result, Schema } from "effect";
import { createWorkflow, nativeCartMutationProfile, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartWorkflow } from "@medusajs/core-flows/cart/update-cart";
import { addToCartWorkflow } from "@medusajs/core-flows/cart/add-to-cart";
import { updateLineItemInCartWorkflow } from "@medusajs/core-flows/cart/update-line-item-in-cart";
import { deleteLineItemsWorkflow } from "@medusajs/core-flows/line-item/delete-line-items";
import { FeatureFlag } from "@medusajs/framework/utils/portable";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { CartMutationAddress } from "../../modules/cart/mutation-input";
import { decodeGraphCount, decodeGraphList } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ScalarId } from "../../repository/scalar-id-read";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type WorkflowCallResults } from "../../workflow/host";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareWorkflowResources } from "../../workflow/resources";
import { promotionComputeResources } from "../../workflow/policy";
import { cartCreationResources } from "./create-owned";
import { cartCreationResourceSelections, type prepareCartCreationResources } from "./create-cart";
import { prepareCartCreationModules, type CartCreationModules } from "./creation-graph";
import type { WorkflowModule } from "../../workflow/module";

const NullableText = Schema.optionalKey(Schema.NullOr(Schema.String));
const NullableMetadata = Schema.optionalKey(Schema.NullOr(Schema.JsonObject));
const AdditionalData = Schema.optionalKey(Schema.JsonObject);
export const UpdateCartInput = Schema.Struct({ id: ScalarId, region_id: Schema.optionalKey(ScalarId),
  email: NullableText, sales_channel_id: NullableText, metadata: NullableMetadata, locale: NullableText,
  shipping_address: Schema.optionalKey(Schema.Union([CartMutationAddress, Schema.String])),
  billing_address: Schema.optionalKey(Schema.Union([CartMutationAddress, Schema.String])),
  promo_codes: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(4))), additional_data: AdditionalData });
const LineInput = Schema.Struct({ variant_id: ScalarId, quantity: Schema.Finite.check(Schema.isGreaterThan(0)), metadata: NullableMetadata });
export const AddCartLineItemInput = Schema.Struct({ cart_id: ScalarId,
  items: Schema.Array(LineInput).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4)), additional_data: AdditionalData });
export const UpdateCartLineItemInput = Schema.Struct({ cart_id: ScalarId, item_id: ScalarId,
  update: Schema.Struct({ quantity: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), metadata: NullableMetadata }), additional_data: AdditionalData });
export const DeleteCartLineItemsInput = Schema.Struct({ cart_id: ScalarId,
  ids: Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4)), additional_data: AdditionalData });

const decodeId = commerceDecoder(ScalarId, "receiptMismatch");
const decodeHook = commerceDecoder(Schema.JsonObject, "invalidInput");
export interface CartMutationHooks { readonly cartUpdated?: (input: JsonObject) => unknown | Promise<unknown> }
type Preparation = Parameters<typeof prepareCartCreationResources>;
type Kind = "updateCart" | "addLineItem" | "updateLineItem" | "deleteLineItems";
// One shared root: the existing512 operation envelope plus at most553 SDK
// captures/checkpoints in the issued243-node mutation closure. Creation and
// participant resources retain their existing bounds.
const cartMutationRequestCallLimit = 1065;

/** Resource selection reuses the existing authenticated eighteen-source graph.
 * Mutation roots do not expose Cart creation or its ownership compensator. */
export function prepareCartMutationResources(modules: CartCreationModules,
  inventory: Preparation[1], link: Preparation[2], logger: Preparation[3]) {
  const selections = cartCreationResourceSelections(modules);
  return prepareWorkflowResources({ ...selections, cart: { module: modules.cart.module, graph: true as const,
    methods: ["updateCarts", "listCarts", "listAndCountCarts", "listAddresses", "updateAddresses", "listLineItems", "addLineItems", "updateLineItems",
      "deleteLineItems", "softDeleteLineItems", "restoreLineItems", "listLineItemTaxLines", "listShippingMethodTaxLines",
      "setLineItemTaxLines", "setShippingMethodTaxLines", "upsertLineItemTaxLines", "upsertShippingMethodTaxLines", "addLineItemAdjustments", "softDeleteLineItemAdjustments", "restoreLineItemAdjustments",
      "addShippingMethodAdjustments", "softDeleteShippingMethodAdjustments", "restoreShippingMethodAdjustments"] as const } },
  true, { inventory, link, logger }, { absent: ["caching"] });
}

function mutationEvents(kind: Kind, modules: CartCreationModules) {
  const count = modules.cart.module.methods.listAndCountCarts, update = modules.cart.module.methods.updateCarts,
    remove = modules.cart.module.methods.softDeleteLineItems;
  if (count === undefined || update === undefined || remove === undefined) return Result.fail(commerceError("invalidAuthority"));
  const cart = Effect.fn("CartMutation.observedCart")(function* (calls: WorkflowCallResults) {
    const rows: JsonObject[] = [];
    for (const value of calls.results(count)) rows.push(...(yield* Effect.fromResult(decodeGraphCount(value)))[0]);
    const first = rows[0];
    if (first === undefined) return yield* commerceError("receiptMismatch");
    const id = yield* Effect.fromResult(decodeId(first.id));
    if (rows.some(row => row.id !== id)) return yield* commerceError("receiptMismatch");
    return { id, first };
  });
  const updated = orderedWorkflowIdEvents("cart.updated", Effect.fn("CartMutation.updatedIds")(function* (calls: WorkflowCallResults) {
    const { id } = yield* cart(calls);
    // Quantity zero runs the genuine delete child, then the outer item's event.
    return kind === "updateLineItem" && calls.calls(remove).length > 0 ? [id, id] : [id];
  }));
  const region = orderedWorkflowIdEvents("cart.region_updated", Effect.fn("CartMutation.regionIds")(function* (calls: WorkflowCallResults) {
    if (kind !== "updateCart") return [];
    const { id, first } = yield* cart(calls);
    const changed: JsonObject[] = [];
    for (const value of calls.results(update)) changed.push(...(yield* Effect.fromResult(decodeGraphList(value))));
    if (changed.length !== 1 || changed[0]?.id !== id) return yield* commerceError("receiptMismatch");
    return changed[0].region_id !== first.region_id ? [id] : [];
  }));
  return Result.succeed({ contracts: [...updated.contracts, ...region.contracts],
    validate: Effect.fn("CartMutation.validateEvents")(function* (events: Parameters<typeof updated.validate>[0], calls: WorkflowCallResults) {
      yield* updated.validate(events, calls); yield* region.validate(events, calls);
    }) });
}

/** Genuine child execution keeps native lock skipping and compensation while
 * the existing scope-exclusive root alone owns final settlement and replay. */
export const prepareCartMutationWorkflows = Effect.fn("CartMutation.prepareRoots")(function* (input: {
  readonly execution: AtomicWorkflowExecution; readonly modules: CartCreationModules; readonly salesChannelRead: WorkflowModule;
  readonly link: Preparation[2]; readonly logger: Preparation[3]; readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: CartMutationHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "salesChannelRead", "link", "logger", "revision", "subscribers", "hooks"].includes(key)) ||
    FeatureFlag.isFeatureEnabled("translation")) return yield* commerceError("unsupportedProfile");
  const selected = yield* prepareCartCreationModules(options.modules, options.salesChannelRead), modules = selected.modules;
  const resources = yield* Effect.fromResult(prepareCartMutationResources(modules, selected.inventory, options.link, options.logger));
  const registered = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registered).some(key => key !== "cartUpdated") || registered.cartUpdated !== undefined && typeof registered.cartUpdated !== "function")
    return yield* commerceError("unsupportedProfile");
  const handler = registered.cartUpdated;
  const hooks = handler === undefined ? {} : { cartUpdated: resources.callback((value: unknown) =>
    captureCommerceInput(value).pipe(Result.flatMap(decodeHook), Result.match({ onFailure: error => Promise.reject(error), onSuccess: value => handler(value) }))) };
  const roots = {
    updateCart: createWorkflow({ name: "native-cart-update-atomic", constructionProfile: nativeCartMutationProfile },
      (value: WorkflowData<typeof UpdateCartInput.Type>) => { updateCartWorkflow.runAsStep({ input: value, hooks }); return new WorkflowResponse(null); }),
    addLineItem: createWorkflow({ name: "native-cart-add-line-item-atomic", constructionProfile: nativeCartMutationProfile },
      (value: WorkflowData<typeof AddCartLineItemInput.Type>) => { addToCartWorkflow.runAsStep({ input: value }); return new WorkflowResponse(null); }),
    updateLineItem: createWorkflow({ name: "native-cart-update-line-item-atomic", constructionProfile: nativeCartMutationProfile },
      (value: WorkflowData<typeof UpdateCartLineItemInput.Type>) => { updateLineItemInCartWorkflow.runAsStep({ input: value }); return new WorkflowResponse(null); }),
    deleteLineItems: createWorkflow({ name: "native-cart-delete-line-items-atomic", constructionProfile: nativeCartMutationProfile },
      (value: WorkflowData<typeof DeleteCartLineItemsInput.Type>) => { deleteLineItemsWorkflow.runAsStep({ input: value }); return new WorkflowResponse(null); }),
  };
  const { inventory, ...others } = modules;
  const composition = { execution: options.execution, modules: { ...others, inventory_graph: inventory,
    cart: { ...modules.cart, logicalResources: cartCreationResources }, promotion: { ...modules.promotion, logicalResources: promotionComputeResources } },
  revision: options.revision, subscribers: options.subscribers, identityEncoding: "resourceAndDefinitionDigest" as const, requestParticipantLimit: 18,
  requestCallLimit: cartMutationRequestCallLimit, executionIsolation: "scopeExclusive" as const, operationScheduling: "queued" as const,
  borrowedOperationScheduling: "queued" as const };
  const prepare = Effect.fn("CartMutation.prepareDefinition")(function* (kind: Kind) {
    return yield* Effect.fromResult(roots[kind].prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  });
  return {
    updateCart: yield* prepareAtomicWorkflowHost({ ...composition, workflow: { name: "updateCartWorkflow", resources,
      prepared: yield* prepare("updateCart"), input: UpdateCartInput, output: Schema.Null, events: yield* Effect.fromResult(mutationEvents("updateCart", modules)) } }),
    addLineItem: yield* prepareAtomicWorkflowHost({ ...composition, workflow: { name: "addToCartWorkflow", resources,
      prepared: yield* prepare("addLineItem"), input: AddCartLineItemInput, output: Schema.Null, events: yield* Effect.fromResult(mutationEvents("addLineItem", modules)) } }),
    updateLineItem: yield* prepareAtomicWorkflowHost({ ...composition, workflow: { name: "updateLineItemInCartWorkflow", resources,
      prepared: yield* prepare("updateLineItem"), input: UpdateCartLineItemInput, output: Schema.Null, events: yield* Effect.fromResult(mutationEvents("updateLineItem", modules)) } }),
    deleteLineItems: yield* prepareAtomicWorkflowHost({ ...composition, workflow: { name: "deleteLineItemsWorkflow", resources,
      prepared: yield* prepare("deleteLineItems"), input: DeleteCartLineItemsInput, output: Schema.Null, events: yield* Effect.fromResult(mutationEvents("deleteLineItems", modules)) } }),
  };
});
