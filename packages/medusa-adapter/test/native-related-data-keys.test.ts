import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ProductSalesChannel } from "@medusajs/link-modules";
import { joinerConfig as productJoiner } from "@medusajs/product/joiner-config";
import { salesChannelStaticResources } from "@medusajs/sales-channel/static-manifest";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeNativeQueryBridge } from "../src/local-graph/native-bridge";
import { SalesChannelCreateInput } from "../src/modules/sales-channel/create-input";

function nativeConfiguration() {
  const salesChannel = salesChannelStaticResources.joinerConfig;
  const linkName = ProductSalesChannel.serviceName, channelName = salesChannel?.serviceName;
  if (salesChannel === undefined || linkName === undefined || channelName === undefined)
    throw new Error("Missing genuine Product/SalesChannel joiner configuration");
  return { servicesConfig: [productJoiner, ProductSalesChannel, salesChannel], linkName, channelName };
}
const configuration = nativeConfiguration();
const query = { entity: "product", fields: ["id", "sales_channels.id"], filters: { id: "product" } };

function nativeQuery(productId: string, channelIds: readonly string[]) {
  const rows = new Map<string, readonly JsonObject[]>([
    [productJoiner.serviceName, [{ id: productId }]],
    [configuration.linkName, channelIds.map(id => ({ product_id: productId, sales_channel_id: id }))],
    [configuration.channelName, channelIds.map(id => ({ id }))],
  ]);
  const calls: string[] = [];
  const bridge = makeNativeQueryBridge({ servicesConfig: configuration.servicesConfig,
    entitiesMap: new Map(), entityRelations: new Map(), read: request => Effect.gen(function* () {
      const data = rows.get(request.serviceName);
      if (data === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
      calls.push(request.serviceName);
      return { data: structuredClone([...data]) };
    }) });
  return { bridge, rows, calls };
}

describe("native related-data grouping keys", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "prototype", "ordinary"])(
    "joins the admitted SalesChannel ID %s without inherited rows", async id => {
      expect(Schema.decodeUnknownResult(SalesChannelCreateInput)({ id, name: "Native channel" })).toMatchObject({ _tag: "Success" });
      const tested = nativeQuery("product", [id]);
      expect(await Effect.runPromise(tested.bridge.graph(query)))
        .toEqual({ data: [{ id: "product", sales_channels: [{ id }] }], metadata: undefined });
      expect(tested.calls).toEqual([productJoiner.serviceName, configuration.linkName, configuration.channelName]);
      expect(tested.rows.get(configuration.channelName)).toEqual([{ id }]);
    },
  );

  it.each(["constructor", "toString", "__proto__"])("groups repeated native Link source keys for Product %s in Link order", async productId => {
    const tested = nativeQuery(productId, ["second", "first"]);
    expect(await Effect.runPromise(tested.bridge.graph({ ...query, filters: { id: productId } })))
      .toEqual({ data: [{ id: productId, sales_channels: [{ id: "second" }, { id: "first" }] }], metadata: undefined });
    expect(Result.isSuccess(Schema.decodeUnknownResult(SalesChannelCreateInput)({ id: productId, name: "Same valid ID grammar" }))).toBe(true);
  });
});
