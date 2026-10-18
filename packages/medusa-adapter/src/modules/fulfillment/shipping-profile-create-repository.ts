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
import { captureCommerceInput } from "../../value/input";
import type { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { compileShippingProfileCreationContracts, decodeShippingProfilePhysicalSelection } from "./shipping-profile-create-input";
import { prepareShippingProfileDeletionValidationRead } from "./shipping-profile-validation-read";

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** The native service owns deletion validation; the DAL owns physical removal
 * and terminal nullable reference detachment, preserving child timestamps. */
export function prepareShippingProfileCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingProfileCreationContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.profile, "ShippingProfile", scalarIdWhere);
    const find = prepareShippingProfileDeletionValidationRead(contracts);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const inserted = yield* bound.createRows(ctx, value, shared);
          return yield* Effect.fromResult(contracts.initializeRows(inserted));
        }))),
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, value) =>
          bridge.checked(ctx, find(ctx, value)).pipe(Effect.map(rows => structuredClone(rows)))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeShippingProfilePhysicalSelection)));
          if (ctx.planSetNull === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
          const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete");
          const roots = yield* operation.roots(contracts.profile, selected.$or.map(row => row.id));
          const plan = yield* operation.plan(contracts.profile, roots);
          if (plan.rows(contracts.profile).length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(contracts.profile)) yield* Effect.fromResult(contracts.decodeProfileRow(projectNativeRow(row)));
          const result = yield* plan.apply(), ids: string[] = [];
          for (const row of result.roots) ids.push((yield* Effect.fromResult(contracts.decodeProfileRow(projectNativeRow(row)))).id);
          // Terminal plans follow every table operation, using the actual
          // removed IDs rather than raw requests, duplicates or missing rows.
          for (const id of ids) yield* ctx.planSetNull({ sourceTable: contracts.option.name, sourceColumn: "shipping_profile_id",
            targetTable: contracts.profile.name, targetColumn: "id", targetKey: id, managedUpdate: "preserve" });
          return ids;
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
