import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { compileServiceZoneDeletionContracts, decodeServiceZoneDeletionIds } from "./service-zone-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

/** Lifecycle traversal owns complete historical selections and managed writes.
 * Native presentation orders the actual affected models for maps and events. */
export function prepareServiceZoneDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileServiceZoneDeletionContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.zone, "ServiceZone", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const runLifecycle = Effect.fn("ServiceZoneDelete.lifecycle")(function* (ctx: CommerceCommandContext,
        captured: unknown, shared: Parameters<DAL.RepositoryService["softDelete"]>[1], operation: "softDelete" | "restore") {
        const ids = yield* Effect.fromResult(decodeServiceZoneDeletionIds(captured));
        const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, operation);
        const roots = yield* lifecycle.roots(contracts.zone, ids), plan = yield* lifecycle.plan(contracts.zone, roots);
        for (const entity of contracts.entities) {
          const rows = plan.rows(entity.table);
          if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of rows) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
        }
        const result = yield* plan.apply(), cascades = yield* Effect.fromResult(contracts.nativeCascades(result.cascades));
        const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots.map(projectNativeRow), cascades]));
        if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
          return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.cascades(cascades, shared, row => ({ entity: row,
          originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
        return decoded;
      });
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, runLifecycle(ctx, captured, shared, operation)));
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
