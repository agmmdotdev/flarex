import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { CartPaymentCollection, OrderPaymentCollection, ShippingOptionPriceSet } from "@medusajs/link-modules";
import { cartStaticResources } from "@medusajs/cart/static-manifest";
import { orderStaticResources } from "@medusajs/order/static-manifest";
import { paymentStaticResources } from "@medusajs/payment/static-manifest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { nativeLinkGraphPaths } from "../src/local-graph/links";
import type { GraphParticipant, GraphReadContext } from "../src/local-graph/model";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import { declaredNativeGraph, nativeGraphFixture } from "./support/declared-native-graph";
import { promiseFailureObserver } from "./support/promise-failure-observer";

const bounds = { maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 4 };
const sourceParticipant = defineAtomicCommerceParticipant("alias-cardinality-source");
const targetParticipant = defineAtomicCommerceParticipant("alias-cardinality-target");
const linkParticipant = defineAtomicCommerceParticipant("alias-cardinality-link");
const sourceRead = defineGraphReadCommand("aliasCardinalitySources", () => Effect.succeed([[], 0]));
const targetRead = defineGraphReadCommand("aliasCardinalityTargets", () => Effect.succeed([[], 0]));
const linkRead = defineGraphReadCommand("aliasCardinalityLinks", () => Effect.succeed([[], 0]));

function context(responses: readonly Json[]): GraphReadContext {
  let index = 0;
  return { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: () => {
    const value = responses[index++];
    return value === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(value);
  } };
}

function fixture(joiner: ModuleJoinerConfig, root: string, field: string, sourceAlias: string,
  sourceConfig: ModuleJoinerConfig | undefined, targetConfig: ModuleJoinerConfig | undefined) {
  if (sourceConfig === undefined || targetConfig === undefined) throw new Error("Missing actual endpoint metadata");
  const paths = Result.getOrThrow(nativeLinkGraphPaths(joiner, [{ root, path: field, ...bounds }]));
  const path = paths[0];
  if (path === undefined) throw new Error("Missing actual native Link path");
  const read = (model: string, command: typeof sourceRead, columns = ["id"], keys = ["id"]) => ({ model, command,
    table: { name: model.toLowerCase(), columns, primaryKeys: keys, foreignKeys: [], companions: {} },
    paths: [], orderable: keys, uniqueOrder: keys, multipleOrder: false, decode: decodeGraphCount });
  const participants: GraphParticipant[] = [
    { participant: sourceParticipant, module: declaredNativeGraph({ aliases: [{ name: sourceAlias, model: path.sourceModel }],
      reads: [read(path.sourceModel, sourceRead)] }, [sourceConfig], []) },
    { participant: targetParticipant, module: declaredNativeGraph({ aliases: [{ name: "target", model: path.targetModel }],
      reads: [read(path.targetModel, targetRead)] }, [targetConfig], []) },
    { participant: linkParticipant, module: declaredNativeGraph({ aliases: [{ name: "native_cardinality_links", model: path.linkModel }],
      remotePaths: paths, reads: [read(path.linkModel, linkRead, [path.sourceColumn, path.targetColumn], [path.sourceColumn, path.targetColumn])] }, [joiner], []) },
  ];
  const graph = nativeGraphFixture(Result.getOrThrow(prepareLocalGraph(participants)));
  const query = { entity: sourceAlias, fields: ["id", field + ".id"], pagination: { take: 4, skip: 0 } };
  const responses = (ids: readonly string[]): Json[] => [[[{ id: "source" }], 1],
    [ids.map(id => ({ [path.sourceColumn]: "source", [path.targetColumn]: id })), ids.length],
    [ids.map(id => ({ id })), ids.length]];
  return { read: (ids: readonly string[]) => graph.bind(context(responses(ids))).nativeGraph(query) };
}

describe("native Link field alias cardinality", () => {
  it("distinguishes endpoint list aliases, genuine singletons and list suffixes", () => {
    const select = (joiner: ModuleJoinerConfig, root: string, path: string) =>
      Result.getOrThrow(nativeLinkGraphPaths(joiner, [{ root, path, ...bounds }]))[0];
    const list = select(OrderPaymentCollection, "Order", "payment_collections");
    expect(list).not.toHaveProperty("many");
    expect(list).toMatchObject(bounds);
    expect(select(OrderPaymentCollection, "PaymentCollection", "order")).toHaveProperty("many", false);
    expect(select(CartPaymentCollection, "Cart", "payment_collection")).toHaveProperty("many", false);
    expect(select(ShippingOptionPriceSet, "ShippingOption", "prices")).toMatchObject({ many: false, outputMany: true, targetSuffix: "prices" });
  });

  it("lets the genuine native Order alias attach two payment collections while preserving its four-per-source bound", async () => {
    const native = fixture(OrderPaymentCollection, "Order", "payment_collections", "order",
      orderStaticResources.joinerConfig, paymentStaticResources.joinerConfig);
    expect((await Effect.runPromise(native.read(["first", "second"]))).data)
      .toEqual([{ id: "source", payment_collections: [{ id: "first" }, { id: "second" }] }]);
    expect(await Effect.runPromise(Effect.result(native.read(["one", "two", "three", "four", "five"]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it.each(["inverse-order", "cart"])("retains genuine %s singleton output and refuses two forged targets", async kind => {
    const native = kind === "cart"
      ? fixture(CartPaymentCollection, "Cart", "payment_collection", "cart", cartStaticResources.joinerConfig, paymentStaticResources.joinerConfig)
      : fixture(OrderPaymentCollection, "PaymentCollection", "order", "payment_collection", paymentStaticResources.joinerConfig, orderStaticResources.joinerConfig);
    expect((await Effect.runPromise(native.read(["first"]))).data)
      .toEqual([{ id: "source", [kind === "cart" ? "payment_collection" : "order"]: { id: "first" } }]);
    expect(await Effect.runPromise(Effect.result(native.read(["first", "second"]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});
