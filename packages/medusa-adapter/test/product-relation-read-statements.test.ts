import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand, getCommerceCommand, type CommerceAnnouncement, type CommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { createCorePGliteFixture, createCorePostgresFixture } from "../../persistence-postgres/test/core/fixture";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import type { CoreSqlConnection, CoreSqlDriver } from "../../persistence-postgres/src/database/corePersistence/driver";
import { findProducts } from "../src/modules/product/query";
import { prepareProductReadInput } from "../src/modules/product/service-input";
import { createCoreProductFixture, type CoreProductFixture } from "./support/core-product-fixture";

/** Statements one warmed Product read sends, measured on PGlite and on ordinary-role
 * PostgreSQL, from a write host and from a read-only host. `retrieve` and `listIds` are
 * the benchmark's shapes (variants, options, images, tags, categories): the root read,
 * one first-page batch for the five reads keyed by the Product, then the tags and the
 * categories behind their pivots, each read in place in its unchanged turn. A read of
 * several keys is itself a first-page batch. `listPage` is the page shape (variants,
 * images) behind a PostgreSQL page walk. Unannounced, each relation read sends its own
 * statement: 8, 8 and 3. */
const READ_STATEMENTS = {
  retrieve: { statements: 4, firstPageBatches: 3 },
  listIds: { statements: 4, firstPageBatches: 4 },
  listPage: { statements: 2, firstPageBatches: 1 },
};
/** The nested shape reads the options' values and the variants' pivot in place as well. */
const NESTED_STATEMENTS = { announced: 6, unannounced: 10 };
/** The nested shape's relation finds by table in the tree's depth-first order. The
 * variants' option values reuse the rows the options' values read selected. */
const NESTED_FINDS = ["image", "product_option", "product_option_value", "product_variant", "product_variant_option",
  "product_tags", "product_tag", "product_category_product", "product_category"];
/** The one announcement: the reads keyed by the Product. */
const NESTED_ANNOUNCED = ["image", "product_option", "product_variant", "product_tags", "product_category_product"];
const Row = Schema.Struct({ variants: Schema.Array(Schema.Struct({ options: Schema.Array(Schema.Unknown) })),
  options: Schema.Array(Schema.Struct({ values: Schema.Array(Schema.Unknown) })), images: Schema.Array(Schema.Unknown),
  tags: Schema.Array(Schema.Unknown), categories: Schema.Array(Schema.Unknown), collection: Schema.Unknown, type: Schema.Unknown });
const decodeProbe = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Row), finds: Schema.Array(Schema.String),
  announced: Schema.Array(Schema.Array(Schema.String)) }), { onExcessProperty: "preserve" });
const decodeFind = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.Unknown])));
const fullRelations = ["variants", "options", "images", "tags", "categories"];
const nestedRelations = ["variants", "variants.options", "options", "options.values", "images", "tags", "categories", "collection", "type"];
const firstPageBatch = "jsonb_to_recordset($3::jsonb)";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product read driver");
let fixture: CoreProductFixture;
let host: CommerceHost;
let reader: Pick<CommerceHost, "read" | "close">;
let announcedProbe: ReturnType<typeof defineCommerceCommand>, plainProbe: ReturnType<typeof defineCommerceCommand>;
/** Set only while one test records the statements the serving role sends. */
let recording: string[] | undefined;
/** The slots each recorded first-page batch asks for. */
let recordingSlots: number[] | undefined;
const decodeSlots = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Unknown)));
const second = "relation-read-1", ids = ["relation-read-0", second, "relation-read-2"];
/** Enough Products that one node's five reads hold more finds than Core examines of one announcement. */
const wide = Array.from({ length: 60 }, (_, index) => "relation-wide-" + index);
const decodeWide = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Unknown), finds: Schema.Array(Schema.String),
  announced: Schema.Array(Schema.Array(Schema.String)) }), { onExcessProperty: "preserve" });

const run = <Value>(work: Effect.Effect<Value, unknown>) => Effect.runPromise(work);
async function recorded<Value>(work: () => Promise<Value>) {
  const statements: string[] = [], slots: number[] = [];
  recording = statements; recordingSlots = slots;
  try { return { value: await work(), statements, slots }; } finally { recording = undefined; recordingSlots = undefined; }
}
const batches = (statements: readonly string[]) => statements.filter(statement => statement.includes(firstPageBatch)).length;
const readInput = (input: unknown) => Effect.fromResult(prepareProductReadInput(input));

