import { promiseFailureObserver } from "./support/promise-failure-observer";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareVariantPricingLink } from "../src/links/variant-pricing-service";
import { prepareLocalGraph } from "../src/local-graph/query";
import type { GraphModuleDefinition } from "../src/local-graph/model";
import { graphNativeConfiguration } from "../src/local-graph/native-metadata";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { bindWorkflowQuery } from "../src/workflow/query";

const participant = defineAtomicCommerceParticipant("native-variant-price-set-query");
let link: Effect.Success<ReturnType<typeof prepareVariantPricingLink>>;
beforeAll(async () => { link = await Effect.runPromise(prepareVariantPricingLink()); });

type Call = { readonly participant: Parameters<AtomicCommerceContext["call"]>[0];
  readonly command: Parameters<AtomicCommerceContext["call"]>[1]; readonly input: Json };
function context(result: Json = [[], 0]) {
  const calls: Call[] = [], refusals: string[] = [];
  const scope: AtomicCommerceContext = { eventGroupId: "native-variant-price-set-query", checkpoint: Effect.void, recordFailure: promiseFailureObserver(),
    refuse: error => { refusals.push(error.reason); return Effect.fail(error); },
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    call: (selected, command, input) => { calls.push({ participant: selected, command, input }); return Effect.succeed(result); },
  };
  return { scope, calls, refusals };
}
const input = (ids: readonly string[]) => ({ entryPoint: "product_variant_price_set",
  fields: ["variant_id", "price_set_id"], variables: { variant_id: ids } });
async function bind(result: Json = [[], 0], module: GraphModuleDefinition = link.graph) {
  const recorded = context(result), owner = await Effect.runPromise(makeCommercePromiseOwner());
  const graph = Result.getOrThrow(prepareLocalGraph([{ participant, module }]));
  return { ...recorded, owner, query: bindWorkflowQuery(graph, recorded.scope, owner) };
}

describe("native Variant–Price Set workflow Query ABI", () => {
  it("uses the authenticated stored Link command and first-occurrence IDs without endpoint hydration", async () => {
    const connected = await bind([[{ variant_id: "second", price_set_id: "historical-price-set" },
      { variant_id: "first", price_set_id: "active-price-set" }], 2]);
    const raw = input(["second", "first", "second"]), before = structuredClone(raw);
    try {
      expect(await connected.query(raw)).toEqual([{ variant_id: "second", price_set_id: "historical-price-set" },
        { variant_id: "first", price_set_id: "active-price-set" }]);
      expect(connected.calls).toEqual([{ participant, command: link.count,
        input: { filters: { variant_id: ["second", "first"] }, config: { select: ["variant_id", "price_set_id"],
          relations: [], skip: 0, take: commerceLimits.catalogRows } } }]);
      expect(raw).toEqual(before);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("delegates the native empty-selector short circuit without a stored read", async () => {
    const connected = await bind();
    try {
      expect(await connected.query(input([]))).toEqual([]);
      expect(connected.calls).toEqual([]);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("admits eight raw entries over four endpoints and preserves the empty-string selector", async () => {
    const connected = await bind();
    try {
      expect(await connected.query(input(["", "b", "a", "c", "b", "", "c", "a"]))).toEqual([]);
      expect(connected.calls[0]?.input).toMatchObject({ filters: { variant_id: ["", "b", "a", "c"] } });
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("refuses other variable bags, projections and bounds before dispatch", async () => {
    const connected = await bind();
    try {
      for (const value of [
        { ...input(["v"]), entryPoint: "product_variant_inventory_items" },
        { ...input(["v"]), fields: ["price_set_id", "variant_id"] },
        { ...input(["v"]), fields: ["variant_id"] },
        { ...input(["v"]), fields: ["variant_id", "price_set_id", "price_set.id"] },
        { ...input(["v"]), variables: { variant_id: ["v"], id: [] } },
        { ...input(["v"]), variables: { variant_id: "v" } },
        { ...input(["v"]), variables: { variant_id: [null] } },
        { ...input(["v"]), variables: { variant_id: [undefined] } },
        input(Array.from({ length: 9 }, () => "v")), input(["a", "b", "c", "d", "e"]), input(["x".repeat(257)]),
      ]) await expect(connected.query(value)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(connected.calls).toEqual([]);
      expect(connected.refusals).toHaveLength(11);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("rejects accessor input without invoking its getter or the stored read", async () => {
    const connected = await bind();
    let reads = 0;
    const value = { ...input([]), variables: { get variant_id() { reads++; return ["v"]; } } };
    try {
      await expect(connected.query(value)).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(reads).toBe(0); expect(connected.calls).toEqual([]); expect(connected.refusals).toHaveLength(1);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("rejects unavailable aliases and malformed complete native results", async () => {
    const read = link.graph.reads[0];
    if (read === undefined) throw new Error("Missing authentic native Link read");
    const absent = await bind([[], 0], { ...link.graph, aliases: [{ name: "other_link", model: read.model }] });
    try {
      await expect(absent.query(input(["v"]))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(absent.calls).toEqual([]);
    } finally { await Effect.runPromise(absent.owner.close); }
    const corrupt = await bind([[{ variant_id: "v" }], 2]);
    try {
      await expect(corrupt.query(input(["v"]))).rejects.toMatchObject({ reason: "storedCorruption" });
      expect(corrupt.calls).toHaveLength(1);
    } finally { await Effect.runPromise(corrupt.owner.close); }
  });

  it("retains genuine endpoint declarations without granting endpoint reads", async () => {
    if (link.graph.native === undefined) throw new Error("Missing actual native Link metadata");
    const declared = Result.getOrThrow(graphNativeConfiguration(link.graph.native));
    expect(declared.servicesConfig.map(config => config.serviceName)).toEqual(expect.arrayContaining(["product", "pricing"]));
    const connected = await bind();
    try {
      for (const entryPoint of ["product_variant", "price_set"])
        await expect(connected.query({ entryPoint, fields: ["id"], variables: { id: ["v"] } })).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(connected.calls).toEqual([]);
    } finally { await Effect.runPromise(connected.owner.close); }
  });

  it("leaves absent selected properties to the native response owner", async () => {
    const connected = await bind([[{ variant_id: "v" }], 1]);
    try { expect(await connected.query(input(["v"]))).toEqual([{ variant_id: "v" }]); }
    finally { await Effect.runPromise(connected.owner.close); }
  });

  it("revokes escaped native Query calls with the existing Promise owner", async () => {
    const connected = await bind();
    await Effect.runPromise(connected.owner.close);
    await expect(connected.query(input(["v"]))).rejects.toMatchObject({ reason: "closed" });
    expect(connected.calls).toEqual([]);
  });
});
