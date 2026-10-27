import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { CartProduct, ProductShippingProfile } from "@medusajs/link-modules";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceParticipantInput } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../../../persistence-postgres/test/storage/relationalSchema/neutralLogicalFixture";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { nativeLinkGraphDirectPaths } from "../../src/local-graph/direct-paths";
import { nativeLinkGraphPaths } from "../../src/local-graph/links";
import { defineGraphReadCommand, type GraphReadCommand } from "../../src/local-graph/commands";
import { prepareLocalGraph, decodeGraphCount } from "../../src/local-graph/query";
import { planGraphFields } from "../../src/local-graph/fields";
import type { GraphParticipant, GraphReadDefinition } from "../../src/local-graph/model";
import { lowerDmlSchema } from "../../src/schema/lower";
import type { SchemaTable } from "../../src/schema/model";
import { makeReadCatalog, type ReadTable } from "../../src/query/catalog";
import { executeRead, type ReadPlan } from "../../src/query/read";
import type { CommerceRelations } from "../../src/query/relations";

const bounds = { maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 };
const nativeVariant = Result.getOrThrow(nativeLinkGraphDirectPaths(CartProduct, [{ root: "Cart", path: "items.variant", ...bounds }], "LineItem"));
export const nativeShipping = Result.getOrThrow(nativeLinkGraphPaths(ProductShippingProfile, [{ root: "Cart",
  path: "items.variant.product.shipping_profile", ...bounds, maximumLinks: 4 }], "Product"));
const shipping = (() => {
  const selected = nativeShipping[0];
  if (selected === undefined) throw new Error("Missing native shipping Link");
  return selected;
})();

function table(name: string, columns: readonly string[], indexed: readonly string[] = [], foreignKeys: SchemaTable["foreignKeys"] = [], nullable: readonly string[] = []): SchemaTable {
  return { name, columns: [...columns.map(name => ({ name, type: "text" as const, primaryKey: name === "id", nullable: nullable.includes(name), generated: false })),
    ...["created_at", "updated_at", "deleted_at"].map(name => ({ name, type: "dateTime" as const, primaryKey: false, nullable: name === "deleted_at", generated: false }))],
    indexes: indexed.map(column => ({ name: name + "." + column, columns: [column], unique: false })), foreignKeys };
}
const cart = table("cart", ["id", "title"]), item = table("line_item", ["id", "cart_id", "variant_id"], ["cart_id"], [
  { name: "item.cart", columns: ["cart_id"], referencedTable: "cart", referencedColumns: ["id"] }], ["variant_id"]);
const variant = table("variant", ["id", "product_id", "title"], [], [
  { name: "variant.product", columns: ["product_id"], referencedTable: "product", referencedColumns: ["id"] }]), product = table("product", ["id", "title"]);
const link = table("profile_link", ["id", shipping.sourceColumn, shipping.targetColumn], [shipping.sourceColumn]);
const profile = table("profile", ["id", "name"]);
const cartRelations: CommerceRelations = new Map([[cart.name, new Map([["items", { name: "items", sourcePrimaryKeys: ["id"],
  targetTable: item.name, targetPrimaryKeys: ["id"], join: { type: "hasMany", foreignKeys: ["cart_id"] } }]])]]);
const productRelations: CommerceRelations = new Map([[variant.name, new Map([["product", { name: "product", sourcePrimaryKeys: ["id"],
  targetTable: product.name, targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: ["product_id"] } }]])]]);
const readTable = (table: SchemaTable): ReadTable => ({ name: table.name, columns: table.columns.map(column => column.name),
  primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
  nullableColumns: table.columns.filter(column => column.nullable).map(column => column.name), companions: {} });
const request = Schema.decodeUnknownEffect(Schema.Struct({ filters: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  config: Schema.Struct({ select: Schema.Array(Schema.String), relations: Schema.Array(Schema.String),
    order: Schema.Record(Schema.String, Schema.Literal("ASC")), skip: Schema.Literal(0), take: Schema.Number }) }));

