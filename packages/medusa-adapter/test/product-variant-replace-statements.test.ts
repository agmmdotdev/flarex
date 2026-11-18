import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand, type CommerceAnnouncement, type CommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { createCorePGliteFixture, createCorePostgresFixture } from "../../persistence-postgres/test/core/fixture";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import type { CoreSqlConnection, CoreSqlDriver } from "../../persistence-postgres/src/database/corePersistence/driver";
import { replaceProductRows } from "../src/modules/product/mutation";
import { createCoreProductFixture, type CoreProductFixture } from "./support/core-product-fixture";

/** Statements one warmed replacement of two variants with their option links sends,
 * measured on PGlite and on ordinary-role PostgreSQL; `relink` swaps the option value
 * of two existing variants. Unannounced, each root reads its identity, its Product,
 * its links and its option value in place, and each insert table reads its own slots.
 * Announced, the root selections share one first-page batch and the insert tables of
 * `create` another. */
const REPLACE_STATEMENTS = { create: { announced: 9, plain: 16 }, relink: { announced: 12, plain: 18 } };

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product replacement driver");
let fixture: CoreProductFixture;
let host: CommerceHost;
let probes: Record<"create" | "relink", Record<"announced" | "plain", ReturnType<typeof defineCommerceCommand>>>;
/** Set only while one test records the statements the serving role sends. */
let recording: string[] | undefined;
const products = ["variant-replace-warm", "variant-replace-announced", "variant-replace-plain"] as const;
const values = new Map<string, readonly string[]>();

const run = <Value>(work: Effect.Effect<Value, unknown>) => Effect.runPromise(work);
async function recorded(work: () => Promise<Json>) {
  const statements: string[] = [];
  recording = statements;
  try { return { value: await work(), statements }; } finally { recording = undefined; }
}
function outcome(value: Json) {
  if (!isJsonObject(value) || !Array.isArray(value.calls) || typeof value.announcements !== "number") throw new Error("Unexpected probe result");
  if (typeof value.performedActions !== "string") throw new Error("Unexpected probe actions");
  return { entities: value.entities, performedActions: JSON.parse(value.performedActions), calls: value.calls, announcements: value.announcements };
}
/** The same graph under another Product: its identities and clocks are the only differences. */
function neutral(value: unknown, product: string) {
  let text = JSON.stringify(value).replaceAll(product, "PRODUCT").replaceAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "TIME");
  for (const [index, id] of (values.get(product) ?? []).entries()) text = text.replaceAll(id, "VALUE-" + index);
  return JSON.parse(text.replaceAll(/opt_[0-9A-Z]{26}/g, "OPTION"));
}
const variants = (product: string, order: readonly [number, number]) => {
  const ids = values.get(product);
  if (ids === undefined) throw new Error("Missing option values");
  return order.map((value, index) => ({ id: product + "-variant-" + index, title: "Variant " + index, sku: product + "-sku-" + index, product_id: product, options: [ids[value] ?? null] }));
};

