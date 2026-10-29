import { Effect, Result, Schema } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { fillEmptyToManyRelations } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import { captureNativeRecord } from "../../value/native-record";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { projectNativeRow } from "../../repository/result";
import { medusaLifecycle } from "../../repository/lifecycle";
import { captureGraph, insertGraphRows } from "../../write/create";
import type { CreationNode, CreationProfile, GraphCatalog } from "../../write/graph-model";
import { prepareCartCreationOwnership } from "./creation-ownership";
import type { prepareCartPaymentRead } from "./payment-read";
import type { captureCartCreationMetadata } from "./creation-schema";

type Metadata = Effect.Success<ReturnType<typeof captureCartCreationMetadata>>["frame"];
type PreparedRead = Result.Result.Success<ReturnType<typeof prepareCartPaymentRead>>;
const batch = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "unsupportedProfile");
const normalized = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const id = commerceDecoder(Schema.String.check(Schema.isLengthBetween(1, 256)), "unsupportedProfile");
const removal = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Schema.String })).check(Schema.isMaxLength(8)) }), "unsupportedProfile");
const definitions = [["cart_address", "Address"], ["cart", "Cart"], ["cart_line_item", "LineItem"],
  ["cart_line_item_tax_line", "LineItemTaxLine"], ["cart_line_item_adjustment", "LineItemAdjustment"]] as const;

/** Native Cart owns creation, ordering, separate Line Item calls and retained
 * ownership decisions. This binding supplies checked DML writes and borrowed
 * lifecycle capabilities to that single genuine service instance. */