/** Neutral read commands use the actual shared query/population owner over
 * real source storage. The test supplies no row attachment or SQL substitute. */
export function nestedPrefixModules() {
  const groups = [
    { name: "cart", tables: [cart, item], relations: cartRelations, models: ["Cart", "LineItem"] },
    { name: "product", tables: [variant, product], relations: productRelations, models: ["ProductVariant", "Product"] },
    { name: "link", tables: [link], relations: new Map(), models: [shipping.linkModel] },
    { name: "fulfillment", tables: [profile], relations: new Map(), models: [shipping.targetModel] },
  ];
  return groups.map(group => {
    const activity = { reads: 0 };
    const participant = defineAtomicCommerceParticipant("nested-" + group.name);
    const catalog = Result.getOrThrow(makeReadCatalog(group.tables.map(readTable), group.relations));
    const reads = group.tables.map((table, index): GraphReadDefinition => {
      const model = group.models[index];
      if (model === undefined) throw new Error("Missing neutral model");
      const paths = table === cart ? [{ path: "items", table: readTable(item), many: true, sourceFields: ["id"], targetFields: ["id"] }]
        : table === variant ? [{ path: "product", table: readTable(product), many: false, sourceFields: ["product_id"], targetFields: ["id"] }] : [];
      const metadata = { model, table: readTable(table), paths, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, nativeFields: true as const, decode: decodeGraphCount };
      const command: GraphReadCommand = defineGraphReadCommand("nestedRead" + model, (ctx, input) => Effect.gen(function* () {
        activity.reads++;
        const value = yield* request(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
        const selected = yield* Effect.fromResult(planGraphFields({ ...metadata, command }, [...value.config.select,
          ...value.config.relations.map(path => path + ".*")]));
        const plan: ReadPlan = { table: table.name, query: { skip: 0, take: value.config.take,
          order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
            ...Object.entries(value.filters).map(([column, values]) => ({ kind: "in", column, values })), { kind: "isNull", column: "deleted_at" }] } },
          projection: { storageFields: table.columns.map(column => column.name), node: selected.node },
          paths: value.config.relations, withDeleted: false, relationFilters: [], ordering: new Map(), window: { kind: "database", countAt: "beforePopulation" } };
        const result = yield* executeRead(ctx, catalog, plan, true);
        if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
        return [result.rows, result.count];
      }));
      return { ...metadata, command };
    });
    return { ...group, participant, activity, graph: { aliases: reads.map(read => ({ name: read.table.name, model: read.model })), reads,
      ...(group.name === "cart" ? { directPaths: nativeVariant } : {}), ...(group.name === "link" ? { remotePaths: nativeShipping } : {}) } };
  });
}

export function nestedPrefixParticipants(): GraphParticipant[] {
  return nestedPrefixModules().map(group => ({ participant: group.participant, module: group.graph }));
}

