import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import { prepareProductCreationWorkflow } from "../src/workflows/product/creation";
import { productCreationOptions } from "./support/core-product-creation-fixture";
import { prepareCoreProductUpdate } from "./support/core-product-update-fixture";
import { productCreateInput } from "../benchmarks/core-performance/product-workflows/shared";

const pages = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../persistence-postgres/src/core/nativeRelationalQuery", async original => {
  const module = await original<typeof import("../../persistence-postgres/src/core/nativeRelationalQuery")>();
  return { ...module, executeCoreNativeRelationalPage: (...args: Parameters<typeof module.executeCoreNativeRelationalPage>) => {
    pages.calls += 1; return module.executeCoreNativeRelationalPage(...args);
  } };
});

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const Rows = Schema.Array(Schema.Struct({ id: Schema.String, created_at: Schema.optionalKey(Schema.Unknown),
  tags: Schema.optionalKey(Schema.Array(Schema.Unknown)), variants: Schema.optionalKey(Schema.Array(Schema.Unknown)) }));
const decodeRows = Schema.decodeUnknownSync(Rows);
const decodeCounted = Schema.decodeUnknownSync(Schema.Tuple([Rows, Schema.Number]));
const total = 12, ids = Array.from({ length: total }, (_, index) => `list-${index}-product`);
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreProductUpdate>>;
let creation: Effect.Success<ReturnType<typeof prepareProductCreationWorkflow>>;
const list = async (filters: JsonObject, config: JsonObject) => {
  const { reads, runtime } = connected.creation.product;
  return decodeRows(await Effect.runPromise(reads.read(runtime.commands.list, { filters, config })));
};

describe(`native Product list reads on ${driver}`, () => {
  beforeAll(async () => {
    connected = await prepareCoreProductUpdate(driver, close => cleanup.push(close));
    creation = await Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(connected.creation), hooks: {} }));
    cleanup.push(() => Effect.runPromise(creation.close));
    for (let index = 0; index < total; index += 1)
      await Effect.runPromise(creation.run(creation.newRequestKey(), productCreateInput(`list-${index}`)));
  }, 600_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });
  beforeEach(() => { pages.calls = 0; });

  it("pages newest first by created_at, in both directions and across skip", async () => {
    const recent = await list({}, { take: 5, order: { created_at: "DESC" } });
    expect(recent.map(row => row.id)).toEqual(ids.toReversed().slice(0, 5));
    const next = await list({}, { take: 5, skip: 5, order: { created_at: "DESC" } });
    expect(next.map(row => row.id)).toEqual(ids.toReversed().slice(5, 10));
    const ascending = (await list({}, { take: 256, order: { created_at: "ASC" } })).map(row => row.id);
    expect(ascending.filter(id => ids.includes(id))).toEqual(ids);
  }, 120_000);

  it("pages by id in both directions", async () => {
    const sorted = (await list({}, { take: 256, order: { id: "ASC" } })).map(row => row.id);
    expect(sorted).toEqual(sorted.toSorted());
    const page = await list({}, { take: 4, skip: 2, order: { id: "ASC" } });
    expect(page.map(row => row.id)).toEqual(sorted.slice(2, 6));
    const descending = await list({}, { take: 2, order: { id: "DESC" } });
    expect(descending.map(row => row.id)).toEqual(sorted.toReversed().slice(0, 2));
  }, 120_000);

  it("lists more related rows than the write working set admits", async () => {
    const selected = ids.slice(0, 10);
    const rows = await list({ id: selected }, { take: 10, relations: ["variants", "options", "images", "tags", "categories"] });
    expect(rows.map(row => row.id).toSorted()).toEqual(selected.toSorted());
    for (const row of rows) { expect(row.variants).toHaveLength(1); expect(row.tags).toHaveLength(4); }
  }, 120_000);

  it("keeps listAndCount exact while returning only the page", async () => {
    const { reads, runtime } = connected.creation.product;
    const [rows, count] = decodeCounted(await Effect.runPromise(reads.read(runtime.commands.count, { filters: {}, config: { take: 1, order: { created_at: "DESC" } } })));
    expect(rows.map(row => row.id)).toEqual([ids.at(-1)]);
    expect(count).toBe((await list({}, { take: 256 })).length);
  }, 120_000);

  it("reads a page only for a plain list without a total", async () => {
    await list({}, { take: 2, order: { id: "ASC" } });
    expect(pages.calls).toBe(1);
    pages.calls = 0;
    await list({ id: ids.slice(0, 2) }, { take: 2 });
    await list({}, { take: 2, order: { handle: "ASC" } });
    const { reads, runtime } = connected.creation.product;
    await Effect.runPromise(reads.read(runtime.commands.count, { filters: {}, config: { take: 1 } }));
    expect(pages.calls).toBe(0);
  }, 120_000);

  it("orders rows created in one transaction identically on the page and complete paths", async () => {
    const [first, second, third] = ["tie-a", "tie-b", "tie-c"].map(prefix => productCreateInput(prefix).products[0]);
    if (first === undefined || second === undefined || third === undefined) throw new Error("Missing tied Product input");
    await Effect.runPromise(creation.run(creation.newRequestKey(), { products: [
      { ...first, sales_channels: [] }, { ...second, sales_channels: [] }, { ...third, sales_channels: [] }] }));
    const { reads, runtime } = connected.creation.product;
    for (const direction of ["DESC", "ASC"] as const) {
      const config = { take: 256, order: { created_at: direction } };
      const rows = await list({}, config), page = rows.map(row => row.id);
      expect(new Set(rows.filter(row => row.id.startsWith("tie-")).map(row => String(row.created_at))).size).toBe(1);
      const [complete] = decodeCounted(await Effect.runPromise(reads.read(runtime.commands.count, { filters: {}, config })));
      expect(complete.map(row => row.id)).toEqual(page);
    }
  }, 120_000);

  it("admits an offset beyond the old query limit", async () => {
    await expect(list({}, { take: 5, skip: 300, order: { id: "ASC" } })).resolves.toEqual([]);
  }, 120_000);

  it("refuses an order the Product profile has not admitted", async () => {
    await expect(list({}, { take: 1, order: { title: "ASC" } })).rejects.toMatchObject({ reason: "unsupportedProfile" });
  }, 120_000);
});
