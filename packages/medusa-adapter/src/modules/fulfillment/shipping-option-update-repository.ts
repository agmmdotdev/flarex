import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { fillNullToOneRelations } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { projectNativeRow } from "../../repository/result";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { executeRead } from "../../query/read";
import { populateCommerceRelations } from "../../query/relations";
import { replaceGraphRows } from "../../write/replace";
import { compileShippingOptionUpdateContracts, ShippingOptionUpdate } from "./shipping-option-update-input";
import { prepareShippingOptionUpdateGraph } from "./shipping-option-update-graph";
import { prepareShippingOptionUpdateQuery } from "./shipping-option-update-query";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: ShippingOptionUpdate }))
  .check(Schema.isMaxLength(4)), "unsupportedProfile");

/** Genuine Fulfillment upsert owns validation and normalization. This selected
 * DAL only translates its update pairs and native relation projections. */
export function prepareShippingOptionUpdateRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionUpdateContracts(metadata), graph = prepareShippingOptionUpdateGraph(contracts),
      reads = yield* prepareShippingOptionUpdateQuery(contracts);
    const scalar = yield* prepareScalarRepository(contracts.option, "ShippingOption", scalarIdWhere);
    // Native DAL.update settles each entry's writes/events first and hydrates
    // the union of requested relations only after the entire cohort is written.
    const mutationProfile = { ...graph.profile, projectionPaths: () => [] };
    const descriptors = new Map(contracts.option.relationships.map(relationship => [relationship.name, { relationship,
      ownerForeignKeys: contracts.option.foreignKeys.filter(key => key.columns[0] === (relationship.name === "provider" ? "provider_id"
        : relationship.name === "shipping_profile" ? "shipping_profile_id" : relationship.name === "type" ? "shipping_option_type_id" : "")).flatMap(key => key.columns) }]));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        const entity = contracts.entities.find(entity => entity.table.name === table);
        if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
        for (const row of rows) yield* entity.decodeRow(projectNativeRow(row));
      });
      const find = Effect.fn("ShippingOptionUpdate.find")(function* (ctx: CommerceCommandContext, table: string, input: unknown, count: boolean) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources)), plan = yield* Effect.fromResult(reads.query(table, captured));
        return yield* executeRead({ manager: ctx.manager, table: ctx.table, resources: ctx.resources, admitSelection }, reads.catalog, plan, count);
      });
      const update = Effect.fn("ShippingOptionUpdate.update")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1]) {
        const pairs = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodePairs)));
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        const output: JsonObject[] = [];
        for (const pair of pairs) {
          const { rules: _rules, type: _type, ...scalar } = pair.entity;
          const entity = yield* Effect.fromResult(contracts.optionEntity.decodeRow(projectNativeRow(scalar)));
          if (entity.id !== pair.update.id) return yield* ctx.refuse(commerceError("invalidInput"));
          const paths = [...(pair.update.type === undefined ? [] : ["type"]), ...(pair.update.rules === undefined ? [] : ["rules"])];
          const replaced = yield* replaceGraphRows(ctx, mutationProfile, graph.option, [pair.update], { relations: paths });
          const rows = yield* Effect.fromResult(contracts.decodeRows(replaced.entities)), row = rows[0];
          if (row === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          output.push(row);
          if (replaced.performedActions.updated.ShippingOption?.some(value => value.id === row.id)) {
            const { rules: _children, type: _owned, ...scalar } = row;
            yield* events.rows("afterUpdate", "ShippingOption", [scalar], shared);
          }
          // Native DAL announces the root before grouped actual child actions.
          for (const [action, event] of [["created", "afterCreate"], ["updated", "afterUpdate"], ["deleted", "afterDelete"]] as const)
            for (const model of ["ShippingOptionType", "ShippingOptionRule"])
              yield* events.rows(event, model, (replaced.performedActions[action][model] ?? []).map(value => ({ ...value })), shared);
        }
        const paths = [...new Set(pairs.flatMap(({ update }) => [...(update.type === undefined ? [] : ["type"]), ...(update.rules === undefined ? [] : ["rules"])]))];
        const populated = yield* populateCommerceRelations({ manager: ctx.manager, table: ctx.table, resources: ctx.resources, admitSelection },
          contracts.option.name, output, paths, contracts.relations, graph.profile.ordering);
        fillNullToOneRelations(populated, descriptors);
        return structuredClone(yield* Effect.fromResult(contracts.decodeRows(populated)));
      });
      const readRepository = (table: string): DAL.RepositoryService => ({ ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, table, captured, false))
          .pipe(Effect.map(result => structuredClone(result.rows)))),
        findAndCount: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const result = yield* find(ctx, table, captured, true);
          if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          return [structuredClone(result.rows), result.count] satisfies [JsonObject[], number];
        }))),
      });
      const repository: DAL.RepositoryService = { ...readRepository(contracts.option.name),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, update(ctx, captured, shared))) };
      return { ...bound, repository, denied, zoneRepository: readRepository(contracts.zone.name), setRepository: readRepository(contracts.set.name),
        providerRepository: readRepository(contracts.provider.name) };
    };
    return { bind, contracts, graph, reads };
  });
}