export async function verifyNestedPrefixStorage(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const groups = nestedPrefixModules();
    const definitions = groups.map(group => {
      const key = "neutral.nested-prefix." + group.name, evidence = { kind: "synthetic", sourceId: key };
      return { ...group, key, evidence, schema: Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(group.tables, key))) };
    });
    const sources = [];
    for (const definition of definitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({ key: definition.key, owner: "medusa",
      writeProfile: definition.key, evidence: definition.evidence, definition: { kind: "relational", schema: definition.schema },
      bindings: definition.tables.map(table => ({ kind: "definition", localName: table.name, table: { namespace: "medusa", logicalName: definition.key + "/" + table.name } })) })));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-nested-prefix", sources });
    if (driver === "postgres") expect((await fixture.persistence.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const rows: Readonly<Record<string, readonly JsonObject[]>> = {
      cart: [{ table: "cart", row: { id: "same-id", title: "Cart", deleted_at: null } },
        { table: "line_item", row: { id: "line", cart_id: "same-id", variant_id: "same-id", deleted_at: null } },
        { table: "cart", row: { id: "foreign", title: "Other Cart", deleted_at: null } },
        { table: "line_item", row: { id: "other-line", cart_id: "foreign", variant_id: "foreign", deleted_at: null } },
        { table: "cart", row: { id: "manual", title: "Manual Cart", deleted_at: null } },
        { table: "line_item", row: { id: "manual-line", cart_id: "manual", variant_id: null, deleted_at: null } }],
      product: [{ table: "product", row: { id: "product", title: "Product", deleted_at: null } },
        { table: "variant", row: { id: "same-id", product_id: "product", title: "Variant", deleted_at: null } },
        { table: "product", row: { id: "foreign", title: "Other Product", deleted_at: null } },
        { table: "variant", row: { id: "foreign", product_id: "foreign", title: "Other Variant", deleted_at: null } }],
      link: [{ id: "edge", [shipping.sourceColumn]: "product", [shipping.targetColumn]: "same-id", deleted_at: null },
        { id: "other-edge", [shipping.sourceColumn]: "foreign", [shipping.targetColumn]: "foreign", deleted_at: null }],
      fulfillment: [{ id: "same-id", name: "Profile", deleted_at: null }, { id: "foreign", name: "Other Profile", deleted_at: null }],
    };
    const members: AtomicCommerceParticipantInput[] = [];
    for (const definition of definitions) {
      const seed = rows[definition.name] ?? [];
      const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: seed }, 1_048_576,
        { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
      const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: definition.key, writeProfile: definition.key,
        schema: definition.schema, evidence: definition.evidence }, initialization: { stepId: "nested-prefix", datasetSha256: dataset.sha256Hex, expectedRowCount: seed.length } };
      const commands = definition.graph.reads.map(read => read.command);
      await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands,
        identityAndAccessPolicy: { profile: definition.key } }), host => host.initialize(seed), host => host.close));
      members.push({ participant: definition.participant, logicalStorage, commands });
    }
    const graph = Result.getOrThrow(prepareLocalGraph(definitions.map(group => ({ participant: group.participant, module: group.graph }))));
    const query = defineAtomicCommerceCommand("nestedPrefixGraph", (ctx, input) => Effect.gen(function* () {
      const id = yield* Schema.decodeUnknownEffect(Schema.String)(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      return yield* graph.bind(ctx).graph({ entity: "cart", fields: ["title", "items.variant.title", "items.variant.product.title", "items.variant.product.shipping_profile.name"],
        filters: { id: [id] }, pagination: { take: 4 } });
    }));
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput, participants: members, commands: [query],
      executionIsolation: "scopeExclusive", identityAndAccessPolicy: { profile: "neutral-nested-prefix" } }), host => Effect.gen(function* () {
      const key = host.newRequestKey(), result = yield* host.run(key, query, "same-id");
      expect(result).toEqual({ data: [{ title: "Cart", items: [{ variant_id: "same-id", variant: { id: "same-id", title: "Variant", product_id: "product",
        product: { id: "product", title: "Product", shipping_profile: { id: "same-id", name: "Profile" } } } }] }], metadata: { count: 1, skip: 0, take: 4 } });
      const calls = groups.map(group => group.activity.reads);
      expect(calls).toEqual([1, 1, 1, 1]);
      expect(yield* host.run(key, query, "same-id")).toEqual(result);
      expect(groups.map(group => group.activity.reads)).toEqual(calls);
      expect(yield* host.run(host.newRequestKey(), query, "manual")).toEqual({ data: [{ title: "Manual Cart", items: [{ variant_id: null }] }],
        metadata: { count: 1, skip: 0, take: 4 } });
      expect(groups.map(group => group.activity.reads)).toEqual([2, 1, 1, 1]);
    }), host => host.close));
  } finally { for (const close of cleanup.reverse()) await close(); }
}
