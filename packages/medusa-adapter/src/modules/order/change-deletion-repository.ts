import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import { readCommerceRelationRows } from "../../query/relations";
import type { captureOrderMetadata } from "./schema";
import { compileOrderChangeDeletionContracts, decodeOrderChangeDeletionIds } from "./change-deletion-input";

type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** Only the Change root admits lifecycle methods. Other native repositories
 * retain constructor identity without granting independent data operations. */
export function prepareOrderChangeDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderChangeDeletionContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.change, "OrderChange", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const method = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(decodeOrderChangeDeletionIds(captured));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, operation);
          const selected = yield* lifecycle.roots(contracts.change, ids);
          if (selected.length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          const candidates: Array<Result.Result.Success<ReturnType<typeof contracts.decodeChangeRow>>> = [];
          for (const row of selected) candidates.push(yield* Effect.fromResult(contracts.decodeChangeRow(projectNativeRow(row))));
          // The selected native PostgreSQL profile's required Order join hides
          // Changes below a deleted Order on forward deletion. Restore selects
          // historical Changes directly and performs no parent Order lookup.
          const orders = operation === "softDelete" && candidates.length > 0
            ? yield* readCommerceRelationRows(ctx, contracts.order.name,
              yield* Effect.fromResult(contracts.orderPredicate(candidates))) : [];
          const roots = operation === "softDelete"
            ? yield* Effect.fromResult(contracts.filterActiveOrderChanges(candidates, orders)) : candidates;
          const plan = yield* lifecycle.plan(contracts.change, roots);
          // Discover and decode the complete historical closure before applying
          // any managed transition. Already-deleted Actions count toward bounds.
          for (const entity of contracts.entities) {
            const rows = plan.rows(entity.table);
            if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of rows) yield* Effect.fromResult<JsonObject, CommerceTransactionError>(entity.decodeRow(projectNativeRow(row)));
          }
          const result = yield* plan.apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([
            result.roots.map(projectNativeRow),
            Object.fromEntries(Object.entries(result.cascades).map(([model, rows]) => [model, rows.map(projectNativeRow)])),
          ]));
          // The pinned native dispatcher announces every cascaded delete,
          // including historical children, and every selected restored row.
          yield* events.cascades(decoded[1], shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return decoded;
        })));
      const repository: DAL.RepositoryService = { ...denied, softDelete: method("softDelete"), restore: method("restore") };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