export function prepareCartCreationRepository(metadata: Metadata, read: PreparedRead) {
  return Result.gen(function* () {
    if (read.profile !== "creation") return yield* Result.fail(commerceError("unsupportedProfile"));
    const ownership = yield* prepareCartCreationOwnership(metadata);
    const entities = yield* Result.all(definitions.map(([name, model]) => Result.gen(function* () {
      const contract = read.byName.get(name);
      if (contract === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      const primary = contract.table.columns.filter(column => column.primaryKey);
      if (primary.length !== 1 || primary[0]?.name !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      return { ...contract, model, graph: { table: contract.table, model, keyColumn: "id", prefix: primary[0].options?.prefix },
        create: commerceRowDecoder([...contract.table.columns.filter(column => !["created_at", "updated_at", "deleted_at"].includes(column.name)).map(column => column.name),
          ...(name === "cart" ? ["shipping_address", "billing_address"] :
            name === "cart_line_item" ? ["tax_lines", "adjustments"] : [])], "unsupportedProfile") };
    })));
    const entity = (name: typeof definitions[number][0]) => {
      const result = entities.find(entity => entity.table.name === name);
      return result === undefined ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(result);
    };
    const address = yield* entity("cart_address"), cart = yield* entity("cart"), line = yield* entity("cart_line_item");
    const tax = yield* entity("cart_line_item_tax_line"), adjustment = yield* entity("cart_line_item_adjustment");
    const catalog: GraphCatalog = { entities: entities.map(entity => entity.graph), tables: metadata.tables, writablePivots: [], queryRelations: new Map(),
      decodeRow: (current, value) => Result.gen(function* () {
        const contract = entities.find(candidate => candidate.table.name === current.table.name);
        if (contract === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        const supplied = yield* normalized(yield* contract.create(value));
        return { supplied, key: supplied.id === undefined ? undefined : yield* id(supplied.id) };
      }), decodeReference: (_entity, value) => id(value).pipe(Result.map(key => ({ key }))),
      decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")) };
    const addressNode: CreationNode = { entity: address.graph, omitRelations: [], steps: [] };
    for (const name of ["shipping_address", "billing_address"]) {
      const declared = cart.table.relationships.find(relation => relation.name === name);
      if (declared?.type !== "hasOneWithFK" || declared.targetTable !== address.table.name ||
        declared.foreignKeyNames?.length !== 1 || declared.foreignKeyNames[0] !== name + "_id" ||
        !cart.table.foreignKeys.some(key => key.columns.length === 1 && key.columns[0] === name + "_id" &&
          key.referencedTable === address.table.name && key.referencedColumns.length === 1 && key.referencedColumns[0] === "id"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const cartNode: CreationNode = { entity: cart.graph, omitRelations: ["shipping_address", "billing_address"], steps: [
      { kind: "ownedToOne", name: "shipping_address", foreignKey: "shipping_address_id", node: addressNode },
      { kind: "ownedToOne", name: "billing_address", foreignKey: "billing_address_id", node: addressNode },
    ] };
    const lineTargets = [["tax_lines", tax], ["adjustments", adjustment]] as const;
    const lineSteps = yield* Result.all(lineTargets.map(([name, target]) => Result.gen(function* () {
      const declared = read.relations.get(line.table.name)?.get(name);
      if (declared?.join.type !== "hasMany" || declared.targetTable !== target.table.name ||
        declared.join.foreignKeys.length !== 1 || declared.join.foreignKeys[0] !== "item_id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      return { kind: "children" as const, name, foreignKey: "item_id", node: { entity: target.graph, omitRelations: [], steps: [] } };
    })));
    const lineNode: CreationNode = { entity: line.graph, omitRelations: ["tax_lines", "adjustments"], steps: lineSteps };
    const profile = (root: CreationNode): CreationProfile => ({ catalog, root,
      rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) });
    const normalize = Effect.fn("CartCreation.captureNativeRows")(function* (input: unknown, target: typeof entities[number]) {
      const rows: JsonObject[] = [];
      for (const value of yield* Effect.fromResult(batch(input))) {
        const captured = yield* captureNativeRecord(value), children: Record<string, unknown> = {};
        for (const name of target === cart ? ["shipping_address", "billing_address"] : target === line ? ["tax_lines", "adjustments"] : []) {
          const member = captured[name]; delete captured[name];
          if (member === undefined) continue;
          if (target === cart) {
            children[name] = member === null || typeof member === "string" ? member : yield* captureExactNumericRow(member, address.numbers);
          } else {
            const child = name === "tax_lines" ? tax : adjustment, converted: JsonObject[] = [];
            for (const item of yield* Effect.fromResult(batch(member))) converted.push(yield* captureExactNumericRow(item, child.numbers, false, "nativeRaw"));
            children[name] = converted;
          }
        }
        rows.push(yield* Effect.fromResult(normalized({ ...(yield* captureExactNumericRow(captured, target.numbers, false, "nativeRaw")), ...children })));
      }
      return rows;
    });
    const bind = (root: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = read.bind(root, owner), { bridge, events } = bound;
      const claims = ownership.bind(root, owner, { bridge, events });
      const checked = (table: string, rows: readonly JsonObject[]) => Result.gen(function* () {
        const target = read.byName.get(table);
        if (target === undefined || rows.length > 8) return yield* Result.fail(commerceError("unsupportedProfile"));
        const result: JsonObject[] = []; for (const row of rows) result.push(yield* target.complete(projectNativeRow(row)));
        return result;
      });
      const create = (target: typeof cart | typeof line, node: CreationNode): DAL.RepositoryService["create"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          if (shared === undefined || !events.isSubscribed(shared)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const creation = profile(node), graph = yield* captureGraph(creation, captured, ctx.resources);
          const written = yield* insertGraphRows(ctx, catalog, graph.rows), created = yield* Effect.fromResult(checked(target.table.name, written.get(target.table.name) ?? []));
          const notifications = [];
          for (const current of entities) for (const row of yield* Effect.fromResult(checked(current.table.name, written.get(current.table.name) ?? [])))
            notifications.push({ modelName: current.model, entity: { ...row } });
          yield* events.created(notifications, shared);
          const detached = structuredClone(created);
          fillEmptyToManyRelations(detached, new Map(target.table.relationships.map(relationship => [relationship.name, { relationship }])));
          return bound.remember(detached, target.table.name);
        })), (_ctx, input) => normalize(input, target));
      const remove = (target: typeof cart | typeof address): DAL.RepositoryService["delete"] => (input, shared) =>
        bridge.executeInput(shared, input, (ctx, captured) => bridge.checked(ctx, Effect.gen(function* () {
          const selection = yield* Effect.fromResult(removal(captured));
          const lifecycle = medusaLifecycle(ctx, { tables: metadata.tables, entities }, "delete");
          const changed = yield* (yield* lifecycle.plan(target.table, yield* lifecycle.roots(target.table, selection.$or.map(row => row.id)))).apply();
          const rows = yield* Effect.fromResult(checked(target.table.name, changed.roots));
          return yield* Effect.fromResult(Result.all(rows.map(row => id(row.id))));
        })));
      const repository: DAL.RepositoryService = { ...bound.repository, create: create(cart, cartNode), delete: remove(cart) };
      const lineItemRepository: DAL.RepositoryService = { ...bound.lineItemRepository, create: create(line, lineNode) };
      const addressRepository: DAL.RepositoryService = { ...bound.denied, serialize: repository.serialize, delete: remove(address) };
      return { ...bound, repository, lineItemRepository, addressRepository, claims, store: claims.store,
        protocolRepositories: claims.repositories };
    };
    return { ...read, bind, metadata, entities, creationCatalog: catalog, cartNode, lineNode, normalize, ownership };
  });
}

