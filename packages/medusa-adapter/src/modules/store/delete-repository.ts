import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import type { captureStoreMetadata } from "./schema";
import { compileStoreDeletionContracts, decodeStoreDeletionIds } from "./delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"];

/** Only the Store root repository admits lifecycle operations. Child repositories
 * retain native constructor identity but grant no independent data operations. */
export function prepareStoreDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileStoreDeletionContracts(metadata);
    const prepared = yield* prepareScalarRepository(contracts.store, "Store", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(root, owner);
      const { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(decodeStoreDeletionIds(captured));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, operation);
          const roots = yield* lifecycle.roots(contracts.store, ids);
          const plan = yield* lifecycle.plan(contracts.store, roots);
          // Plan the complete historical closure before any managed transition.
          // Bounds include already-deleted children, not just active matches.
          for (const entity of contracts.entities) {
            const rows = plan.rows(entity.table);
            if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of rows) yield* Effect.fromResult(entity.decodeRow(row));
          }
          const result = yield* plan.apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots, result.cascades]));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          // Pinned native Drizzle deliberately announces every cascaded delete
          // as deleted, including historical children. Restore announces even
          // already-active selected rows through its conventional dispatcher.
          yield* events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return decoded;
        })));
      const repository: DAL.RepositoryService = { ...denied, softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
