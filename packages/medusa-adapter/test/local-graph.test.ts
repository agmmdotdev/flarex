import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineAtomicCommerceParticipant, defineCommerceCommand, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalProductCommands } from "../src/product-service";
import { currencyGraph } from "../src/currency-service";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { prepareLocalGraph, decodeGraphCount } from "../src/local-graph/query";
import type { GraphModuleDefinition, PreparedLocalGraph } from "../src/local-graph/model";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";

const participant = defineAtomicCommerceParticipant("graph-unit");
const query = (entity: string, fields: string[] = ["id"]) => ({ entity, fields, pagination: { take: 2 } });
const context = (result: Json = [[], 0], calls: Json[] = []): AtomicCommerceContext => ({
  eventGroupId: "unit-graph",
  checkpoint: Effect.void,
  capture: () => Effect.fail(commerceError("unsupportedProfile")),
  emit: () => Effect.fail(commerceError("unadmittedEvent")),
  call: (_participant, _command, args) => { calls.push(args); return Effect.succeed(result); },
  refuse: Effect.fail,
});
let prepared: PreparedLocalGraph;
let product: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
beforeAll(async () => {
  product = await runEffect(makeLocalProductCommands());
  prepared = await runEffect(Effect.fromResult(currencyGraph).pipe(Effect.flatMap(currency => Effect.fromResult(prepareLocalGraph([
    { participant, module: product.graph }, { participant, module: currency },
  ])))));
});

describe("native local Graph Query contract", () => {
  it("derives admitted root aliases, including the pinned variant aliases", () => {
    expect(prepared.entities).toEqual(expect.arrayContaining([
      "product", "products", "product_category", "product_categories", "product_collection", "product_type", "product_tag",
      "product_option", "product_variant", "variant", "variants", "product_variants", "currency", "currencies",
    ]));
    expect(prepared.entities).toContain("product_image");
    expect(prepared.entities).not.toContain("product_option_value");
  });

  it.each(["product", "product_category", "product_collection", "product_type", "product_tag", "product_option", "product_variant", "product_image", "currency"])("dispatches %s to its registered count read", async entity => {
    const calls: Json[] = [];
    // Category's actual command transport is distinct from an ordinary tuple.
    const value: Json = entity === "product_category" ? [{ payload: [], omitted: [] }, 0] : [[], 0];
    const field = entity === "currency" ? "code" : "id";
    expect(await runEffect(prepared.bind(context(value, calls)).graph(query(entity, [field]))))
      .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 2 } });
    expect(calls).toEqual([{ filters: {}, config: { select: [field], relations: [], order: { [field]: "ASC" }, skip: 0, take: 2 } }]);
  });

  it("plans complete nested prefixes and masks hydration fields using pinned population semantics", async () => {
    const calls: Json[] = [];
    const value: Json = [[{ id: "p", title: "shirt", handle: "hidden", options: [{ id: "o", title: "size", values: [{ id: "v", value: "S", option_id: "o" }] }] }], 1];
    const result = await runEffect(prepared.bind(context(value, calls)).graph(query("product", ["title", "options.title", "options.values.value"])));
    expect(result.data).toEqual([{ title: "shirt", options: [{ title: "size", values: [{ value: "S" }] }] }]);
    expect(calls[0]).toMatchObject({ config: { relations: ["options", "options.values"], select: expect.arrayContaining(["id", "title"]) } });
    expect(value).toMatchObject([[{ handle: "hidden", options: [{ id: "o" }] }], 1]);
  });

  it("preserves numeric companions and Category's native JSON absence", async () => {
    const currency = await runEffect(prepared.bind(context([[{ code: "usd", rounding: 0.05, raw_rounding: { value: "0.05", precision: 20 } }], 1]))
      .graph(query("currency", ["rounding"])));
    expect(currency.data).toEqual([{ rounding: 0.05, raw_rounding: { value: "0.05", precision: 20 } }]);
    const category = await runEffect(prepared.bind(context([{ payload: [{ id: "c", name: "root", category_children: [] }], omitted: [["0", "parent_category"]] }, 1]))
      .graph(query("product_category", ["name", "parent_category.id", "category_children.id"])));
    expect(category.data).toStrictEqual([{ name: "root", category_children: [] }]);
  });

  it("uses admitted stable ordering and bounded zero-sized pages", async () => {
    const calls: Json[] = [];
    const graph = prepared.bind(context([{ payload: [], omitted: [] }, 3], calls));
    expect(await runEffect(graph.graph({ ...query("product_category"), pagination: { take: 0, skip: 1, order: { rank: "DESC" } } })))
      .toEqual({ data: [], metadata: { count: 3, skip: 1, take: 0 } });
    expect(calls[0]).toMatchObject({ config: { order: { rank: "DESC", id: "ASC" } } });
    const productCalls: Json[] = [];
    await runEffect(prepared.bind(context([[], 0], productCalls)).graph({ ...query("product"), pagination: { take: 2, order: { handle: "DESC" } } }));
    expect(productCalls[0]).toMatchObject({ config: { order: { handle: "DESC" } } });
  });

  it("rejects unsupported syntax before dispatch rather than ignoring it", async () => {
    const calls: Json[] = [];
    const graph = prepared.bind(context([[], 0], calls));
    for (const input of [
      { entity: "product", fields: ["id"] }, { ...query("product"), fields: [] }, query("unknown"), query("product", ["missing"]),
      query("product", ["options.*.value"]), query("product", ["options.values.variants.id"]), query("currency", ["id"]),
      { ...query("product"), options: { throwIfKeyNotFound: true } }, { ...query("product"), locale: "en" },
      { ...query("product"), filters: [] }, { ...query("product"), filters: { id: { $in: ["p"] } } },
      { ...query("product"), pagination: { take: -1 } }, { ...query("product"), pagination: { take: 257 } },
      { ...query("product"), pagination: { take: 1.2 } }, { ...query("product"), pagination: { take: Infinity } },
      { ...query("product"), pagination: { take: 1, skip: 256 } }, { ...query("product"), pagination: { take: 1, order: { title: "ASC" } } },
      { ...query("product"), pagination: { take: 1, cursor: "x" } },
    ]) expect(await runEffectFailure(graph.graph(input))).toHaveProperty("reason");
    expect(calls).toEqual([]);
  });

  it("captures caller fields and filters before entering the service", async () => {
    const input = { ...query("product", ["title"]), filters: { id: ["p"] } };
    const calls: Json[] = [];
    const ctx: AtomicCommerceContext = { ...context(), call: (_participant, _command, args) => {
      input.fields[0] = "handle"; input.filters.id[0] = "other"; calls.push(args);
      return Effect.succeed([[{ title: "shirt" }], 1]);
    } };
    expect((await runEffect(prepared.bind(ctx).graph(input))).data).toEqual([{ title: "shirt" }]);
    expect(calls[0]).toMatchObject({ filters: { id: ["p"] }, config: { select: ["title"] } });
    let getterCalls = 0;
    const accessor = { get entity() { getterCalls++; return "product"; }, fields: ["id"], pagination: { take: 1 } };
    await runEffectFailure(prepared.bind(ctx).graph(accessor));
    expect(getterCalls).toBe(0);
  });

  it("preserves an already-refused participant failure without entering refusal again", async () => {
    let refusals = 0;
    const participantFailure = commerceError("invalidAuthority");
    const graph = prepared.bind({ ...context(), call: () => Effect.fail(participantFailure),
      refuse: issue => { refusals++; return Effect.fail(issue); } });
    expect(await runEffectFailure(graph.graph(query("currency", ["code"])))).toBe(participantFailure);
    expect(refusals).toBe(0);
  });

  it("refuses malformed results and missing required fields or relationships", async () => {
    for (const result of [null, [[], -1], [[], 257], [[], 1], [[{ id: "p" }], 0], [[{}], 1], [[{ id: "p", options: null }], 1]]) {
      const fields = result === null || !Array.isArray(result) ? ["id"] : ["id", "options.id"];
      expect(await runEffectFailure(prepared.bind(context(result)).graph(query("product", fields))))
        .toMatchObject({ reason: "storedCorruption" });
    }
  });
});

