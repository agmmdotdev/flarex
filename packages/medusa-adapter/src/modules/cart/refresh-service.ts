import { Effect, Result, Schema } from "effect";
import type { ICartModuleService } from "@medusajs/types/cart/service";
import type { ICartCreationOwnershipService } from "@medusajs/types/cart/creation";
import type { CartModuleService } from "@medusajs/cart/services";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { cartStaticResources } from "@medusajs/cart/static-manifest";
import { cartTotalsFields, lineItemTotalsFields } from "@medusajs/cart/utils/totals-selection";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus, moduleEventDecoder } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount, decodeGraphList } from "../../local-graph/query";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { ScalarId } from "../../repository/scalar-id-read";
import { captureCartCreationMetadata } from "./creation-schema";
import { prepareCartPaymentRead, CartPaymentRead, decodeCartPaymentRead } from "./payment-read";
import { prepareCartCreationRepository } from "./creation-repository";
import { defineCartCreationPersistenceModule } from "./creation-module";
import { cartCreationPolicy, captureCartCreationEvent } from "./creation-receipt";
import { cartPaymentReadPolicy } from "./payment-receipt";
import { CartRootCreates, CartCreationReceipt, decodeCartRootCreates, decodeCartCreationReceipt, decodeCartCreationResult, decodeCartCreationCompensation } from "./creation-input";
import { prepareCartCreationRefreshRepository } from "./refresh-repository";
import { prepareCartMutationRepository } from "./mutation-repository";
import { cartMutationPolicy, captureCartMutationEvent } from "./mutation-receipt";
import { CartMutationUpdates, CartMutationAddressUpdates, CartMutationLineCreates, CartMutationLineEntries, CartMutationLineFilters,
  CartMutationLinePatch, CartMutationIds, CartMutationRead, decodeCartMutationUpdates, decodeCartMutationAddressUpdates,
  decodeCartMutationLineCreates, decodeCartMutationLineUpdate, decodeCartMutationRead, decodeCartMutationIds,
  CartMutationTaxLines, decodeCartMutationTaxLines } from "./mutation-input";
import { cartCreationRefreshPolicy, captureCartCreationRefreshEvent } from "./refresh-receipt";
import { CartItemTaxRead, CartShippingTaxRead, CartItemTaxLines, CartEmptyShippingTaxLines, CartItemAdjustments, CartRefreshIds, CartEmptyShippingAdjustments,
  decodeCartItemTaxRead, decodeCartShippingTaxRead, decodeCartSetItemTaxInput, decodeCartSetShippingTaxInput,
  decodeCartItemAdjustments, decodeCartRefreshIds, decodeCartEmptyShippingAdjustments } from "./refresh-input";

type Native = ICartCreationOwnershipService & Pick<ICartModuleService, "listCarts" | "listAndCountCarts" |
  "updateCarts" | "listAddresses" | "updateAddresses" | "listLineItems" | "addLineItems" | "updateLineItems" |
  "deleteLineItems" | "softDeleteLineItems" | "restoreLineItems" |
  "upsertLineItemTaxLines" | "upsertShippingMethodTaxLines" |
  "listLineItemTaxLines" | "listShippingMethodTaxLines" | "setLineItemTaxLines" | "setShippingMethodTaxLines" |
  "addLineItemAdjustments" | "softDeleteLineItemAdjustments" | "restoreLineItemAdjustments" |
  "addShippingMethodAdjustments" | "softDeleteShippingMethodAdjustments" | "restoreShippingMethodAdjustments"> &
  Pick<CartModuleService, "listAndCountLineItems" | "listAndCountShippingMethods">;
