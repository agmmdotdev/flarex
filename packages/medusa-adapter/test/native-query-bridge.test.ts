import { Cause, Deferred, Effect, Exit, Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ModuleJoinerConfig } from "@medusajs/types";
import { Query, type RemoteQueryFetchRequest } from "@medusajs/modules-sdk/remote-query";
import { apiKeyStaticResources } from "@medusajs/api-key/static-manifest";
import { salesChannelStaticResources } from "@medusajs/sales-channel/static-manifest";
import { PublishableApiKeySalesChannel } from "@medusajs/link-modules";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeNativeQueryGraphResult, makeNativeQueryBridge } from "../src/local-graph/native-bridge";

const servicesConfig: ModuleJoinerConfig[] = [{ serviceName: "bridge_item", primaryKeys: ["id"],
  alias: [{ name: "bridge_item", entity: "BridgeItem", args: { methodSuffix: "BridgeItems" } }] }];
const metadata = { servicesConfig, entitiesMap: new Map<string, unknown>(), entityRelations: new Map<string, ReadonlyMap<string, string>>() };
const selection = { entity: "bridge_item", fields: ["id"], filters: { id: "one" } };

describe("Effect native Query bridge", () => {
  it("uses native selection, field presentation and graph envelopes without changing the input", async () => {
    const calls: RemoteQueryFetchRequest[] = [];
    const bridge = makeNativeQueryBridge({ ...metadata, read: request => Effect.sync(() => {
      calls.push(request);
      return { data: [{ id: "one", private: "not selected" }] };
    }) });
    const input = structuredClone(selection);
    expect(await Effect.runPromise(bridge.graph(input))).toEqual({ data: [{ id: "one" }], metadata: undefined });
    expect(input).toEqual(selection);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ serviceName: "bridge_item", keyField: "id", ids: ["one"],
      methodSuffix: "BridgeItems", options: { select: ["id"], relations: [], args: {} } });
    expect(await Effect.runPromise(bridge.query({ __value: { bridge_item: {
      fields: ["id"], isServiceAccess: false, __args: { filters: { id: "one" } },
    } } }))).toEqual([{ id: "one" }]);
  });

  it("retains the complete protected callback Cause through native Promise rejection and cleanup", async () => {
    const expected = commerceError("invalidAuthority"), defect = new Error("native callback defect");
    const failure = Cause.combine(Cause.fail(expected), Cause.die(defect));
    const observed: Cause.Cause<CommerceTransactionError>[] = [];
    const bridge = makeNativeQueryBridge({ ...metadata, read: () => Effect.failCause(failure),
      recordFailure: cause => { observed.push(cause); return Result.succeed(cause); } });
    const result = await Effect.runPromiseExit(bridge.graph(selection));
    if (Exit.isSuccess(result)) throw new Error("Expected the protected callback failure");
    expect(result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toContain(expected);
    expect(result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toContain(defect);
    expect(observed.some(cause => cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect))).toBe(true);
  });

  it("records bounded input refusal before any native fetch", async () => {
    let calls = 0;
    const observed: Cause.Cause<CommerceTransactionError>[] = [];
    const bridge = makeNativeQueryBridge({ ...metadata, read: () => Effect.sync(() => { calls++; return { data: [] }; }),
      recordFailure: cause => { observed.push(cause); return Result.succeed(cause); } });
    const input = Object.defineProperty({}, "entity", { enumerable: true, get: () => { throw new Error("untrusted getter"); } });
    const result = await Effect.runPromiseExit(bridge.graph(input));
    expect(Exit.isFailure(result)).toBe(true);
    expect(calls).toBe(0);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toEqual(["invalidInput"]);
  });

  it("interrupts and joins the protected read before completing a cancelled native call", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    let finalized = false;
    const bridge = makeNativeQueryBridge({ ...metadata, read: () => Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { finalized = true; })),
    ) });
    const controller = new AbortController();
    const pending = Effect.runPromiseExit(bridge.graph(selection), { signal: controller.signal });
    await Effect.runPromise(Deferred.await(entered));
    controller.abort();
    const result = await pending;
    if (Exit.isSuccess(result)) throw new Error("Expected native read cancellation");
    expect(result.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(finalized).toBe(true);
  });

  it.each(["__proto__", "constructor", "prototype"])("refuses the raw %s segment before native plain-object normalization", async segment => {
    let calls = 0;
    const bridge = makeNativeQueryBridge({ ...metadata, read: () => Effect.sync(() => { calls++; return { data: [] }; }) });
    for (const input of [
      { ...selection, fields: [`owner.${segment}.id`] },
      { ...selection, context: { [segment]: { currency_code: "usd" } } },
      { __value: { bridge_item: { fields: ["id"], isServiceAccess: false, [segment]: { fields: ["id"] } } } },
    ]) {
      const result = await Effect.runPromiseExit(bridge.graph(input));
      if (Exit.isSuccess(result)) throw new Error("Expected raw native path refusal");
      expect(result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toEqual(["unsupportedProfile"]);
    }
    expect(calls).toBe(0);
    expect({}).not.toHaveProperty("polluted");
  });

  it("lets native normalization consume positional undefined IDs", async () => {
    const calls: RemoteQueryFetchRequest[] = [];
    const bridge = makeNativeQueryBridge({ ...metadata, read: request => Effect.sync(() => { calls.push(request); return { data: [] }; }) });
    const input = { entryPoint: "bridge_item", fields: ["id"], variables: { id: [undefined] } };
    const native = vi.spyOn(Query.prototype, "query");
    try {
      expect(await Effect.runPromise(bridge.query(input))).toEqual([]);
      expect(native.mock.calls[0]?.[0]).toEqual(input);
      expect(calls).toHaveLength(1);
      // Native RemoteJoiner removes nullish IDs and extracts the primary-key
      // argument before its fetch callback. The bridge does neither operation.
      expect(calls[0]).toMatchObject({ ids: [], filters: {} });
    } finally { native.mockRestore(); }
  });

  it("preserves native empty nested selections as undefined intermediate array members", async () => {
    const bridge = makeNativeQueryBridge({
      servicesConfig: [{ serviceName: "bridge_item", primaryKeys: ["id"], alias: [
        { name: "bridge_item", entity: "BridgeItem", args: { methodSuffix: "BridgeItems" } },
        { name: "bridge_child", entity: "BridgeChild", args: { methodSuffix: "BridgeChildren" } },
      ] }], entitiesMap: new Map(), entityRelations: new Map([["BridgeItem", new Map([["children", "BridgeChild"]])]]),
      read: () => Effect.succeed({ data: [{ id: "one", children: [{ id: "child" }] }] }),
    });
    const result = await Effect.runPromise(bridge.graph({ entity: "bridge_item", fields: ["id", "children.name"] }));
    expect(result).toEqual({ data: [{ id: "one", children: [undefined] }], metadata: undefined });
    expect(Result.getOrThrow(decodeNativeQueryGraphResult(result))).toEqual(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual({ data: [{ id: "one", children: [null] }] });
  });

  it("detaches the actual APIKey alias output without retaining native hidden join properties", async () => {
    const apiKey = apiKeyStaticResources.joinerConfig, salesChannel = salesChannelStaticResources.joinerConfig;
    if (apiKey === undefined || salesChannel === undefined) throw new Error("Missing genuine APIKey native metadata");
    const bridge = makeNativeQueryBridge({ servicesConfig: [apiKey, PublishableApiKeySalesChannel, salesChannel],
      entitiesMap: new Map(), entityRelations: new Map(), read: request => {
        if (request.serviceName === apiKey.serviceName) return Effect.succeed({ data: [{ id: "apk_active" }] });
        if (request.serviceName === PublishableApiKeySalesChannel.serviceName)
          return Effect.succeed({ data: [{ publishable_key_id: "apk_active", sales_channel_id: "sc_active" }] });
        if (request.serviceName === salesChannel.serviceName) return Effect.succeed({ data: [{ id: "sc_active" }] });
        return Effect.fail(commerceError("invalidAuthority"));
      } });
    const result = await Effect.runPromise(bridge.query({ __value: { api_key: { fields: [], isServiceAccess: false,
      __args: { filters: { token: "pk_active" } }, sales_channels: { fields: ["id"] } } } }));
    expect(result).toEqual([{ id: "apk_active", sales_channels: [{ id: "sc_active" }] }]);
    if (!Schema.is(Schema.Array(Schema.JsonObject))(result)) throw new Error("Expected genuine APIKey JSON rows");
    const row = result[0];
    if (row === undefined) throw new Error("Expected the native APIKey result");
    expect(Object.getOwnPropertyNames(row)).not.toContain("sales_channels_link");
  });
});