describe("Product relation reads on shared Core storage", () => {
  beforeAll(async () => {
    const observe = <Connection extends CoreSqlConnection>(connection: Connection): Connection => ({ ...connection,
      query: (statement, parameters) => {
        recording?.push(statement);
        const bounds = parameters?.[2];
        if (statement.includes(firstPageBatch) && typeof bounds === "string") recordingSlots?.push(decodeSlots(bounds).length);
        return connection.query(statement, parameters);
      } });
    const wrapRuntimeDriver = (physical: CoreSqlDriver): CoreSqlDriver => ({ ...observe(physical),
      write: (statement, parameters) => { recording?.push(statement); return physical.write(statement, parameters); },
      withConnection: work => physical.withConnection(connection => work(observe(connection))),
      transaction: work => physical.transaction(connection => work(observe(connection))) });
    const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (driver === "postgres" && (postgresUrl === null || provisioning === undefined)) throw new Error("Product reads require ordinary and provisioning PostgreSQL endpoints");
    const physical = driver === "postgres" && postgresUrl !== null && provisioning !== undefined
      ? await createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning, wrapRuntimeDriver })
      : await createCorePGliteFixture({ wrapRuntimeDriver });
    fixture = await createCoreProductFixture(driver, { physical });
    const metadata = fixture.runtime.metadata;
    /** The genuine Product read with every relation find and announcement it issues. */
    const probe = (name: string, announces: boolean) => defineCommerceCommand(name, "read", Effect.fn(function* (ctx, input) {
      const finds: string[] = [], announced: string[][] = [];
      const { announce, ...plain } = ctx;
      const observed = { ...plain,
        table: (id: string) => ctx.table(id).pipe(Effect.map(store => ({ ...store,
          find: (manager: typeof ctx.manager, query: unknown) => { finds.push(JSON.stringify([id, query])); return store.find(manager, query); } }))),
        ...(announces && announce !== undefined ? { announce: (announcement: CommerceAnnouncement) => {
          announced.push((announcement.finds ?? []).map(find => JSON.stringify([find.tableName, find.query])));
          return announce(announcement);
        } } : {}) };
      const result = yield* findProducts(observed, metadata, input, false);
      return { rows: result.rows, finds, announced };
    }));
    announcedProbe = probe("productRelationReadAnnounced", true); plainProbe = probe("productRelationReadPlain", false);
    host = await fixture.run(fixture.openHost({ commands: [...fixture.commands, announcedProbe, plainProbe] }));
    reader = await fixture.run(fixture.openReadHost({ commands: [...fixture.commands.filter(command => getCommerceCommand(command)?.mode === "read"), announcedProbe, plainProbe] }));
    const { commands } = fixture.runtime;
    const tags = await run(host.run(host.newRequestKey(), commands.createTags, [{ value: "relation-read-a" }, { value: "relation-read-b" }]));
    const categories = await run(host.run(host.newRequestKey(), commands.createCategories, [{ name: "Relation read A" }, { name: "Relation read B" }]));
    const created = (value: Json) => {
      const rows = isJsonObject(value) && Array.isArray(value.payload) ? value.payload : value;
      if (!Array.isArray(rows)) throw new Error("Unexpected create result");
      return rows.map(row => { if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Missing created ID"); return row.id; });
    };
    const tagIds = created(tags), categoryIds = created(categories);
    await run(host.run(host.newRequestKey(), commands.create, ids.map((id, index) => ({ id, title: "Relation read " + index,
      images: [{ url: "https://example.test/" + id + "/0.png" }, { url: "https://example.test/" + id + "/1.png" }],
      options: [{ title: "Size", values: ["S", "L"] }], tag_ids: tagIds, category_ids: categoryIds,
      variants: [{ title: id + " small", options: { Size: "S" } }, { title: id + " large", options: { Size: "L" } }] }))));
  }, 180_000);
  afterAll(async () => {
    await fixture.run(Effect.all([host.close, reader.close], { mode: "result" }));
    await fixture.close();
  }, 180_000);

  it.each([
    ["retrieve", "retrieve", { id: second, config: { relations: fullRelations } }],
    ["listIds", "list", { filters: { id: ids }, config: { relations: fullRelations } }],
    ["listPage", "list", { filters: {}, config: { take: 20, skip: 0, order: { id: "ASC" }, relations: ["variants", "images"] } }],
  ] as const)("sends the %s shape's measured statements from a write host and from a read-only host", async (shape, command, input) => {
    for (const read of [host.read, reader.read]) {
      const prepared = await run(readInput(input));
      await run(read(fixture.runtime.commands[command], prepared));
      const { statements } = await recorded(() => run(read(fixture.runtime.commands[command], prepared)));
      expect({ statements: statements.length, firstPageBatches: batches(statements) }).toEqual(READ_STATEMENTS[shape]);
    }
  });

  it.each([
    ["retrieve", { where: { id: second }, options: { populate: nestedRelations } }],
    ["list by IDs", { where: { id: ids }, options: { populate: nestedRelations } }],
  ] as const)("returns a nested %s and issues its relation finds identically with and without announcements", async (_shape, input) => {
    const outcome = (value: Json) => decodeProbe(value);
    for (const read of [host.read, reader.read]) {
      await run(read(announcedProbe, input));
      const announced = await recorded(() => run(read(announcedProbe, input)));
      const plain = await recorded(() => run(read(plainProbe, input)));
      const hinted = outcome(announced.value), control = outcome(plain.value);
      expect(hinted.rows).toEqual(control.rows);
      for (const row of hinted.rows) expect({ variants: row.variants.map(variant => variant.options.length), options: row.options.map(option => option.values.length),
        images: row.images.length, tags: row.tags.length, categories: row.categories.length, collection: row.collection, type: row.type })
        .toEqual({ variants: [1, 1], options: [2], images: 2, tags: 2, categories: 2, collection: null, type: null });
      // The same finds, of the same tables with the same queries, in the same order.
      expect(hinted.finds).toEqual(control.finds);
      expect(hinted.finds.map(find => decodeFind(find)[0])).toEqual(NESTED_FINDS);
      // The announcement held exactly the queries its finds then received, in their order.
      expect(control.announced).toEqual([]);
      const [first, ...later] = hinted.announced;
      expect(later).toEqual([]);
      expect(first?.map(find => decodeFind(find)[0])).toEqual(NESTED_ANNOUNCED);
      expect(first).toEqual(hinted.finds.filter(find => first?.includes(find)));
      expect({ announced: announced.statements.length, unannounced: plain.statements.length }).toEqual(NESTED_STATEMENTS);
    }
  });

  it("announces only whole reads of a node whose reads exceed Core's find bound, and sends no more statements than unannounced", async () => {
    for (let start = 0; start < wide.length; start += 20)
      await run(host.run(host.newRequestKey(), fixture.runtime.commands.create, wide.slice(start, start + 20).map(id => ({ id, title: "Relation wide " + id }))));
    const input = { where: { id: wide }, options: { populate: fullRelations, limit: wide.length } };
    for (const read of [host.read, reader.read]) {
      await run(read(announcedProbe, input));
      const announced = await recorded(() => run(read(announcedProbe, input)));
      const plain = await recorded(() => run(read(plainProbe, input)));
      const hinted = decodeWide(announced.value), control = decodeWide(plain.value);
      expect(hinted.rows).toHaveLength(wide.length);
      expect(hinted.rows).toEqual(control.rows);
      expect(hinted.finds).toEqual(control.finds);
      // Five reads keyed by the Product, each one find per Product, were announced.
      expect(hinted.announced.map(finds => finds.length)).toEqual([5]);
      // Unannounced, the root read and each of the five reads is its own batch.
      expect(plain.slots).toEqual(Array.from({ length: 6 }, () => wide.length));
      // Announced, one batch holds the four reads that fit whole. The fifth is not
      // covered in part: it reads in one batch of its own, as it does unannounced.
      expect(announced.slots).toEqual([wide.length, 4 * wide.length, wide.length]);
      expect(announced.statements.length).toBeLessThanOrEqual(plain.statements.length);
      expect({ announced: announced.statements.length, unannounced: plain.statements.length }).toEqual({ announced: 3, unannounced: 6 });
    }
  }, 180_000);
});