describe("Product variant replacement on shared Core storage", () => {
  beforeAll(async () => {
    const observe = <Connection extends CoreSqlConnection>(connection: Connection): Connection => ({ ...connection,
      query: (statement, parameters) => { recording?.push(statement); return connection.query(statement, parameters); } });
    const wrapRuntimeDriver = (physical: CoreSqlDriver): CoreSqlDriver => ({ ...observe(physical),
      write: (statement, parameters) => { recording?.push(statement); return physical.write(statement, parameters); },
      withConnection: work => physical.withConnection(connection => work(observe(connection))),
      transaction: work => physical.transaction(connection => work(observe(connection))) });
    const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (driver === "postgres" && (postgresUrl === null || provisioning === undefined)) throw new Error("Product replacement requires ordinary and provisioning PostgreSQL endpoints");
    const physical = driver === "postgres" && postgresUrl !== null && provisioning !== undefined
      ? await createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning, wrapRuntimeDriver })
      : await createCorePGliteFixture({ wrapRuntimeDriver });
    fixture = await createCoreProductFixture(driver, { physical });
    const metadata = fixture.runtime.metadata;
    /** The genuine variant replacement with every find and write it issues, in order. */
    const probe = (name: string, creation: boolean, announces: boolean) => defineCommerceCommand(name, "write", Effect.fn(function* (ctx, input) {
      const calls: string[] = [];
      let announcements = 0;
      const { announce, ...plain } = ctx;
      const observed = { ...plain,
        table: (id: string) => ctx.table(id).pipe(Effect.map(store => ({ ...store,
          find: (manager: typeof ctx.manager, query: unknown) => { calls.push(JSON.stringify(["find", id, query])); return store.find(manager, query); },
          write: (manager: typeof ctx.manager, mode: Parameters<typeof store.write>[1], rows: unknown) => {
            calls.push(JSON.stringify([mode, id, rows])); return store.write(manager, mode, rows);
          },
          delete: (manager: typeof ctx.manager, rows: unknown) => { calls.push(JSON.stringify(["delete", id, rows])); return store.delete(manager, rows); } }))),
        ...(announces && announce !== undefined ? { announce: (announcement: CommerceAnnouncement) => { announcements += 1; return announce(announcement); } } : {}) };
      const result = yield* replaceProductRows(observed, metadata, metadata.variant, input, { relations: ["options"] }, creation);
      // The actions are the rows the Product repository turns into its events.
      return { entities: [...result.entities], performedActions: JSON.stringify(result.performedActions), calls, announcements };
    }));
    probes = { create: { announced: probe("variantReplaceCreateAnnounced", true, true), plain: probe("variantReplaceCreatePlain", true, false) },
      relink: { announced: probe("variantReplaceRelinkAnnounced", false, true), plain: probe("variantReplaceRelinkPlain", false, false) } };
    host = await fixture.run(fixture.openHost({ commands: [...fixture.commands, ...Object.values(probes).flatMap(pair => Object.values(pair))] }));
    for (const id of products) {
      const created = await run(host.run(host.newRequestKey(), fixture.runtime.commands.create, [{ id, title: id, options: [{ title: "Size", values: ["S", "L"] }] }]));
      const rows = isJsonObject(created) && Array.isArray(created.payload) ? created.payload : created;
      const product = Array.isArray(rows) ? rows[0] : undefined, option = isJsonObject(product) && Array.isArray(product.options) ? product.options[0] : undefined;
      const members = isJsonObject(option) && Array.isArray(option.values) ? option.values : [];
      const ids = ["S", "L"].map(value => members.flatMap(member => isJsonObject(member) && member.value === value && typeof member.id === "string" ? [member.id] : [])[0]);
      const [small, large] = ids;
      if (small === undefined || large === undefined) throw new Error("Missing created option values");
      values.set(id, [small, large]);
    }
  }, 180_000);
  afterAll(async () => {
    await fixture.run(Effect.all([host.close], { mode: "result" }));
    await fixture.close();
  }, 180_000);

  it.each([["create", [0, 1]], ["relink", [1, 0]]] as const)("sends the %s shape's measured statements and issues the same calls and result with and without announcements", async (shape, order) => {
    const [warm, hintedProduct, controlProduct] = products;
    await run(host.run(host.newRequestKey(), probes[shape].announced, variants(warm, order)));
    const announced = await recorded(() => run(host.run(host.newRequestKey(), probes[shape].announced, variants(hintedProduct, order))));
    const plain = await recorded(() => run(host.run(host.newRequestKey(), probes[shape].plain, variants(controlProduct, order))));
    const hinted = outcome(announced.value), control = outcome(plain.value);
    expect(neutral(hinted.entities, hintedProduct)).toEqual(neutral(control.entities, controlProduct));
    expect(neutral(hinted.performedActions, hintedProduct)).toEqual(neutral(control.performedActions, controlProduct));
    expect(neutral(hinted.calls, hintedProduct)).toEqual(neutral(control.calls, controlProduct));
    expect(control.calls.length).toBeGreaterThan(0);
    expect(control.announcements).toBe(0);
    expect(hinted.announcements).toBeGreaterThan(0);
    expect({ announced: announced.statements.length, plain: plain.statements.length }).toEqual(REPLACE_STATEMENTS[shape]);
  });
});
