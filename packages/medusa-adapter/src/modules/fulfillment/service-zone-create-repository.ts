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
import { captureGraph, insertGraphRows } from "../../write/create";
import { captureCommerceInput } from "../../value/input";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { compileServiceZoneCreationContracts, decodeServiceZonePhysicalSelection } from "./service-zone-create-input";
import { prepareServiceZoneCreationGraph } from "./service-zone-create-graph";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function prepareServiceZoneCreationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileServiceZoneCreationContracts(metadata), graph = prepareServiceZoneCreationGraph(contracts);
    const scalar = yield* prepareScalarRepository(contracts.zone, "ServiceZone", scalarIdWhere,
      input => Effect.fromResult(contracts.decodeRows(input)));
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = scalar.bind(root, owner), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const create = Effect.fn("ServiceZoneRepository.create")(function* (ctx: CommerceCommandContext, input: unknown,
        shared: Parameters<DAL.RepositoryService["create"]>[1]) {
        const captured = yield* captureGraph(graph.profile, input, ctx.resources);
        const inserted = yield* insertGraphRows(ctx, graph.catalog, captured.rows);
        const roots = (inserted.get(contracts.zone.name) ?? []).map(projectNativeRow), children = (inserted.get(contracts.geo.name) ?? []).map(projectNativeRow);
        const result = yield* Effect.fromResult(contracts.initializeRows(roots, children));
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.created(roots.flatMap(row => [{ modelName: "ServiceZone", entity: { ...row } },
          ...children.filter(child => child.service_zone_id === row.id).map(child => ({ modelName: "GeoZone", entity: { ...child } }))]), shared);
        return structuredClone([...result]);
      });
      const remove = Effect.fn("ServiceZoneRepository.delete")(function* (ctx: CommerceCommandContext, input: unknown) {
        const selected = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeServiceZonePhysicalSelection)));
        const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.entities }, "delete");
        const roots = yield* operation.roots(contracts.zone, selected.$or.map(row => row.id));
        const plan = yield* operation.plan(contracts.zone, roots);
        for (const entity of contracts.entities) {
          const rows = plan.rows(entity.table);
          if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of rows) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
        }
        const result = yield* plan.apply(), ids: string[] = [];
        for (const row of result.roots) {
          const decoded = yield* Effect.fromResult(contracts.decodeZoneRow(projectNativeRow(row)));
          if (typeof decoded.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
          ids.push(decoded.id);
        }
        return ids;
      });
      const repository: DAL.RepositoryService = { ...denied, serialize: bound.repository.serialize,
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, create(ctx, value, shared))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, value) => bridge.checked(ctx, remove(ctx, value))),
      };
      return { ...bound, repository, denied };
    };
    return { bind, contracts };
  });
}
