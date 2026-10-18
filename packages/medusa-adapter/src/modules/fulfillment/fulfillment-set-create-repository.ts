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
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { compileFulfillmentSetCreationContracts, decodeFulfillmentSetPhysicalSelection } from "./fulfillment-set-create-input";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function prepareFulfillmentSetCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileFulfillmentSetCreationContracts(metadata);
    const scalar = yield* prepareScalarRepository(contracts.set, "FulfillmentSet", scalarIdWhere,
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
          const selected = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources).pipe(Result.flatMap(decodeFulfillmentSetPhysicalSelection)));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete");
          const roots = yield* lifecycle.roots(contracts.set, selected.$or.map(row => row.id));
          const plan = yield* lifecycle.plan(contracts.set, roots);
          for (const entity of contracts.entities) {
            const rows = plan.rows(entity.table);
            if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of rows) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
          }
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
