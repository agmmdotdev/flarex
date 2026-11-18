import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import type { captureStockLocationMetadata } from "./schema";
import { compileStockLocationDeletionContracts, decodeStockLocationDeletionIds } from "./delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureStockLocationMetadata>>["frame"];

/** Location roots only over the complete native model catalog. The Address FK
 * remains an unchanged scalar; Address-to-Location cascade is not reversible. */
export function prepareStockLocationDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "stock_location");
    const address = metadata.tables.find(table => table.name === "stock_location_address");
    if (metadata.tables.length !== 2 || table === undefined || address === undefined ||
      table.relationships.some(relation => relation.cascadeDelete))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const contracts = yield* compileStockLocationDeletionContracts(table, address);
    const locations = yield* prepareScalarRepository(table, "StockLocation", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = locations.bind(root, owner);
      const { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(decodeStockLocationDeletionIds(captured));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [{ table, model: "StockLocation" }] }, operation);
          const roots = yield* lifecycle.roots(table, ids);
          for (const row of roots) yield* Effect.fromResult(contracts.decodeRow(row));
          const result = yield* (yield* lifecycle.plan(table, roots)).apply();
          for (const row of result.roots) yield* Effect.fromResult(contracts.decodeRow(row));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          // Native restore uses the conventional aggregator without registering
          // an internal subscriber, including selected already-active rows.
          yield* events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return [result.roots, result.cascades] satisfies [object[], Record<string, unknown[]>];
        })));
      const repository: DAL.RepositoryService = { ...denied, softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      return { ...bound, repository, addressRepository: denied };
    };
    return { bind, contracts };
  });
}
