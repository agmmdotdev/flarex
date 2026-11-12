import { Cause, Effect, Result } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { Fulfillment, FulfillmentAddress, FulfillmentItem, FulfillmentLabel, FulfillmentProvider, FulfillmentSet, GeoZone, ServiceZone,
  ShippingOption, ShippingOptionRule, ShippingOptionType, ShippingProfile } from "@medusajs/fulfillment/models";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { prepareCommerceInternalService, prepareCommerceModule } from "../../module/persistence";
import { makeCommercePromiseOwner } from "../../module/promise-owner";
import { projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery, type CommerceRelationRows } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { decodeGraphList } from "../../local-graph/query";
import { decodeCartShippingReadInput, type prepareCartShippingRead } from "./cart-shipping-read";
import { fulfillmentModels } from "./fulfillment-module";

const bindOption = prepareCommerceInternalService(ShippingOption), bindType = prepareCommerceInternalService(ShippingOptionType),
  bindRule = prepareCommerceInternalService(ShippingOptionRule), bindProfile = prepareCommerceInternalService(ShippingProfile),
  bindSet = prepareCommerceInternalService(FulfillmentSet), bindZone = prepareCommerceInternalService(ServiceZone), bindGeo = prepareCommerceInternalService(GeoZone),
  bindFulfillment = prepareCommerceInternalService(Fulfillment), bindAddress = prepareCommerceInternalService(FulfillmentAddress),
  bindItem = prepareCommerceInternalService(FulfillmentItem), bindLabel = prepareCommerceInternalService(FulfillmentLabel);
type Prepared = Result.Result.Success<ReturnType<typeof prepareCartShippingRead>>;

/** The actual native list/normalizer/rule matcher executes against authenticated
 * ordered observations. No persistence, alternate matching algorithm or manager
 * authority enters reconstruction. */
export function cartShippingReadPolicy(prepared: Prepared, roots: ReadonlyMap<string, string>) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Fulfillment.validateCartShippingRead")(function* (call, activity) {
    const table = roots.get(call.commandName), mismatch = () => commerceError("receiptMismatch");
    if (table === undefined || call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length ||
      activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeCartShippingReadInput(call.input)), state = new Map<string, Map<string, JsonObject>>();
    for (const observed of activity.observedRows) {
      const entity = prepared.byName.get(observed.table);
      if (entity === undefined) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(entity.complete(projectNativeRow(observed.row))), id = row.id;
      if (typeof id !== "string") return yield* Effect.fail(mismatch());
      const members = state.get(observed.table) ?? new Map<string, JsonObject>(), prior = members.get(id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      members.set(id, row); state.set(observed.table, members);
      if (members.size > defaultCommerceResources.catalogRows) return yield* Effect.fail(mismatch());
    }
    let cursor = 0;
    const used = new Set<string>();
    const rows: CommerceRelationRows = Effect.fn("Fulfillment.selectCartShippingObservation")(function* (table, predicate, order = "id", options) {
      const observed = activity.relationalReads[cursor++];
      if (observed === undefined || observed.table !== table || observed.related !== undefined ||
        !jsonEqual(observed.query, commerceRelationReadQuery(defaultCommerceResources, predicate, order, { includeIdentities: true, ...options })) ||
        observed.orderedIdentities === undefined || observed.total !== observed.returned || observed.returned !== observed.orderedIdentities.length)
        return yield* Effect.fail(mismatch());
      const selected: JsonObject[] = [], ids = new Set<string>();
      for (const identity of observed.orderedIdentities) {
        const id = identity.id;
        if (Object.keys(identity).length !== 1 || typeof id !== "string" || ids.has(id)) return yield* Effect.fail(mismatch());
        const row = state.get(table)?.get(id);
        if (row === undefined) return yield* Effect.fail(mismatch());
        ids.add(id); selected.push(structuredClone(row));
      }
      yield* Effect.fromResult(prepared.admission(table, selected)); used.add(table); return selected;
    });
    const owner = yield* makeCommercePromiseOwner();
    yield* owner.withClose(Effect.gen(function* () {
      const token = Object.freeze({}), shared: Context = { manager: token, transactionManager: token };
      const refuse = (): never => owner.reject(mismatch());
      const denied: DAL.RepositoryService = { getFreshManager: refuse, getActiveManager: refuse, transaction: refuse,
        serialize: refuse, find: refuse, findAndCount: refuse, create: refuse, update: refuse, delete: refuse,
        softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse };
      const repository: DAL.RepositoryService = { ...denied,
        find: (value, context) => owner.run(Effect.gen(function* () {
          if (Object.getOwnPropertyDescriptor(context ?? {}, "transactionManager")?.value !== token) return yield* Effect.fail(mismatch());
          return structuredClone((yield* prepared.read(rows, table, value)).rows);
        })),
        serialize: <Output extends object | object[]>(value: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
          if (options !== undefined) return yield* Effect.fail(mismatch());
          // SAFETY: only the genuine native read and checked projection create
          // this detached generic service DTO during receipt reconstruction.
          return (yield* Effect.fromResult(captureCommerceInput(value))) as Output;
        })),
      };
      const persistence = yield* Effect.fromResult(prepareCommerceModule({ name: "fulfillment-cart-shipping-read-proof", models: fulfillmentModels }));
      const binding = persistence.bind(owner, { baseRepository: repository, repository: () => repository }), adapter = binding.persistence;
      const providerContainer = { fulfillmentProviderRepository: denied, modulePersistenceAdapter: adapter, fp_manual_manual: new ManualFulfillmentService() };
      const dependencies = { baseRepository: repository, [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: adapter,
        fulfillmentService: bindFulfillment(denied, adapter), fulfillmentAddressService: bindAddress(denied, adapter),
        fulfillmentItemService: bindItem(denied, adapter), fulfillmentLabelService: bindLabel(denied, adapter),
        fulfillmentSetService: bindSet(repository, adapter), serviceZoneService: bindZone(repository, adapter), geoZoneService: bindGeo(denied, adapter),
        shippingOptionService: bindOption(repository, adapter), shippingOptionTypeService: bindType(denied, adapter),
        shippingOptionRuleService: bindRule(denied, adapter), shippingProfileService: bindProfile(repository, adapter),
        fulfillmentProviderService: new FulfillmentProviderService(providerContainer),
      };
      const native = new FulfillmentModuleService(dependencies, { scope: "internal" });
      const invoke = table === "shipping_option" ? native.listShippingOptions : table === "shipping_profile" ? native.listShippingProfiles
        : table === "service_zone" ? native.listServiceZones : table === "fulfillment_set" ? native.listFulfillmentSets : undefined;
      if (invoke === undefined) return yield* Effect.fail(mismatch());
      const value = yield* owner.invoke(() => Reflect.apply(invoke, native, [input.filters, input.config, shared]))
        .pipe(Effect.flatMap(value => Effect.fromResult(decodeGraphList(value))));
      const expected = yield* Effect.fromResult(captureCommerceInput([value, value.length]));
      if (cursor !== activity.relationalReads.length || [...state.keys()].some(table => !used.has(table)) || !jsonEqual(expected, call.result))
        return yield* Effect.fail(mismatch());
    }));
  }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
    failure => failure.reason === "receiptMismatch" ? failure : commerceError("receiptMismatch", failure)))));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
