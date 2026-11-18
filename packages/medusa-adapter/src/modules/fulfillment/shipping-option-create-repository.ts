import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import { medusaLifecycle } from "../../repository/lifecycle";
import { projectNativeRow } from "../../repository/result";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { captureCommerceInput } from "../../value/input";
import { captureGraph, insertGraphRows } from "../../write/create";
import { executeRead } from "../../query/read";
import { readCommerceRelationRows } from "../../query/relations";
import { compileShippingOptionCreationContracts, decodeShippingOptionPhysicalSelection } from "./shipping-option-create-input";
import { prepareShippingOptionCreationGraph } from "./shipping-option-create-graph";
import { prepareShippingOptionCreationQuery } from "./shipping-option-create-query";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import type { FulfillmentPhysicalProfile } from "./fulfillment-graph-contracts";
import type { commerceMutationEvents } from "../../repository/mutation-events";
import type { commerceRepositoryContext } from "../../repository/context";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function prepareShippingOptionCreationRepository(metadata: Metadata, profile: FulfillmentPhysicalProfile = "standalone") {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionCreationContracts(metadata, profile), graph = prepareShippingOptionCreationGraph(contracts),
      reads = yield* prepareShippingOptionCreationQuery(contracts);
    const scalar = yield* prepareScalarRepository(contracts.option, "ShippingOption", scalarIdWhere);
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner,
      shared?: Readonly<{ bridge: ReturnType<typeof commerceRepositoryContext>; events: ReturnType<typeof commerceMutationEvents> }>) => {
      const bound = scalar.bind(root, owner, shared?.events, shared?.bridge), { bridge, events } = bound;
      const denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const admitSelection = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        const entity = contracts.entities.find(entity => entity.table.name === table);
        if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
        for (const row of rows) yield* entity.decodeRow(projectNativeRow(row));
      });
      const find = Effect.fn("ShippingOptionCreation.find")(function* (ctx: CommerceCommandContext, table: string, input: unknown, count: boolean) {
        const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
        const plan = yield* Effect.fromResult(reads.query(table, captured));
        return yield* executeRead({ manager: ctx.manager, table: ctx.table, resources: ctx.resources, admitSelection }, reads.catalog, plan, count);
      });
      const create = Effect.fn("ShippingOptionCreation.create")(function* (ctx: CommerceCommandContext, input: unknown, shared: Parameters<DAL.RepositoryService["create"]>[1]) {
        const captured = yield* captureGraph(graph.profile, input, ctx.resources), inserted = yield* insertGraphRows(ctx, graph.catalog, captured.rows);
        const options = (inserted.get(contracts.option.name) ?? []).map(projectNativeRow), rules = (inserted.get(contracts.rule.name) ?? []).map(projectNativeRow),
          types = (inserted.get(contracts.type.name) ?? []).map(projectNativeRow);
        // Native create hydrates a supplied relation for the whole cohort.
        // Inline creations use actual write receipts; existing references use
        // the shared complete indexed read, never a second transaction.
        const known = new Set(types.map(row => row.id)), references: string[] = [];
        for (const row of options) if (typeof row.shipping_option_type_id === "string" && !known.has(row.shipping_option_type_id)) references.push(row.shipping_option_type_id);
        const existing = references.length === 0 ? [] : yield* readCommerceRelationRows({ manager: ctx.manager, table: ctx.table, resources: ctx.resources, admitSelection }, contracts.type.name,
          { kind: "and", children: [{ kind: "in", column: "id", values: [...new Set(references)] }, { kind: "isNull", column: "deleted_at" }] });
        const rows = new Map<string, readonly JsonObject[]>([[contracts.option.name, options], [contracts.rule.name, rules],
          [contracts.type.name, [...types, ...existing.map(projectNativeRow)]]]);
        const result = yield* Effect.fromResult(contracts.initializeRows(rows, true));
        if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* events.created(options.flatMap(row => [
          ...types.filter(type => type.id === row.shipping_option_type_id).map(entity => ({ modelName: "ShippingOptionType", entity })),
          { modelName: "ShippingOption", entity: row },
          ...rules.filter(rule => rule.shipping_option_id === row.id).map(entity => ({ modelName: "ShippingOptionRule", entity })),
        ]), shared);
        return structuredClone([...result]);
      });
      const remove = Effect.fn("ShippingOptionCreation.delete")(function* (ctx: CommerceCommandContext, input: unknown) {
        const selected = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources).pipe(Result.flatMap(decodeShippingOptionPhysicalSelection)));
        const operation = medusaLifecycle(ctx, { tables: metadata.tables, entities: contracts.physicalEntities, referenceDetachments: contracts.referenceDetachments }, "delete"),
          roots = yield* operation.roots(contracts.option, selected.$or.map(row => row.id)), plan = yield* operation.plan(contracts.option, roots);
        for (const entity of contracts.physicalEntities) {
          const rows = plan.rows(entity.table);
          if (rows.length > entity.maximum) return yield* ctx.refuse(commerceError("limitExceeded"));
          for (const row of rows) yield* Effect.fromResult(entity.decodeRow(projectNativeRow(row)));
        }
        const result = yield* plan.apply(), ids: string[] = [];
        for (const row of result.roots) {
          const decoded = yield* Effect.fromResult(contracts.optionEntity.decodeRow(projectNativeRow(row)));
          if (typeof decoded.id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
          ids.push(decoded.id);
        }
        return ids;
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
        create: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, create(ctx, captured, shared))),
        delete: (input, shared) => bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, remove(ctx, captured))),
      };
      return { ...bound, repository, denied, zoneRepository: readRepository(contracts.zone.name), setRepository: readRepository(contracts.set.name),
        providerRepository: readRepository(contracts.provider.name) };
    };
    return { bind, contracts, graph, reads };
  });
}
