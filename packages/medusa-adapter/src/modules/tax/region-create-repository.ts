import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceRepositoryContext } from "../../repository/context";
import { commerceMutationEvents } from "../../repository/mutation-events";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { readCommerceRelationRows } from "../../query/relations";
import { projectNativeRow } from "../../repository/result";
import { captureCommerceInput } from "../../value/input";
import type { captureTaxMetadata } from "./schema";
import { compileTaxRegionCreationContracts } from "./region-create-input";
import { prepareTaxRegionParentRepository } from "./region-create-query";
import { makeTaxRegionCreationPlan } from "./region-create-plan";
import { prepareTaxRegionFailurePresentation } from "./region-create-failure";

type Metadata = Effect.Success<ReturnType<typeof captureTaxMetadata>>["frame"];

/** All three native creation callbacks share a single prepared plan and the
 * same native borrowed transaction. Independent Rate/Rule facade contracts stay
 * unchanged. Provider support is confined to reference validation. */
export function prepareTaxRegionCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileTaxRegionCreationContracts(metadata);
    const region = yield* prepareTaxRegionParentRepository(contracts.region);
    const rate = yield* prepareScalarRepository(contracts.rate, "TaxRate", scalarIdWhere, undefined,
      { managedTimestamps: true, nativeRealPresentation: true, nativeToOneCreationPresence: contracts.rate.relationships });
    const rule = yield* prepareScalarRepository(contracts.rule, "TaxRateRule", scalarIdWhere, undefined,
      { managedTimestamps: true, nativeToOneCreationPresence: contracts.rule.relationships });
    const present = yield* prepareTaxRegionFailurePresentation(contracts)
      .pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const creation = makeTaxRegionCreationPlan(contracts);
      const bridge = commerceRepositoryContext(root, owner, { flush: creation.flush, presentExpectedFailure: present(creation) });
      const events = commerceMutationEvents(owner);
      const regions = region.bind(root, owner, events, bridge, creation.region);
      const rates = rate.bind(root, owner, events, bridge, creation.rate);
      const rules = rule.bind(root, owner, events, bridge, creation.rule);
      const denied = deniedCommerceRepository(regions.repository, regions.refuse);
      const regionRepository: DAL.RepositoryService = { ...denied, create: regions.repository.create,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources));
          yield* Effect.fromResult(region.parentQuery(captured));
          const context = { ...ctx, admitSelection: (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
            if (table !== contracts.region.name || rows.length > 4) return yield* Result.fail(commerceError("limitExceeded"));
            const ids = new Set<string>();
            for (const value of rows) {
              const row = yield* contracts.decodeRegionRow(projectNativeRow(value));
              if (row.deleted_at !== null || ids.has(row.id)) return yield* Result.fail(commerceError("storedCorruption"));
              ids.add(row.id);
            }
          }) };
          return structuredClone((yield* regions.find(context, captured, false)).rows);
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(contracts.decodePhysicalSelection)));
          const requestedIds = selection.$or.map(row => row.id);
          const roots = requestedIds.length === 0 ? [] : yield* readCommerceRelationRows(ctx, contracts.region.name,
            { kind: "in", column: "id", values: requestedIds }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true });
          const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete");
          const plan = yield* operation.plan(contracts.region, roots, { rootOrder: "selection" });
          for (const entity of contracts.entities) {
            if (plan.rows(entity.table).length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of plan.rows(entity.table)) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
          }
          const removed = yield* plan.apply(), ids: string[] = [];
          for (const row of removed.roots) ids.push((yield* Effect.fromResult(contracts.decodeRegionRow(projectNativeRow(row)))).id);
          return ids;
        }))),
      };
      const rateRepository: DAL.RepositoryService = { ...denied, create: rates.repository.create };
      const ruleRepository: DAL.RepositoryService = { ...denied, create: rules.repository.create };
      // Nested native Rate serialization occurs before the shared flush and is
      // deliberately a bounded transient projection. Final Region output uses
      // the profile's complete checked-DML output contract after this flush.
      const baseRepository: DAL.RepositoryService = { ...denied, serialize: regions.repository.serialize };
      return { ...regions, bridge, events, baseRepository, regionRepository, rateRepository, ruleRepository, denied };
    };
    return { bind, contracts, parentQuery: region.parentQuery, parentQueryForIds: region.parentQueryForIds };
  });
}