const createArguments = commerceDecoder(Schema.Tuple([CartRootCreates]), "invalidInput");
const inverseArguments = commerceDecoder(Schema.Tuple([CartCreationReceipt]), "invalidInput");
const readArguments = commerceDecoder(Schema.Tuple([CartPaymentRead.fields.filters, CartPaymentRead.fields.config.schema]), "invalidInput");
const itemTaxReadArguments = commerceDecoder(Schema.Tuple([CartItemTaxRead]), "invalidInput");
const shippingTaxReadArguments = commerceDecoder(Schema.Tuple([CartShippingTaxRead]), "invalidInput");
const setItemTaxArguments = commerceDecoder(Schema.Tuple([ScalarId, CartItemTaxLines]), "invalidInput");
const setShippingTaxArguments = commerceDecoder(Schema.Tuple([ScalarId, CartEmptyShippingTaxLines]), "invalidInput");
const adjustmentArguments = commerceDecoder(Schema.Tuple([CartItemAdjustments]), "invalidInput");
const lifecycleArguments = commerceDecoder(Schema.Tuple([CartRefreshIds]), "invalidInput");
const emptyShippingArguments = commerceDecoder(Schema.Tuple([CartEmptyShippingAdjustments]), "invalidInput");
const lifecycleOutput = commerceDecoder(Schema.JsonObject, "storedCorruption");
const voidOutput = commerceDecoder(Schema.Null, "storedCorruption");
const lineOutput = commerceDecoder(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4))]), "storedCorruption");
const updateArguments = commerceDecoder(Schema.Tuple([CartMutationUpdates]), "invalidInput");
const addressUpdateArguments = commerceDecoder(Schema.Tuple([CartMutationAddressUpdates]), "invalidInput");
const mutationReadArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([CartMutationRead.fields.filters]), Schema.Tuple([CartMutationRead.fields.filters, CartMutationRead.fields.config.schema]),
]), "invalidInput");
const lineCreateArguments = commerceDecoder(Schema.Tuple([CartMutationLineCreates]), "invalidInput");
const lineUpdateArguments = commerceDecoder(Schema.Union([Schema.Tuple([CartMutationLineEntries]),
  Schema.Tuple([Schema.Union([ScalarId, CartMutationLineFilters]), CartMutationLinePatch])]), "invalidInput");
const lineIdsArguments = commerceDecoder(Schema.Tuple([CartMutationIds]), "invalidInput");
const upsertTaxArguments = commerceDecoder(Schema.Tuple([CartMutationTaxLines]), "invalidInput");
const upsertShippingTaxArguments = commerceDecoder(Schema.Tuple([CartEmptyShippingTaxLines]), "invalidInput");

/** A distinct complete-creation profile on the same genuine twelve-model Cart
 * owner. The standalone creation and nine-model checkout profiles remain
 * independently admitted; the root composition selects this source once. */
