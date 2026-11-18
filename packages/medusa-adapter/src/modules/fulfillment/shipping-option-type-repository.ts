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
import { compileShippingOptionTypeCreationContracts, decodeShippingOptionTypePhysicalSelection } from "./shipping-option-type-input";

type Metadata = Effect.Success<ReturnType<typeof captureShippingProfileDeletionMetadata>>["frame"];

/** Scalar create keeps the shared insert/default/event machinery. The retained
 * physical inverse reaches the installed FK owner; referenced Types cannot be
 * removed and no Option or provider mutation is admitted here. */
export function prepareShippingOptionTypeCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionTypeCreationContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.table, "ShippingOptionType", scalarIdWhere,
      input => Effect.fromResult(contracts.decodeRows(input)));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const inserted = yield* bound.createRows(ctx, value, shared);
          return yield* Effect.fromResult(contracts.initializeRows(inserted));
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const selected = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeShippingOptionTypePhysicalSelection)));
          const entities = [{ table: contracts.table, model: "ShippingOptionType" }];
          const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities }, "delete");
          const roots = yield* operation.roots(contracts.table, selected.$or.map(row => row.id));
          const plan = yield* operation.plan(contracts.table, roots);
          if (plan.rows(contracts.table).length > 4) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of plan.rows(contracts.table)) yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)));
          const result = yield* plan.apply(), ids: string[] = [];
          for (const row of result.roots) ids.push((yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(row)))).id);
          return ids;
        }))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
