import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { coerceFilterValue } from "@medusajs/drizzle/filter-value";
import { defineAtomicCommerceParticipant, type AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { nativeLinkGraphPaths, nativeLinkGraphServices } from "../src/local-graph/links";
import type { GraphModuleDefinition, GraphParticipant, GraphRemotePath } from "../src/local-graph/model";
import type { ReadTable } from "../src/query/catalog";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { captureCommerceInput } from "../src/value/input";
import { commerceDecoder } from "../src/value/decoder";
import { defineWorkflowMethod, workflowMethodDefinition } from "../src/workflow/module";
import { bindWorkflowQuery } from "../src/workflow/query";
import { captureWorkflowInput } from "../src/workflow/value";
import { runEffect } from "../../persistence-postgres/test/support/effectTestRuntime";

const bounds = { maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 2 };
const detailPlace: ModuleJoinerConfig = { isLink: true, serviceName: "DetailPlaceLink", alias: [{ name: "detail_place", entity: "LinkDetailPlace" }],
  relationships: [
    { serviceName: "catalog", entity: "Detail", primaryKey: "id", foreignKey: "detail_id", alias: "detail" },
    { serviceName: "places", entity: "Place", primaryKey: "id", foreignKey: "place_id", alias: "place" },
  ], extends: [{ serviceName: "catalog", entity: "Detail", fieldAlias: { place: "places_link.place" },
    relationship: { primaryKey: "detail_id", foreignKey: "id", alias: "places_link", serviceName: "DetailPlaceLink" } }],
};
const placeCredential: ModuleJoinerConfig = { isLink: true, serviceName: "PlaceCredentialLink", alias: [{ name: "place_credential", entity: "LinkPlaceCredential" }],
  relationships: [
    { serviceName: "places", entity: "Place", primaryKey: "id", foreignKey: "place_id", alias: "place" },
    { serviceName: "catalog", entity: "Credential", primaryKey: "id", foreignKey: "credential_id", alias: "credential" },
  ], extends: [
    { serviceName: "places", fieldAlias: { credentials: { path: "credentials_link.credential", isList: true } },
      relationship: { primaryKey: "place_id", foreignKey: "id", alias: "credentials_link", serviceName: "PlaceCredentialLink", isList: true } },
    { serviceName: "catalog", entity: "Credential", fieldAlias: { places: { path: "places_link.place", isList: true } },
      relationship: { primaryKey: "credential_id", foreignKey: "id", alias: "places_link", serviceName: "PlaceCredentialLink", isList: true } },
  ],
};
const configured = [detailPlace, placeCredential];
const paths = () => [
  ...Result.getOrThrow(nativeLinkGraphPaths(detailPlace, [{ root: "Container", path: "detail.places", ...bounds }], "Detail", configured)),
  ...Result.getOrThrow(nativeLinkGraphPaths(placeCredential, [{ root: "Container", path: "detail.places.credentials", ...bounds }], "Place", configured)),
];
const command = (name: string) => defineGraphReadCommand(name, () => Effect.succeed([[], 0]));
const containerRead = command("neutralContainer"), detailRead = command("neutralDetail"), placeRead = command("neutralPlace"), credentialRead = command("neutralCredential");
const firstLinkRead = command("neutralDetailPlace"), secondLinkRead = command("neutralPlaceCredential");
const table = (name: string, columns = ["id"], primaryKeys = ["id"]): ReadTable => ({ name, columns, primaryKeys, foreignKeys: [], companions: {} });
const read = (model: string, selected: typeof containerRead, selectedTable = table(model.toLowerCase())) => ({ model, command: selected,
  table: selectedTable, paths: [], orderable: selectedTable.primaryKeys, uniqueOrder: selectedTable.primaryKeys.length === 1 ? selectedTable.primaryKeys : [],
  multipleOrder: false, decode: decodeGraphCount });
function participants(remote: readonly GraphRemotePath[] = paths()): GraphParticipant[] {
  const catalog: GraphModuleDefinition = { aliases: [{ name: "container", model: "Container" }, { name: "detail", model: "Detail" }, { name: "credential", model: "Credential" }],
    reads: [{ ...read("Container", containerRead, { ...table("container", ["id", "detail_id"]), foreignKeys: ["detail_id"] }),
      paths: [{ path: "detail", table: table("detail"), many: false, sourceFields: ["detail_id"] }] },
      read("Detail", detailRead), read("Credential", credentialRead)] };
  return [
    { participant: defineAtomicCommerceParticipant("neutral-catalog"), module: catalog },
    { participant: defineAtomicCommerceParticipant("neutral-places"), module: { aliases: [{ name: "place", model: "Place" }], reads: [read("Place", placeRead)] } },
    { participant: defineAtomicCommerceParticipant("neutral-first-link"), module: { aliases: [{ name: "detail_place", model: "LinkDetailPlace" }],
      services: Result.getOrThrow(nativeLinkGraphServices(detailPlace)), reads: [read("LinkDetailPlace", firstLinkRead, table("detail_place", ["detail_id", "place_id"], ["detail_id", "place_id"]))],
      remotePaths: remote.filter(path => path.linkModel === "LinkDetailPlace") } },
    { participant: defineAtomicCommerceParticipant("neutral-second-link"), module: { aliases: [{ name: "place_credential", model: "LinkPlaceCredential" }],
      services: Result.getOrThrow(nativeLinkGraphServices(placeCredential)), reads: [read("LinkPlaceCredential", secondLinkRead, table("place_credential", ["place_id", "credential_id"], ["place_id", "credential_id"]))],
      remotePaths: remote.filter(path => path.linkModel === "LinkPlaceCredential") } },
  ];
}
// This port records authentic command selection only. It neither simulates
// database filtering nor establishes persistence/transaction compatibility.
function context(results: readonly Json[], calls: Array<{ command: unknown; args: Json }> = []): AtomicCommerceContext {
  let index = 0;
  return { eventGroupId: "neutral-query", checkpoint: Effect.void, refuse: Effect.fail,
    capture: () => Effect.fail(commerceError("unsupportedProfile")), emit: () => Effect.fail(commerceError("unadmittedEvent")),
    clearPendingEvents: () => Effect.fail(commerceError("unadmittedEvent")),
    call: (_participant, selected, args) => { calls.push({ command: selected, args });
      const result = results[index++]; return result === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(result); },
  };
}
const input = { entryPoint: "container", fields: ["id", "detail.places.credentials.id"], variables: { id: ["c"] } };
const rows: readonly Json[] = [
  [[{ id: "c", detail_id: "d", detail: { id: "d" } }], 1], [[{ detail_id: "d", place_id: "p" }], 1],
  [[{ id: "p" }], 1], [[{ place_id: "p", credential_id: "key" }], 1], [[{ id: "key" }], 1],
];
async function withQuery<Value>(results: readonly Json[], work: (query: ReturnType<typeof bindWorkflowQuery>, calls: Array<{ command: unknown; args: Json }>) => Promise<Value>, selected = participants()) {
  const owner = await runEffect(makeCommercePromiseOwner()), calls: Array<{ command: unknown; args: Json }> = [];
  try { return await work(bindWorkflowQuery(Result.getOrThrow(prepareLocalGraph(selected)), context(results, calls), owner), calls); }
  finally { await runEffect(owner.close); }
}
const singletonParticipants = (): GraphParticipant[] => [{ participant: defineAtomicCommerceParticipant("neutral-singleton"), module: {
  aliases: [{ name: "stock_location", model: "StockLocation" }], reads: [{
    ...read("StockLocation", containerRead, { ...table("location", ["id", "name", "address_id"]), foreignKeys: ["address_id"] }),
    paths: [{ path: "address", table: table("address", ["id", "city"]), many: false, optional: true, sourceFields: ["address_id"] }],
  }],
} }];
const singletonInput = { entryPoint: "stock_location", fields: ["id", "name", "address.id", "address.city"], variables: { id: "sloc" } };
const singletonOptions = { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined };

describe("bounded native callable Query boundaries", () => {
  it("projects exact native singleton fields without leaking the Address hydration key", async () => {
    await withQuery([[[{ id: "sloc", name: "Warehouse", address_id: "addr", address: { id: "addr", city: "Yangon" } }], 1]], async (query, calls) => {
      expect(await query(singletonInput, singletonOptions)).toStrictEqual([{ id: "sloc", name: "Warehouse", address: { id: "addr", city: "Yangon" } }]);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toMatchObject({ filters: { id: ["sloc"] }, config: { relations: ["address"], take: 256 } });
    }, singletonParticipants());
    await withQuery([[[{ id: "sloc", name: "Warehouse", address_id: null, address: null }], 1]], async query => {
      expect(await query(singletonInput, singletonOptions)).toStrictEqual([{ id: "sloc", name: "Warehouse", address: null }]);
    }, singletonParticipants());
  });

  it("preserves the native not-found failure and its exact error cause", async () => {
    await withQuery([[[], 0]], async query => {
      await expect(query(singletonInput, singletonOptions)).rejects.toMatchObject({ reason: "adapterFailure",
        cause: { type: "not_found", message: "StockLocation id not found: sloc" } });
    }, singletonParticipants());
  });

  it("allows native not-found recovery before an unrelated Query without latching refusal", async () => {
    const owner = await runEffect(makeCommercePromiseOwner());
    const calls: Array<{ command: unknown; args: Json }> = [], refusals: unknown[] = [];
    const ctx = context([[[], 0], [[{ id: "other" }], 1]], calls);
    const graph = Result.getOrThrow(prepareLocalGraph(singletonParticipants()));
    const query = bindWorkflowQuery(graph, { ...ctx, refuse: error => {
      refusals.push(error);
      return ctx.refuse(error);
    } }, owner);
    try {
      await expect(query(singletonInput, singletonOptions)).rejects.toMatchObject({ reason: "adapterFailure",
        cause: { type: "not_found", message: "StockLocation id not found: sloc" } });
      expect(await query.graph({ entity: "stock_location", fields: ["id"], filters: { id: ["other"] }, pagination: { take: 1 } }))
        .toStrictEqual({ data: [{ id: "other" }], metadata: { count: 1, skip: 0, take: 1 } });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.args).toMatchObject({ filters: { id: ["other"] } });
      expect(refusals).toEqual([]);
    } finally { await runEffect(owner.close); }
  });

  it("refuses broader singleton options before dispatch and preserves no-getter capture", async () => {
    const getter = vi.fn(() => true);
    const accessor = Object.defineProperty({}, "throwIfKeyNotFound", { enumerable: true, get: getter });
    await withQuery([], async (query, calls) => {
      for (const args of [[singletonInput], [singletonInput, {}], [singletonInput, { throwIfKeyNotFound: false }],
        [singletonInput, { ...singletonOptions, throwIfRelationNotFound: true }], [singletonInput, { ...singletonOptions, unknown: true }],
        [singletonInput, singletonOptions, undefined],
        [{ ...singletonInput, entryPoint: "container" }, singletonOptions],
        [{ ...singletonInput, variables: { filters: { id: "sloc" } } }, singletonOptions],
        [{ ...singletonInput, variables: { id: ["sloc"] } }, singletonOptions]]) {
        await expect(query(...args)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      }
      // Descriptor/prototype rejection belongs to the shared value-capture
      // owner and precedes the selected Query ABI decoder.
      for (const options of [accessor, Object.create(singletonOptions)]) {
        await expect(query(singletonInput, options)).rejects.toMatchObject({ reason: "invalidInput" });
      }
      expect(calls).toHaveLength(0);
    }, singletonParticipants());
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses incomplete or multirow singleton results and closes the callable with its owner", async () => {
    for (const result of [[[{ id: "sloc", name: "Warehouse", address: null }], 2],
      [[{ id: "sloc", name: "Warehouse", address: null }, { id: "other", name: "Other", address: null }], 2]] satisfies Json[]) {
      await withQuery([result], async query => {
        await expect(query(singletonInput, singletonOptions)).rejects.toMatchObject({ reason: "storedCorruption" });
      }, singletonParticipants());
    }
    let retained: ReturnType<typeof bindWorkflowQuery> | undefined;
    await withQuery([], async query => { retained = query; }, singletonParticipants());
    if (retained === undefined) throw new Error("Missing closed Query fixture");
    await expect(retained(singletonInput, singletonOptions)).rejects.toMatchObject({ reason: "closed" });
  });

  it("uses native singleton aliases, optional extension entities and checked endpoints across a local prefix and two Links", async () => {
    expect(paths()).toMatchObject([{ sourceModel: "Detail", targetModel: "Place", path: "detail.places" },
      { sourceModel: "Place", targetModel: "Credential", path: "detail.places.credentials" }]);
    await withQuery(rows, async (query, calls) => {
      expect(await query(input)).toEqual([{ id: "c", detail_id: "d", detail: { id: "d", places: [{ id: "p", credentials: [{ id: "key" }] }] } }]);
      expect(calls.map(call => call.command)).toEqual([containerRead, firstLinkRead, placeRead, secondLinkRead, credentialRead]);
      expect(calls[0]?.args).toMatchObject({ config: { relations: ["detail"] } });
    });
    await withQuery(rows, async query => {
      expect((await query.graph({ entity: "container", fields: input.fields, pagination: { take: 4 } })).data)
        .toEqual([{ id: "c", detail: { places: [{ credentials: [{ id: "key" }] }] } }]);
    });
  });

  it("dispatches the native service identity to its selected Link read and preserves the ordinary graph facade", async () => {
    await withQuery([[[{ detail_id: "d", place_id: "p" }], 1], [[{ id: "c" }], 1]], async (query, calls) => {
      expect(await query({ service: "DetailPlaceLink", fields: ["detail_id", "place_id"], variables: { filters: { detail_id: ["d"] } } }))
        .toEqual([{ detail_id: "d", place_id: "p" }]);
      expect(calls[0]?.command).toBe(firstLinkRead);
      expect(await query.graph({ entity: "container", fields: ["id"], pagination: { take: 1 } }))
        .toEqual({ data: [{ id: "c" }], metadata: { count: 1, skip: 0, take: 1 } });
    });
  });

  it("normalizes selected undefined ID slots through native scalar coercion and leaves strict JSON unchanged", async () => {
    const supplied = { entryPoint: "container", fields: ["id"], variables: { id: [undefined, "c"] } };
    await withQuery([[[], 0]], async (query, calls) => {
      expect(await query(supplied)).toEqual([]);
      expect(calls[0]?.args).toMatchObject({ filters: { id: ["", "c"] } });
    });
    expect(supplied.variables.id).toEqual([undefined, "c"]);
    expect(Result.isFailure(captureCommerceInput(supplied))).toBe(true);
    expect(coerceFilterValue("id", undefined)).toBe("");
    expect(coerceFilterValue("created_at", "2026-10-18")).toEqual(new Date("2026-10-18"));
  });

  it("refuses unknown ABIs, accessors, prototypes, holes, cycles and oversized values before dispatch", async () => {
    const getter = vi.fn(() => "container"), cycle: { self?: unknown } = {}; cycle.self = cycle;
    const accessor = Object.defineProperty({ fields: ["id"], variables: { id: [] } }, "entryPoint", { get: getter, enumerable: true });
    const invalid: unknown[] = [{ ...input, unknown: true }, { ...input, service: "DetailPlaceLink" }, { ...input, entryPoint: "missing" },
      { service: "MissingLink", fields: ["id"], variables: { filters: {} } }, { ...input, variables: { id: new Array(1) } },
      { ...input, variables: { id: [null] } }, { ...input, variables: { id: [], take: 1 } }, accessor, Object.create({ entryPoint: "container" }), cycle,
      { ...input, variables: { id: ["x".repeat(defaultCommerceResources.commandBytes)] } }];
    await withQuery([], async (query, calls) => {
      for (const value of invalid) await expect(query(value)).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      await expect(query(input, input)).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(calls).toHaveLength(0);
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses incomplete whole-query results and duplicate or foreign service bindings", async () => {
    await withQuery([[[{ id: "c" }], 257]], async query => {
      await expect(query({ ...input, fields: ["id"] })).rejects.toMatchObject({ reason: "storedCorruption" });
    });
    const selected = participants(), first = selected[2], second = selected[3];
    if (first === undefined || second === undefined) throw new Error("Missing neutral Link fixture");
    expect(Result.isFailure(prepareLocalGraph([...selected, { participant: first.participant, module: { aliases: [], reads: [], services: [{ name: "ForeignLink", model: "Container" }] } }]))).toBe(true);
    const services = first.module.services;
    if (services === undefined) throw new Error("Missing authentic service identity");
    expect(Result.isFailure(prepareLocalGraph(selected.map(entry => entry === second ? { ...entry, module: { ...entry.module, services } } : entry)))).toBe(true);
  });

  it("keeps local-prefix cohort limits global and rejects missing or foreign local endpoints", async () => {
    const selected = participants(paths().map(path => ({ ...path, maximumSources: 1 })));
    const graph = Result.getOrThrow(prepareLocalGraph(selected));
    await expect(runEffect(graph.bind(context([[[{ id: "a", detail: { id: "d1" } }, { id: "b", detail: { id: "d2" } }], 2]]))
      .graph({ entity: "container", fields: input.fields, pagination: { take: 2 } }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
    const base = participants(), root = base[0];
    if (root === undefined) throw new Error("Missing local prefix fixture");
    expect(Result.isFailure(prepareLocalGraph(base.map(entry => entry === root ? { ...entry, module: { ...entry.module,
      reads: entry.module.reads.map(value => value.model === "Container" ? { ...value, paths: [] } : value) } } : entry)))).toBe(true);
  });

  it("checks deep native join fields against their actual local parent and rejects ambiguous native aliases", () => {
    const rootTable = { ...table("outer", ["id", "middle_id"]), foreignKeys: ["middle_id"] };
    const middleTable = { ...table("middle", ["id", "inner_id"]), foreignKeys: ["inner_id"] };
    const deep = (sourceFields: readonly string[]): GraphParticipant[] => [{ participant: defineAtomicCommerceParticipant("neutral-deep"), module: {
      aliases: [{ name: "outer", model: "Outer" }], reads: [{ ...read("Outer", containerRead, rootTable), paths: [
        { path: "middle", table: middleTable, many: false, sourceFields: ["middle_id"] },
        { path: "middle.inner", table: table("inner"), many: false, sourceFields },
      ] }],
    } }];
    expect(Result.isSuccess(prepareLocalGraph(deep(["inner_id"])))).toBe(true);
    expect(Result.isFailure(prepareLocalGraph(deep(["middle_id"])))).toBe(true);
    const duplicate = structuredClone(placeCredential);
    const extension = duplicate.extends?.[1];
    if (extension === undefined) throw new Error("Missing neutral alias extension");
    duplicate.extends?.push(extension);
    expect(Result.isFailure(nativeLinkGraphPaths(detailPlace, [{ root: "Container", path: "detail.places", ...bounds }], "Detail", [detailPlace, duplicate]))).toBe(true);
  });

  it("preserves positional method undefined until its declared native decoder, then strictly captures command input", () => {
    const decode = commerceDecoder(Schema.Tuple([Schema.Struct({ id: Schema.Array(Schema.UndefinedOr(Schema.String)) }), Schema.Undefined]), "invalidInput");
    const decodeIds = commerceDecoder(Schema.Array(Schema.String), "invalidInput");
    const method = Result.getOrThrow(defineWorkflowMethod({ command: containerRead,
      arguments: value => decode(value).pipe(Result.flatMap(([filters]) => decodeIds(filters.id.map(value => coerceFilterValue("id", value)))), Result.map(ids => [ids] as const)),
      encode: ([id]) => ({ id }),
      output: commerceDecoder(Schema.Json, "storedCorruption") }));
    const definition = workflowMethodDefinition(method);
    if (definition === undefined) throw new Error("Missing neutral method");
    expect(Result.getOrThrow(definition.input([{ id: [undefined, "c"], omitted: undefined }, undefined]))).toEqual({ id: ["", "c"] });
    expect(Result.isFailure(definition.input([{ id: [undefined] }, undefined, "unexpected"]))).toBe(true);
    expect(Result.getOrThrow(captureWorkflowInput([{ omitted: undefined, nested: [undefined] }, undefined])))
      .toStrictEqual([{ nested: [undefined] }, undefined]);
  });
});
