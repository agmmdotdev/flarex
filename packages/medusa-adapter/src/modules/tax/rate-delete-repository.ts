import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { readCommerceRelationRows } from "../../query/relations";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import type { captureTaxMetadata } from "./schema";
import { compileTaxRateDeletionContracts, decodeTaxRateDeletionIds } from "./rate-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** Native default joins require active Regions for deletion and historical
 * Regions for restore. Shared lifecycle owns complete descendant discovery,
 * managed writes and constraints; no Region/provider repository is granted. */
export function prepareTaxRateDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileTaxRateDeletionContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.rate, "TaxRate", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const method = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeTaxRateDeletionIds)));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const predicate: JsonObject = { kind: "in", column: "id", values: ids };
          const selected = ids.length === 0 ? [] : yield* readCommerceRelationRows(ctx, contracts.rate.name,
            operation === "restore" ? predicate : { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] });
          if (selected.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          const candidates: JsonObject[] = [], regionIds = new Set<string>();
          for (const value of selected) {
            const row = yield* Effect.fromResult(contracts.decodeRateRow(projectNativeRow(value)));
            if (typeof row.tax_region_id !== "string" || operation === "softDelete" && row.deleted_at !== null)
              return yield* ctx.refuse(commerceError("storedCorruption"));
            regionIds.add(row.tax_region_id); candidates.push(row);
          }
          if (regionIds.size > 2) return yield* ctx.refuse(commerceError("limitExceeded"));
          const regionPredicate: JsonObject = { kind: "in", column: "id", values: [...regionIds] };
          const support = candidates.length === 0 ? [] : yield* readCommerceRelationRows(ctx, contracts.region.name,
            operation === "restore" ? regionPredicate : { kind: "and", children: [regionPredicate, { kind: "isNull", column: "deleted_at" }] });
          const visibleRegions = new Set<string>();
          for (const value of support) {
            const row = yield* Effect.fromResult(contracts.decodeRegionRow(projectNativeRow(value)));
            if (!regionIds.has(row.id) || visibleRegions.has(row.id) || operation === "softDelete" && row.deleted_at !== null)
              return yield* ctx.refuse(commerceError("storedCorruption"));
            visibleRegions.add(row.id);
          }
          const roots = candidates.filter(row => typeof row.tax_region_id === "string" && visibleRegions.has(row.tax_region_id));
          const lifecycle = medusaLifecycle(ctx, { tables: contracts.tables, entities: contracts.entities }, operation);
          const plan = yield* lifecycle.plan(contracts.rate, roots), before = new Map<string, Map<string, JsonObject>>();
          for (const entity of contracts.entities) {
            const values = plan.rows(entity.table);
            if (values.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            const group = new Map<string, JsonObject>();
            for (const value of values) {
              const row = yield* Effect.fromResult(entity.decodeRow(projectNativeRow(value)));
              group.set(row.id, row);
            }
            before.set(entity.table.name, group);
          }
          const result = yield* plan.apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([
            result.roots.map(projectNativeRow), Object.fromEntries(Object.entries(result.cascades).map(([model, rows]) => [model, rows.map(projectNativeRow)])),
          ]));
          if (operation === "softDelete") for (const entity of contracts.entities) {
            const rows = decoded[1][entity.model];
            if (!rows?.length) continue;
            const preimages = before.get(entity.table.name), dispatch: JsonObject[] = [];
            const changes = new WeakMap<object, { entity: JsonObject; originalEntity: JsonObject }>();
            for (const row of rows) {
              const originalEntity = typeof row.id === "string" ? preimages?.get(row.id) : undefined;
              if (originalEntity === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
              const presented = { ...row };
              dispatch.push(presented); changes.set(presented, { entity: presented, originalEntity });
            }
            yield* events.rows("afterUpdate", entity.model, dispatch, shared, row => {
              const change = changes.get(row);
              if (change === undefined) throw commerceError("storedCorruption");
              return change;
            });
          }
          // Native restore has no mutation subscriber and emits no messages.
          return decoded;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        softDelete: method("softDelete"), restore: method("restore") };
      return { ...bound, repository, rateRepository: repository, denied };
    };
    return { bind, contracts };
  });
}
