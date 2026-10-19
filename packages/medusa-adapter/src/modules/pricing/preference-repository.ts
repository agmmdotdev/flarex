import { Effect, Result, Schema } from "effect";
import type { DAL, PricingRepositoryService } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileKeyedUpdates } from "../../write/keyed";
import { prepareScalarRepository } from "../../repository/scalar";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { readCommerceRelationRows } from "../../query/relations";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceRepositoryContext } from "../../repository/context";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import type { capturePricingMetadata } from "./schema";
import { compilePricePreferenceContracts, decodePricePreferenceCreates, decodeStorePreferenceFindWhere,
  decodePricePreferenceDeleteWhere, decodeStorePreferenceUpsertShape, decodePricePreferenceUpdateUpserts, pricePreferenceUpdateWhere,
  decodePricePreferenceDeletionIds } from "./preference-input";

const decodeEnvelope = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.JsonObject }), "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(4)), "unsupportedProfile");
const managed = ["created_at", "updated_at", "deleted_at"];
export type PricingPreferenceRepositoryMode = "store" | "updates" | "deletions";

/** One named PricePreference extension of the existing Pricing owner. Shared
 * scalar reads/creates, keyed writes and lifecycle retain persistence mechanics. */
export function preparePricingPreferenceRepository(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"], mode: PricingPreferenceRepositoryMode = "store") {
  return Result.gen(function* () {
    const updateAdmission = mode === "updates", deletionAdmission = mode === "deletions";
    const contracts = yield* compilePricePreferenceContracts(metadata), table = contracts.table;
    const scalar = yield* prepareScalarRepository(table, "PricePreference", updateAdmission ? pricePreferenceUpdateWhere : { decode: decodeStorePreferenceFindWhere,
      fields: new Map(), selectors: { decode: input => decodeStorePreferenceFindWhere({ $or: input }).pipe(Result.map(value => value.$or)),
        mode: "tuples", key: "id" } }, input => Effect.fromResult(updateAdmission ? contracts.decodeUpdateListOutput(input) : contracts.decodeOutput(input)));
    const updates = compileKeyedUpdates({ keyColumn: "id", repeatedKeys: "reject", decodeEntries: decodePairs,
      readEntry: pair => Result.gen(function* () {
        const before = yield* contracts.decodeRow(projectNativeRow(pair.entity));
        const [update] = yield* (updateAdmission ? decodePricePreferenceUpdateUpserts([pair.update]) : decodeStorePreferenceUpsertShape([pair.update]));
        if (update === undefined || !("id" in update) || update.id !== before.id)
          return yield* Result.fail(commerceError("invalidInput"));
        if ("created_at" in update && (update.created_at !== before.created_at || update.deleted_at !== before.deleted_at))
          return yield* Result.fail(commerceError("invalidInput"));
        // Native compensation carries its complete earlier DTO. Managed fields
        // are read evidence; the shared writer owns the fresh update timestamp.
        return { key: before.id, update: Object.fromEntries(Object.entries(update).filter(([name, value]) =>
          !managed.includes(name) && (name === "id" || value !== undefined && value !== before[name]))) };
      }) });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner,
      sharedEvents?: ReturnType<typeof commerceMutationEvents>, sharedBridge?: ReturnType<typeof commerceRepositoryContext>) => {
      const bound = scalar.bind(root, owner, sharedEvents, sharedBridge), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize };
      const lifecycleMethod = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(decodePricePreferenceDeletionIds(captured));
          const lifecycle = medusaLifecycle(ctx, { tables: [table], entities: [{ table, model: "PricePreference" }] }, operation);
          const roots = yield* lifecycle.roots(table, ids);
          if (roots.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of roots) yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)));
          const result = yield* (yield* lifecycle.plan(table, roots)).apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots, result.cascades]));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          // The native internal restore does not register a mutation subscriber
          // and emits no events, including when deleted rows become active.
          if (operation === "softDelete") yield* events.cascades(result.cascades, shared,
            row => ({ entity: row, originalEntity: { deleted_at: null } }));
          return decoded;
        })));
      const preferenceRepository: DAL.RepositoryService = { ...repository,
        find: deletionAdmission ? bound.refuse : (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const envelope = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodeEnvelope)));
          const plan = yield* Effect.fromResult(scalar.query(envelope));
          if (plan.withDeleted || plan.paths.length || plan.query.skip !== 0 || plan.query.order.direction !== "asc" ||
            plan.query.take !== undefined && plan.query.take < 4 ||
            !updateAdmission && (plan.projection.storageFields.length !== table.columns.length || table.columns.some(column => !plan.projection.storageFields.includes(column.name))))
            return yield* ctx.refuse(commerceError("unsupportedProfile"));
          if (updateAdmission) {
            const predicate = yield* Effect.fromResult(contracts.updatePredicate(envelope.where));
            const rows = yield* readCommerceRelationRows(ctx, table.name, predicate, "id", { includeIdentities: true });
            const complete = yield* Effect.fromResult(contracts.decodeOutput(rows.map(projectNativeRow)));
            const selected = complete.map(row => Object.fromEntries([...plan.projection.node.fields].map(field => [field, row[field]])));
            return structuredClone(yield* Effect.fromResult(contracts.decodeUpdateListOutput(selected)));
          }
          const where = yield* Effect.fromResult(decodeStorePreferenceFindWhere(envelope.where));
          if (where.$or.length === 0) return [];
          const pairs = where.$or;
          if (pairs.every(pair => "id" in pair)) {
            const found = yield* bound.find(ctx, envelope, false);
            const decoded = yield* Effect.fromResult(contracts.decodeOutput(found.rows));
            return structuredClone(orderNativeIdRows(decoded, where));
          }
          const values: string[][] = [];
          for (const pair of pairs) {
            if (!("attribute" in pair)) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            values.push([pair.attribute, pair.value]);
          }
          const rows = yield* readCommerceRelationRows(ctx, table.name, { kind: "and", children: [
            { kind: "indexedPoints", columns: ["attribute", "value"], values }, { kind: "isNull", column: "deleted_at" },
          ] });
          const decoded = yield* Effect.fromResult(contracts.decodeOutput(rows.map(projectNativeRow)));
          return structuredClone(orderNativeIdRows(decoded, where));
        }))),
        create: deletionAdmission ? bound.refuse : (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const rows = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodePricePreferenceCreates)));
          return yield* bound.createRows(ctx, [...rows], shared);
        }))),
        update: deletionAdmission ? bound.refuse : (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const entries = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodePairs)));
          const planned = yield* Effect.fromResult(updates(entries));
          const changed = planned.filter(row => Object.keys(row).length > 1);
          const rows = changed.length === 0 ? [] : yield* (yield* ctx.table(table.name)).write(ctx.manager, "update", changed);
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const output = yield* Effect.fromResult(contracts.decodeOutput(rows.map(projectNativeRow)));
          yield* events.rows("afterUpdate", "PricePreference", output.map(row => ({ ...row })), shared);
          const byId = new Map(output.map(row => [row.id, row]));
          const complete = [];
          for (const [index, entry] of entries.entries()) {
            const before = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(entry.entity)));
            const plan = planned[index];
            if (plan === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
            if (Object.keys(plan).length === 1) complete.push(before);
            else {
              const after = byId.get(before.id);
              if (after === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
              complete.push(after);
            }
          }
          return structuredClone(complete);
        }))),
        delete: deletionAdmission ? bound.refuse : (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(captureCommerceInput(captured, ctx.resources).pipe(Result.flatMap(decodePricePreferenceDeleteWhere)));
          const lifecycle = medusaLifecycle(ctx, { tables: [table], entities: [{ table, model: "PricePreference" }] }, "delete");
          const roots = yield* lifecycle.roots(table, selection.$or.map(row => row.id));
          if (roots.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of roots) yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)));
          const result = yield* (yield* lifecycle.plan(table, roots)).apply();
          const output = yield* Effect.fromResult(contracts.decodeOutput(result.roots.map(projectNativeRow)));
          return output.map(row => row.id);
        }))),
        softDelete: deletionAdmission ? lifecycleMethod("softDelete") : bound.refuse,
        restore: deletionAdmission ? lifecycleMethod("restore") : bound.refuse,
      };
      const calculatePrices: PricingRepositoryService["calculatePrices"] = () => bound.refuse();
      return { ...bound, repository, denied, preferenceRepository, listRepository: denied, ruleRepository: denied,
        priceRepository: denied, calculatePrices };
    };
    return { bind, table: scalar.table, paths: [], contracts };
  });
}
