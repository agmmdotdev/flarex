import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { executeRead } from "../../query/read";
import { replaceGraphRows } from "../../write/replace";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { compileServiceZoneUpdateContracts, ServiceZoneUpdateNormalized } from "./service-zone-update-input";
import { prepareServiceZoneUpdateGraph } from "./service-zone-update-graph";
import { prepareServiceZoneUpdateQuery } from "./service-zone-update-query";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const GeoIds = Schema.Array(Id).check(Schema.isLengthBetween(1, 16));
// The genuine module passes {id: ids} to its internal service, which forwards
// one selector object as this exact DAL criterion rather than one branch per ID.
const decodeGeoDelete = commerceDecoder(Schema.Struct({ $or: Schema.Tuple([Schema.Struct({ id: GeoIds })]) }), "unsupportedProfile");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: ServiceZoneUpdateNormalized }))
  .check(Schema.isMaxLength(4)), "unsupportedProfile");

/** Genuine native service validation precedes DAL update and private child
 * deletion. No generic upsert or child public CRUD is exposed by this profile. */
export function prepareServiceZoneUpdateRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileServiceZoneUpdateContracts(metadata), graph = prepareServiceZoneUpdateGraph(contracts);
    const read = yield* prepareServiceZoneUpdateQuery(contracts);
    const scalar = yield* prepareScalarRepository(contracts.zone, "ServiceZone", scalarIdWhere,
      Effect.fn("ServiceZoneUpdate.serialize")(function* (input: Json) {
        if (Array.isArray(input)) return yield* Effect.fromResult(contracts.decodeSerializedRows(input));
        const rows = yield* Effect.fromResult(contracts.decodeSerializedRows([input])), row = rows[0];
        if (row === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
        return row;
      }));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const find = Effect.fn("ServiceZoneUpdate.find")(function* (ctx: CommerceCommandContext, input: unknown) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources)), plan = yield* Effect.fromResult(read.query(captured));
        const result = yield* executeRead({ ...ctx, admitSelection: (table, rows) => {
          const entity = graph.catalog.entities.find(entity => entity.table.name === table);
          return entity === undefined ? Result.fail(commerceError("unsupportedProfile")) : graph.profile.admitSelection(entity.table, rows);
        } }, read.catalog, { table: contracts.zone.name, projection: plan.fields, paths: plan.paths, relationFilters: [], ordering: graph.profile.ordering, withDeleted: false,
          query: { fields: plan.fields.storageFields, order: { column: "id", direction: "asc" },
            predicate: { kind: "and", children: [plan.predicate, { kind: "isNull", column: "deleted_at" }] } },
          window: { kind: "catalog", order: "id", select: rows => {
            const keyed: Array<JsonObject & { readonly id: string }> = [];
            for (const row of rows) if (typeof row.id === "string") keyed.push({ ...row, id: row.id });
            const ordered = orderNativeIdRows(keyed, plan.where);
            return { rows: plan.options.limit === undefined ? ordered : ordered.slice(0, plan.options.limit), count: rows.length };
          } },
        }, false);
        return yield* Effect.fromResult(contracts.decodePreimages(result.rows));
      });
      const update = Effect.fn("ServiceZoneUpdate.update")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["update"]>[1]) {
        const pairs = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodePairs)));
        const rows: Array<typeof ServiceZoneUpdateNormalized.Type> = [];
        for (const pair of pairs) {
          const entity = yield* Effect.fromResult(contracts.decodeZoneRow(projectNativeRow(pair.entity)));
          if (entity.id !== pair.update.id) return yield* ctx.refuse(commerceError("invalidInput"));
          rows.push(pair.update);
        }
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        const output: JsonObject[] = [];
        // Native DAL.update processes entries in order and announces each root
        // before that entry's actual child performed actions.
        for (const row of rows) {
          const paths = row.geo_zones === undefined ? [] : ["geo_zones"];
          const result = yield* replaceGraphRows(ctx, graph.profile, graph.zone, [row], { relations: paths });
          const returned = yield* Effect.fromResult(contracts.decodeRows(result.entities));
          const rootChanged = result.performedActions.updated.ServiceZone?.some(value => value.id === row.id) ?? false;
          const actual = returned[0];
          if (actual === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
          output.push(actual);
          if (rootChanged) {
            const { geo_zones: _geo, ...scalar } = actual;
            yield* events.rows("afterUpdate", "ServiceZone", [scalar], shared);
          }
          for (const [action, event] of [["created", "afterCreate"], ["updated", "afterUpdate"], ["deleted", "afterDelete"]] as const) {
            const ids = result.performedActions[action].GeoZone ?? [];
            yield* events.rows(event, "GeoZone", ids.map(value => ({ ...value })), shared);
          }
        }
        return structuredClone([...output]);
      });
      const deleteGeo = Effect.fn("ServiceZoneUpdate.deleteGeo")(function* (ctx: CommerceCommandContext, input: unknown) {
        const selected = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeGeoDelete)));
        const ids = selected.$or[0].id;
        const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities: [{ table: contracts.geo, model: "GeoZone" }] }, "delete");
        const roots = yield* lifecycle.roots(contracts.geo, ids), plan = yield* lifecycle.plan(contracts.geo, roots);
        if (plan.rows(contracts.geo).length > 16) return yield* ctx.refuse(commerceError("limitExceeded"));
        for (const row of plan.rows(contracts.geo)) yield* Effect.fromResult(contracts.decodeGeoRow(projectNativeRow(row)));
        const result = yield* plan.apply(), removed: string[] = [];
        for (const row of result.roots) {
          if (typeof row.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
          removed.push(row.id);
        }
        return removed;
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        find: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, find(ctx, captured)).pipe(Effect.map(rows => structuredClone([...rows])))),
        update: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, update(ctx, captured, shared))),
      };
      const geoRepository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, deleteGeo(ctx, captured))) };
      const mutationEvents = { ...bound.mutationEvents,
        dispatchMutationEvent: ((event, args, shared, subscriber) => bridge.execute(shared, ctx => bridge.checked(ctx, Effect.gen(function* () {
          if ((!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))) || event !== "afterDelete")
            return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* events.dispatch(event, args, shared, subscriber);
        })))) satisfies NonNullable<typeof bound.mutationEvents.dispatchMutationEvent>,
      };
      return { ...bound, repository, geoRepository, denied, mutationEvents };
    };
    return { bind, contracts, graph, ...read };
  });
}
