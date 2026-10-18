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
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { compileShippingProfileDeletionContracts, decodeShippingProfileDeletionIds } from "./shipping-profile-delete-input";

import { prepareShippingProfileDeletionValidationRead } from "./shipping-profile-validation-read";

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];
/** The genuine service invokes this one internal read before lifecycle writes.
 * Its Option repository and FK parents remain denied sibling capabilities. */
export function prepareShippingProfileDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingProfileDeletionContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.profile, "ShippingProfile", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = prepareShippingProfileDeletionValidationRead(contracts);
      const lifecycle = (operation: "softDelete" | "restore"): DAL.RepositoryService["softDelete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const ids = yield* Effect.fromResult(decodeShippingProfileDeletionIds(captured));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, operation);
          const roots = yield* lifecycle.roots(contracts.profile, ids);
          const plan = yield* lifecycle.plan(contracts.profile, roots);
          if (plan.rows(contracts.profile).length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(contracts.profile)) yield* Effect.fromResult(contracts.decodeProfileRow(projectNativeRow(row)));
          const result = yield* plan.apply();
          const decoded = yield* Effect.fromResult(contracts.decodeLifecycleResult([result.roots, result.cascades]));
          if (shared === undefined || operation === "softDelete" && !events.isSubscribed(shared))
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.cascades(result.cascades, shared, row => ({ entity: row,
            originalEntity: { deleted_at: operation === "softDelete" ? null : row.updated_at } }));
          return decoded;
        })));
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured))
          .pipe(Effect.map(rows => structuredClone(rows)))),
        softDelete: lifecycle("softDelete"), restore: lifecycle("restore") };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