describe("graph registration and metadata ownership", () => {
  const command = defineGraphReadCommand("graphUnitRead", () => Effect.succeed([[], 0]));
  const definition = (): GraphModuleDefinition => ({ aliases: [{ name: "item", model: "Item", methodSuffix: "Items" }], reads: [{
    model: "Item", methodSuffix: "Items", command,
    table: { name: "item", columns: ["key", "name"], primaryKeys: ["key"], foreignKeys: [], companions: {} },
    paths: [], orderable: ["key"], uniqueOrder: ["key"], multipleOrder: false, decode: decodeGraphCount,
  }] });

  it("expands scalar wildcards against detached metadata", async () => {
    const columns = ["key", "name"];
    const source = definition();
    const first = source.reads[0];
    if (first === undefined) throw new Error("Missing fixture read");
    const module = { ...source, reads: [{ ...first, table: { ...first.table, columns } }] };
    const graph = await runEffect(Effect.fromResult(prepareLocalGraph([{ participant, module }])));
    columns.push("secret"); module.aliases = [{ name: "renamed", model: "Item", methodSuffix: "Items" }];
    expect(graph.entities).toEqual(["item"]);
    expect((await runEffect(graph.bind(context([[{ key: "i", name: "item", secret: "hidden" }], 1])).graph(query("item", ["*"])))).data)
      .toEqual([{ key: "i", name: "item" }]);
  });

  it("rejects alias collisions, missing methods, unknown read tokens and incomplete paths", () => {
    const source = definition();
    const first = source.reads[0];
    if (first === undefined) throw new Error("Missing fixture read");
    // @ts-expect-error A core write command is not a graph read definition.
    const write: typeof command = defineCommerceCommand("write", "write", () => Effect.succeed(null));
    for (const module of [
      { ...source, aliases: [...source.aliases, ...source.aliases] }, { ...source, aliases: [] },
      { ...source, aliases: [{ name: "item", model: "Item", methodSuffix: "Wrong" }] },
      { ...source, reads: [{ ...first, command: write }] },
      { ...source, reads: [{ ...first, paths: [{ path: "child.nested", table: first.table, many: true }] }] },
    ]) expect(prepareLocalGraph([{ participant, module }])).toMatchObject({ _tag: "Failure" });
    expect(prepareLocalGraph([{ participant, module: source }, { participant, module: source }])).toMatchObject({ _tag: "Failure" });
    expect(Result.isFailure(prepareLocalGraph([]))).toBe(true);
  });
});
