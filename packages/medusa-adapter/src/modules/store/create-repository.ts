import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { replaceGraphRows } from "../../write/replace";
import { captureCommerceInput } from "../../value/input";
import type { captureStoreMetadata } from "./schema";
import { compileStoreCreationContracts, decodeStorePhysicalSelection } from "./create-input";
import { prepareStoreCreationGraph } from "./create-graph";

type Metadata = Effect.Success<ReturnType<typeof captureStoreMetadata>>["frame"];

/** Only the native root upsertWithReplace and physical inverse are admitted.
 * Native performedActions dispatch their own created events; the inverse's
 * generated internal service dispatches only deleted Store root events. */
export function prepareStoreCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileStoreCreationContracts(metadata), graph = yield* prepareStoreCreationGraph(contracts);
    const prepared = yield* prepareScalarRepository(contracts.lifecycle.store, "Store", scalarIdWhere,
      input => Effect.fromResult(contracts.decodeRows(input)));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        upsertWithReplace: (input, config, shared) => bridge.executeInput(shared, { input, config }, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources));
          const args = yield* Effect.fromResult(contracts.decodeUpsert(captured));
          const result = yield* replaceGraphRows(ctx, graph.profile, graph.store, args.input, args.config, true);
          const entities = yield* Effect.fromResult(contracts.decodeRows(result.entities));
          const performedActions = yield* Effect.fromResult(contracts.decodePerformedActions(result.performedActions, entities));
          return { entities: structuredClone([...entities]), performedActions };
        }))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, Effect.gen(function* () {
          const captured = yield* Effect.fromResult(captureCommerceInput(value, ctx.resources));
          const selected = yield* Effect.fromResult(decodeStorePhysicalSelection(captured));
          const { lifecycle } = contracts;
          const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: lifecycle.entities }, "delete");
          const roots = yield* operation.roots(lifecycle.store, selected.$or.map(row => row.id));
          const plan = yield* operation.plan(lifecycle.store, roots);
          for (const entity of lifecycle.entities) {
            const rows = plan.rows(entity.table);
            if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
            for (const row of rows) yield* Effect.fromResult(entity.decodeRow(row));
          }
          const result = yield* plan.apply(), ids: string[] = [];
          for (const row of result.roots) {
            yield* Effect.fromResult(lifecycle.decodeStoreRow(row));
            if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
            ids.push(row.id);
          }
          return ids;
        }))),
      };
      const mutationEvents = { ...bound.mutationEvents,
        dispatchMutationEvent: ((event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) ||
            event !== "afterCreate" && event !== "afterDelete") return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.dispatch(event, args, shared, subscriber);
        })))) satisfies NonNullable<typeof bound.mutationEvents.dispatchMutationEvent>,
      };
      return { ...bound, repository, denied, mutationEvents };
    };
    return { bind, contracts, graph };
  });
}
