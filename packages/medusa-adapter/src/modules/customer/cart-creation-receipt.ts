import { Effect, Result } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer } from "@medusajs/customer/models";
import { CustomerModuleService } from "@medusajs/customer/services";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { prepareCommerceModule, prepareCommerceInternalService } from "../../module/persistence";
import { makeCommercePromiseOwner } from "../../module/promise-owner";
import { commerceRelationReadQuery, type CommerceRelationRows } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { decodeGraphCount } from "../../local-graph/query";
import { decodeCustomerCartCreationRead, type prepareCustomerCartCreationRead } from "./cart-creation-read";

type Prepared = Result.Result.Success<ReturnType<typeof prepareCustomerCartCreationRead>>;
const bindCustomer = prepareCommerceInternalService(Customer), bindAddress = prepareCommerceInternalService(CustomerAddress),
  bindGroup = prepareCommerceInternalService(CustomerGroup), bindMembership = prepareCommerceInternalService(CustomerGroupCustomer);

/** Re-run only the genuine native read call over exact immutable selection
 * observations. No database, persistence manager or alternate join evaluator
 * participates in this receipt reconstruction. */
export function customerCartCreationReadPolicy(prepared: Prepared) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Customer.validateCartCreationRead")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (call.commandName !== "customerCountForCartCreation" || call.mode !== "read" || call.events.length || activity.mutations.length ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeCustomerCartCreationRead(call.input)), actual = yield* Effect.fromResult(decodeGraphCount(call.result));
    const state = new Map<string, Map<string, JsonObject>>();
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
    const rows: CommerceRelationRows = Effect.fn("Customer.selectCartCreationObservedRows")(function* (table, predicate, order = "id", options) {
      const observation = activity.relationalReads[cursor++], entity = prepared.byName.get(table);
      if (entity === undefined || observation === undefined || observation.table !== table || observation.related !== undefined ||
        !jsonEqual(observation.query, commerceRelationReadQuery(defaultCommerceResources, predicate, order, { includeIdentities: true, ...options })) ||
        observation.orderedIdentities === undefined || observation.total !== observation.returned || observation.returned !== observation.orderedIdentities.length)
        return yield* Effect.fail(mismatch());
      const selected: JsonObject[] = [], ids = new Set<string>();
      for (const identity of observation.orderedIdentities) {
        const keys = Object.keys(identity), id = identity.id;
        if (keys.length !== 1 || keys[0] !== "id" || typeof id !== "string" || ids.has(id)) return yield* Effect.fail(mismatch());
        const row = state.get(table)?.get(id);
        if (row === undefined) return yield* Effect.fail(mismatch());
        ids.add(id); selected.push(structuredClone(row));
      }
      yield* Effect.fromResult(prepared.admitSelection(table, selected)); used.add(table); return selected;
    });
    const owner = yield* makeCommercePromiseOwner();
    yield* owner.withClose(Effect.gen(function* () {
      // A proof-local callback occurrence token, never a storage-manager claim.
      const token = Object.freeze({}), shared: Context = { manager: token, transactionManager: token }, issued = new WeakSet<object>();
      const refuse = (): never => owner.reject(mismatch());
      const denied: DAL.RepositoryService = { getFreshManager: refuse, getActiveManager: refuse, transaction: refuse,
        serialize: refuse, find: refuse, findAndCount: refuse, create: refuse, update: refuse, delete: refuse,
        softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse };
      const repository: DAL.RepositoryService = { ...denied,
        findAndCount: (value, context) => owner.run(Effect.gen(function* () {
          if (context === undefined || Object.getOwnPropertyDescriptor(context, "transactionManager")?.value !== token)
            return yield* Effect.fail(mismatch());
          const captured = yield* Effect.fromResult(captureCommerceInput(value));
          const result = yield* prepared.read(rows, captured), selected = structuredClone(result.rows);
          issued.add(selected); return [selected, result.count];
        })),
        serialize: <Output extends object | object[]>(value: unknown, options?: unknown): Promise<Output> => owner.run(Effect.gen(function* () {
          if (options !== undefined || value === null || typeof value !== "object" || !issued.has(value)) return yield* Effect.fail(mismatch());
          // SAFETY: native read results alone issue this DTO value. The same
          // checked DML/population/projection owner produced every member.
          return (yield* Effect.fromResult(captureCommerceInput(value))) as Output;
        })),
      };
      const persistence = yield* Effect.fromResult(prepareCommerceModule({ name: "customer-cart-creation-read-proof",
        models: [Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer] }));
      const binding = persistence.bind(owner, { baseRepository: repository, repository: model => model === Customer ? repository : denied });
      const adapter = binding.persistence;
      const dependencies = { baseRepository: repository, [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: adapter,
        customerService: bindCustomer(repository, adapter), customerAddressService: bindAddress(denied, adapter),
        customerGroupService: bindGroup(denied, adapter), customerGroupCustomerService: bindMembership(denied, adapter) };
      const native = new CustomerModuleService(dependencies, { scope: "internal" });
      const expected = yield* owner.invoke(() => Reflect.apply(native.listAndCountCustomers, native, [input.filters, input.config, shared]))
        .pipe(Effect.flatMap(value => Effect.fromResult(captureCommerceInput(value))));
      if (cursor !== activity.relationalReads.length || [...state.keys()].some(table => !used.has(table)) || !jsonEqual(expected, actual))
        return yield* Effect.fail(mismatch());
    }));
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