export const makeCartCreationWorkflowCommands = Effect.fn("CartCreation.workflowCommands")(function* () {
  const metadata = yield* captureCartCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const read = yield* prepareCartPaymentRead(metadata.frame, "creation", "nativeOrm"), creation = yield* prepareCartCreationRepository(metadata.frame, read, "workflow"),
      prepared = yield* prepareCartMutationRepository(yield* prepareCartCreationRefreshRepository(creation));
    const module = yield* defineCartCreationPersistenceModule({ name: "flarex-cart-creation-workflow", profile: "cart.creation-workflow",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { owner, eventBus, store: bound.store, baseRepository: bound.repository, events: bound.mutationEvents,
          repository: model => model === cartCreationModels.Cart ? bound.repository : model === cartCreationModels.Address ? bound.addressRepository :
            model === cartCreationModels.LineItem ? bound.lineItemRepository : model === cartCreationModels.ShippingMethod ? bound.shippingMethodRepository : model === cartCreationModels.LineItemTaxLine ? bound.lineItemTaxLineRepository :
              model === cartCreationModels.ShippingMethodTaxLine ? bound.shippingMethodTaxLineRepository : model === cartCreationModels.LineItemAdjustment ? bound.lineItemAdjustmentRepository :
                model === cartCreationModels.ShippingMethodAdjustment ? bound.shippingMethodAdjustmentRepository :
                  model === cartCreationModels.CartCreationOperation ? bound.protocolRepositories.get("cart_creation_operation") ?? bound.denied :
                  model === cartCreationModels.CartCreationCart ? bound.protocolRepositories.get("cart_creation_cart") ?? bound.denied :
                    model === cartCreationModels.CartCreationAddress ? bound.protocolRepositories.get("cart_creation_address") ?? bound.denied : bound.denied };
      }, service: (native, owner) => {
        const service: Native = { createCartsWithOwnership: native.createCartsWithOwnership.bind(native), compensateCartsCreation: native.compensateCartsCreation.bind(native),
          listCarts: native.listCarts.bind(native), listAndCountCarts: native.listAndCountCarts.bind(native),
          updateCarts: native.updateCarts.bind(native), listAddresses: native.listAddresses.bind(native), updateAddresses: native.updateAddresses.bind(native),
          listLineItems: native.listLineItems.bind(native), addLineItems: native.addLineItems.bind(native), updateLineItems: native.updateLineItems.bind(native),
          deleteLineItems: native.deleteLineItems.bind(native), softDeleteLineItems: native.softDeleteLineItems.bind(native), restoreLineItems: native.restoreLineItems.bind(native),
          upsertLineItemTaxLines: native.upsertLineItemTaxLines.bind(native), upsertShippingMethodTaxLines: native.upsertShippingMethodTaxLines.bind(native),
          listAndCountLineItems: native.listAndCountLineItems.bind(native), listAndCountShippingMethods: native.listAndCountShippingMethods.bind(native),
          listLineItemTaxLines: native.listLineItemTaxLines.bind(native), listShippingMethodTaxLines: native.listShippingMethodTaxLines.bind(native),
          setLineItemTaxLines: native.setLineItemTaxLines.bind(native), setShippingMethodTaxLines: native.setShippingMethodTaxLines.bind(native),
          addLineItemAdjustments: native.addLineItemAdjustments.bind(native), softDeleteLineItemAdjustments: native.softDeleteLineItemAdjustments.bind(native),
          restoreLineItemAdjustments: native.restoreLineItemAdjustments.bind(native), addShippingMethodAdjustments: native.addShippingMethodAdjustments.bind(native),
          softDeleteShippingMethodAdjustments: native.softDeleteShippingMethodAdjustments.bind(native), restoreShippingMethodAdjustments: native.restoreShippingMethodAdjustments.bind(native) };
        return { ...service, capture: (value: unknown) => owner.run(Effect.fromResult(captureNativeNumericDto(value))) };
      },
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("CartCreationWorkflow.prepare");
    const create = commands.write("cartCreateWithOwnership", prepare(decodeCartRootCreates), async ({ service, context }, input) =>
      service.capture(await Reflect.apply(service.createCartsWithOwnership, service, [input, context])));
    const compensate = commands.write("cartCompensateCreation", prepare(decodeCartCreationReceipt),
      ({ service, context }, input) => service.compensateCartsCreation(input, context));
    const count = commands.read("cartCountForCheckout", prepare(decodeCartPaymentRead), async ({ service, context }, input) =>
      service.capture(await service.listAndCountCarts(input.filters, input.config ?? {}, context)));
    const list = commands.read("cartListForCheckout", prepare(decodeCartPaymentRead), async ({ service, context }, input) =>
      service.capture(await service.listCarts(input.filters, input.config ?? {}, context)));
    const countLines = commands.read("cartLineItemsCountForCheckout", prepare(decodeCartMutationRead), async ({ service, context }, input) =>
      service.capture(await service.listAndCountLineItems(input.filters, input.config ?? {}, context)));
    const countShipping = commands.read("cartShippingMethodsCountForCreation", prepare(decodeCartPaymentRead), async ({ service, context }, input) =>
      service.capture(await service.listAndCountShippingMethods(input.filters, input.config ?? {}, context)));
    const listItemTax = commands.read("cartListItemTaxForCreation", prepare(decodeCartItemTaxRead), ({ service, context }, input) =>
      service.listLineItemTaxLines(input, {}, context));
    const listShippingTax = commands.read("cartListShippingTaxForCreation", prepare(decodeCartShippingTaxRead), ({ service, context }, input) =>
      service.listShippingMethodTaxLines(input, {}, context));
    const setItemTax = commands.write("cartSetItemTaxForCreation", prepare(decodeCartSetItemTaxInput), ({ service, context }, input) =>
      Reflect.apply(service.setLineItemTaxLines, service, [input.cart_id, input.tax_lines, context]));
    const setShippingTax = commands.write("cartSetShippingTaxForCreation", prepare(decodeCartSetShippingTaxInput), ({ service, context }, input) =>
      service.setShippingMethodTaxLines(input.cart_id, input.tax_lines, context));
    const addItemAdjustments = commands.write("cartAddItemAdjustmentsForCreation", prepare(decodeCartItemAdjustments), ({ service, context }, input) =>
      Reflect.apply(service.addLineItemAdjustments, service, [input, undefined, context]));
    const softDeleteItemAdjustments = commands.write("cartSoftDeleteItemAdjustmentsForCreation", prepare(decodeCartRefreshIds), async ({ service, context }, input) =>
      service.capture(await service.softDeleteLineItemAdjustments(input, {}, context)));
    const restoreItemAdjustments = commands.write("cartRestoreItemAdjustmentsForCreation", prepare(decodeCartRefreshIds), async ({ service, context }, input) =>
      service.capture(await service.restoreLineItemAdjustments(input, {}, context)));
    const addShippingAdjustments = commands.write("cartAddEmptyShippingAdjustmentsForCreation", prepare(decodeCartEmptyShippingAdjustments), ({ service, context }, input) =>
      Reflect.apply(service.addShippingMethodAdjustments, service, [input, undefined, context]));
    const softDeleteShippingAdjustments = commands.write("cartSoftDeleteEmptyShippingAdjustmentsForCreation", prepare(decodeCartEmptyShippingAdjustments), async ({ service, context }, input) =>
      service.capture(await service.softDeleteShippingMethodAdjustments(input, {}, context)));
    const restoreShippingAdjustments = commands.write("cartRestoreEmptyShippingAdjustmentsForCreation", prepare(decodeCartEmptyShippingAdjustments), async ({ service, context }, input) =>
      service.capture(await service.restoreShippingMethodAdjustments(input, {}, context)));
    const update = commands.write("cartUpdateForMutations", prepare(decodeCartMutationUpdates), async ({ service, context }, input) =>
      service.capture(await Reflect.apply(service.updateCarts, service, [input, undefined, context])));
    const listAddressesCommand = commands.read("cartAddressesForMutations", prepare(decodeCartMutationRead), async ({ service, context }, input) =>
      service.capture(await service.listAddresses(input.filters, input.config ?? {}, context)));
    const updateAddressesCommand = commands.write("cartUpdateAddressesForMutations", prepare(decodeCartMutationAddressUpdates), async ({ service, context }, input) =>
      service.capture(await Reflect.apply(service.updateAddresses, service, [input, context])));
    const listLines = commands.read("cartListLinesForMutations", prepare(decodeCartMutationRead), async ({ service, context }, input) =>
      service.capture(await service.listLineItems(input.filters, input.config ?? {}, context)));
    const addLines = commands.write("cartAddLinesForMutations", prepare(decodeCartMutationLineCreates), async ({ service, context }, input) =>
      service.capture(await Reflect.apply(service.addLineItems, service, [input, undefined, context])));
    const updateLines = commands.write("cartUpdateLinesForMutations", prepare(decodeCartMutationLineUpdate), async ({ service, context }, input) =>
      service.capture(await Reflect.apply(service.updateLineItems, service, [input.target, input.data, context])));
    const deleteLines = commands.write("cartDeleteLinesForMutations", prepare(decodeCartMutationIds), async ({ service, context }, input) => {
      await service.deleteLineItems(input, context);
      return null;
    });
    const softDeleteLines = commands.write("cartSoftDeleteLinesForMutations", prepare(decodeCartMutationIds), async ({ service, context }, input) =>
      service.capture(await service.softDeleteLineItems(input, {}, context)));
    const restoreLines = commands.write("cartRestoreLinesForMutations", prepare(decodeCartMutationIds), async ({ service, context }, input) =>
      service.capture(await service.restoreLineItems(input, {}, context)));
    const upsertItemTax = commands.write("cartUpsertItemTaxForMutations", prepare(decodeCartMutationTaxLines), async ({ service, context }, input) =>
      service.capture(await Reflect.apply(service.upsertLineItemTaxLines, service, [input, context])));
    const upsertShippingTax = commands.write("cartUpsertEmptyShippingTaxForMutations", prepare(commerceDecoder(CartEmptyShippingTaxLines, "invalidInput")), async ({ service, context }, input) =>
      service.capture(await service.upsertShippingMethodTaxLines(input, context)));
    const mutationCommands = [countLines, update, listAddressesCommand, updateAddressesCommand, listLines, addLines, updateLines, deleteLines, softDeleteLines, restoreLines, upsertItemTax, upsertShippingTax];
    const mutationPolicy = cartMutationPolicy(prepared);
    const creationPolicy = cartCreationPolicy(creation, decodeCartRootCreates), readPolicy = cartPaymentReadPolicy(read, "completion"), refreshPolicy = cartCreationRefreshPolicy(prepared);
    const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
      metadata: Schema.Struct({ source: Schema.Literal(Modules.CART), object: Schema.String, action: Schema.String }),
      data: Schema.Struct({ id: Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isLengthBetween(1, 8))]) }) }), defaultCommerceResources);
    const capture = Effect.fn("CartCreationWorkflow.captureEvent")(function* (input: unknown) {
      const envelope = yield* decodeEvent(input);
      return yield* (["line_item_tax_line", "shipping_method_tax_line", "line_item_adjustment"].includes(envelope.metadata.object)
        ? captureCartCreationRefreshEvent(envelope) : envelope.metadata.object.startsWith("cart_creation_")
          ? captureCartCreationEvent(envelope) : captureCartMutationEvent(envelope));
    });
    const validateLogicalCall: typeof creationPolicy.validateLogicalCall = Effect.fn("CartCreationWorkflow.routeCall")(function* (call, activity) {
      return yield* (call.commandName === "cartCreateWithOwnership" || call.commandName === "cartCompensateCreation" ? creationPolicy :
        ["cartListForCheckout", "cartCountForCheckout", "cartShippingMethodsCountForCreation"].includes(call.commandName) ? readPolicy :
          call.commandName === "cartLineItemsCountForCheckout" || call.commandName.endsWith("ForMutations") ? mutationPolicy : refreshPolicy).validateLogicalCall(call, activity);
    });
    const eventName = (objectName: string, action: "created" | "deleted" | "updated" | "restored") => buildModuleResourceEventName({ prefix: Modules.CART, objectName, action });
    const createCartsWithOwnership = yield* defineWorkflowMethod({ command: create, arguments: createArguments, encode: ([input]) => input,
      output: decodeCartCreationResult, moduleEvents: ["cart", "address", "line_item", "cart_creation_operation", "cart_creation_cart", "cart_creation_address"].map(object => eventName(object, "created")) });
    const compensateCartsCreation = yield* defineWorkflowMethod({ command: compensate, arguments: inverseArguments, encode: ([input]) => input,
      output: decodeCartCreationCompensation, moduleEvents: [eventName("cart", "deleted"), eventName("address", "deleted"), eventName("cart_creation_operation", "updated")] });
    const listCarts = yield* defineWorkflowMethod({ command: list, arguments: readArguments, encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeGraphList });
    const listAndCountCarts = yield* defineWorkflowMethod({ command: count, arguments: readArguments, encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeGraphCount });
    const updateCarts = yield* defineWorkflowMethod({ command: update, arguments: updateArguments, encode: ([input]) => input, output: decodeGraphList,
      moduleEvents: [eventName("cart", "updated"), eventName("address", "created"), eventName("address", "updated")] });
    const listAddresses = yield* defineWorkflowMethod({ command: listAddressesCommand, arguments: mutationReadArguments,
      encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeGraphList });
    const updateAddresses = yield* defineWorkflowMethod({ command: updateAddressesCommand, arguments: addressUpdateArguments, encode: ([input]) => input,
      output: decodeGraphList, moduleEvents: [eventName("address", "updated")] });
    const listLineItems = yield* defineWorkflowMethod({ command: listLines, arguments: mutationReadArguments,
      encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: decodeGraphList });
    const addLineItems = yield* defineWorkflowMethod({ command: addLines, arguments: lineCreateArguments, encode: ([input]) => input,
      output: decodeGraphList, moduleEvents: [eventName("line_item", "created")] });
    const updateLineItems = yield* defineWorkflowMethod({ command: updateLines, arguments: lineUpdateArguments,
      encode: args => ({ target: args[0], ...(args.length === 1 ? {} : { data: args[1] }) }),
      output: lineOutput, moduleEvents: [eventName("line_item", "updated")] });
    const deleteLineItems = yield* defineWorkflowMethod({ command: deleteLines, arguments: lineIdsArguments, encode: ([input]) => input,
      output: voidOutput, moduleEvents: [eventName("line_item", "deleted")] });
    const softDeleteLineItems = yield* defineWorkflowMethod({ command: softDeleteLines, arguments: lineIdsArguments, encode: ([input]) => input,
      output: lifecycleOutput, moduleEvents: [eventName("line_item", "deleted"),
        ...["line_item_tax_line", "line_item_adjustment"].flatMap(object => (["deleted", "updated"] as const).map(action => eventName(object, action)))] });
    const restoreLineItems = yield* defineWorkflowMethod({ command: restoreLines, arguments: lineIdsArguments, encode: ([input]) => input, output: lifecycleOutput });
    const upsertLineItemTaxLines = yield* defineWorkflowMethod({ command: upsertItemTax, arguments: upsertTaxArguments, encode: ([input]) => input, output: decodeGraphList,
      moduleEvents: [eventName("line_item_tax_line", "created"), eventName("line_item_tax_line", "updated")] });
    const upsertShippingMethodTaxLines = yield* defineWorkflowMethod({ command: upsertShippingTax, arguments: upsertShippingTaxArguments, encode: ([input]) => input, output: decodeGraphList });
    const listLineItemTaxLines = yield* defineWorkflowMethod({ command: listItemTax, arguments: itemTaxReadArguments, encode: ([input]) => input, output: decodeGraphList });
    const listShippingMethodTaxLines = yield* defineWorkflowMethod({ command: listShippingTax, arguments: shippingTaxReadArguments, encode: ([input]) => input, output: decodeGraphList });
    const setLineItemTaxLines = yield* defineWorkflowMethod({ command: setItemTax, arguments: setItemTaxArguments, encode: ([cart_id, tax_lines]) => ({ cart_id, tax_lines }), output: decodeGraphList,
      moduleEvents: [eventName("line_item_tax_line", "created"), eventName("line_item_tax_line", "deleted")] });
    const setShippingMethodTaxLines = yield* defineWorkflowMethod({ command: setShippingTax, arguments: setShippingTaxArguments, encode: ([cart_id, tax_lines]) => ({ cart_id, tax_lines }), output: decodeGraphList,
      moduleEvents: [eventName("shipping_method_tax_line", "deleted")] });
    const addLineItemAdjustments = yield* defineWorkflowMethod({ command: addItemAdjustments, arguments: adjustmentArguments, encode: ([input]) => input, output: decodeGraphList,
      moduleEvents: [eventName("line_item_adjustment", "created")] });
    const softDeleteLineItemAdjustments = yield* defineWorkflowMethod({ command: softDeleteItemAdjustments, arguments: lifecycleArguments, encode: ([input]) => input,
      output: lifecycleOutput, moduleEvents: [eventName("line_item_adjustment", "deleted")] });
    const restoreLineItemAdjustments = yield* defineWorkflowMethod({ command: restoreItemAdjustments, arguments: lifecycleArguments, encode: ([input]) => input,
      output: lifecycleOutput });
    const addShippingMethodAdjustments = yield* defineWorkflowMethod({ command: addShippingAdjustments, arguments: emptyShippingArguments, encode: ([input]) => input,
      output: decodeGraphList });
    const softDeleteShippingMethodAdjustments = yield* defineWorkflowMethod({ command: softDeleteShippingAdjustments, arguments: emptyShippingArguments, encode: ([input]) => input,
      output: lifecycleOutput });
    const restoreShippingMethodAdjustments = yield* defineWorkflowMethod({ command: restoreShippingAdjustments, arguments: emptyShippingArguments, encode: ([input]) => input,
      output: lifecycleOutput });
    const stored = yield* read.catalog.table("cart"), storedItem = yield* read.catalog.table("cart_line_item");
    const cartTotals = read.totals.filter(name => !stored.columns.includes(name));
    const itemTotals = lineItemTotalsFields().filter(name => !storedItem.columns.includes(name));
    const presentation = { columns: cartTotals.flatMap(name => [name, "raw_" + name]),
      companions: Object.fromEntries(cartTotals.map(name => [name, "raw_" + name])) };
    const itemPresentation = { columns: itemTotals.flatMap(name => [name, "raw_" + name]),
      companions: Object.fromEntries(itemTotals.map(name => [name, "raw_" + name])) };
    // Native Cart decorates these detached Line Item DTOs. Retain the real
    // computed properties in nested graph wildcards; every table/key remains
    // genuine DML metadata, including direct DAL Line Item reads.
    const paths = (yield* relationPaths(read.catalog, "cart", read.paths, { nativeFields: true })).map(path =>
      path.table.name === storedItem.name ? { ...path, presentation: itemPresentation, optionalFields: ["product", "variant"] } :
        path.path === "shipping_address" || path.path === "billing_address" ? { ...path, optionalFields: ["region_code"] } : path);
    const joiner = cartStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const admitted = [create, compensate, count, countLines, countShipping, list, listItemTax, listShippingTax, setItemTax, setShippingTax, addItemAdjustments, softDeleteItemAdjustments, restoreItemAdjustments,
      addShippingAdjustments, softDeleteShippingAdjustments, restoreShippingAdjustments, ...mutationCommands.filter(command => command !== countLines)];
    const policy = { capture, validateLogicalCall };
    const workflow = yield* defineWorkflowModule({ name: Modules.CART, source: module.description,
      methods: { createCartsWithOwnership, compensateCartsCreation, listCarts, listAndCountCarts, updateCarts, listAddresses, updateAddresses,
        listLineItems, addLineItems, updateLineItems, deleteLineItems, softDeleteLineItems, restoreLineItems, upsertLineItemTaxLines, upsertShippingMethodTaxLines, listLineItemTaxLines, listShippingMethodTaxLines,
        setLineItemTaxLines, setShippingMethodTaxLines, addLineItemAdjustments, softDeleteLineItemAdjustments, restoreLineItemAdjustments,
        addShippingMethodAdjustments, softDeleteShippingMethodAdjustments, restoreShippingMethodAdjustments },
      graph: { aliases: (yield* moduleAliases(joiner)).filter(alias => ["Cart", "LineItem", "ShippingMethod"].includes(alias.model)), reads: [{ model: "Cart", command: count,
        table: stored, presentation, paths, nativeFields: true,
        optionalFields: cartTotals.filter(name => !cartTotalsFields().includes(name)).flatMap(name => [name, "raw_" + name]),
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
        { model: "LineItem", command: countLines, table: yield* read.catalog.table("cart_line_item"), paths: [], nativeFields: true,
          orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
        { model: "ShippingMethod", command: countShipping, table: yield* read.catalog.table("cart_shipping_method"), paths: [], nativeFields: true,
          orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] }, logical: { ...policy, commands: admitted } });
    return { workflow, prepared, commands: admitted, create, compensate, count, countLines, countShipping, list, listItemTax, listShippingTax, setItemTax, setShippingTax,
      addItemAdjustments, softDeleteItemAdjustments, restoreItemAdjustments, addShippingAdjustments, softDeleteShippingAdjustments, restoreShippingAdjustments,
      update, listAddressesCommand, updateAddressesCommand, listLines, addLines, updateLines, deleteLines, softDeleteLines, restoreLines, upsertItemTax, upsertShippingTax, logicalEventPolicy: () => policy };
  }));
});
