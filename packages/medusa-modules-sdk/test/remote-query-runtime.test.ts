import { describe, expect, it, vi } from "vitest";
import type { ModuleJoinerConfig } from "@medusajs/types";
import { captureJoinerServiceConfigs } from "@medusajs/orchestration/joiner";
import { createQuery, RemoteQuery, executeRemoteFetchServiceRequest, executeCountedRemoteFetchRequest, type RemoteQueryFetchRequest } from "../src/remote-query";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";

const configs: ModuleJoinerConfig[] = [{ serviceName: "thing", primaryKeys: ["id"], alias: [{ name: "thing", entity: "Thing", args: { methodSuffix: "Things" } }] }];
const setup = () => {
  const calls: RemoteQueryFetchRequest[] = [];
  const service = { listThings: vi.fn(async () => [{ id: "one", private: true }]),
    listAndCountThings: vi.fn(async () => [[{ id: "one", private: true }], 1]) };
  const remote = new RemoteQuery({ servicesConfig: configs, entitiesMap: new Map(), entityRelations: new Map(), remoteFetchData: request => {
    calls.push(request); return executeRemoteFetchServiceRequest({ ...request, service });
  } });
  return { remote, query: createQuery({ remoteQuery: remote }), service, calls };
};
describe("explicit native Remote Query runtime", () => {
  it("normalizes the real Graph and legacy object forms and preserves native result presentation", async () => {
    const { query, service, calls } = setup();
    expect(await query.graph({ entity: "thing", fields: ["id"], filters: { id: "one" }, pagination: { skip: 0, take: 1 } },
      { cache: { enable: true } })).toEqual({ data: [{ id: "one" }], metadata: { skip: 0, take: 1, count: 1 } });
    expect(service.listAndCountThings).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ serviceName: "thing", keyField: "id", ids: ["one"], filters: { id: ["one"] },
      methodSuffix: "Things", options: { select: ["id"], relations: [], args: {}, skip: 0, take: 1 } });
    expect(await query(remoteQueryObjectFromString({ entryPoint: "thing", fields: ["id"], variables: { id: "one" } }))).toEqual([{ id: "one" }]);
    expect(service.listThings).toHaveBeenCalledTimes(1);
    expect(calls[1]?.options).toMatchObject({ select: ["id"], relations: [], args: {}, take: null });
    expect(query).not.toHaveProperty("index"); expect(query).not.toHaveProperty("gql");
  });

  it("refuses ambiguous aliases and absent fetch callbacks without discovering a global service", () => {
    const create = () => new RemoteQuery({ servicesConfig: [...configs, { serviceName: "other", primaryKeys: ["id"], alias: [{ name: "thing", entity: "Other" }] }],
      entitiesMap: new Map(), entityRelations: new Map(), remoteFetchData: async () => ({ data: [] }) });
    expect(create).toThrow('It is already defined for Service');
    const input = { servicesConfig: configs, entitiesMap: new Map(), entityRelations: new Map(), remoteFetchData: async () => ({ data: [] }) };
    Object.defineProperty(input, "remoteFetchData", { value: undefined });
    expect(() => new RemoteQuery(input)).toThrow("requires an authenticated fetch callback");
  });

  it("retains native missing-key errors and refuses unadmitted locale before fetching", async () => {
    const { query, service } = setup();
    await expect(query.graph({ entity: "thing", fields: ["id"], filters: { id: "missing" } }, { throwIfKeyNotFound: true }))
      .rejects.toMatchObject({ type: "not_found", message: "Thing id not found: missing" });
    const before = service.listThings.mock.calls.length;
    await expect(query.graph({ entity: "thing", fields: ["id"] }, { locale: "en" })).rejects.toMatchObject({ type: "invalid_data" });
    expect(service.listThings.mock.calls).toHaveLength(before);
  });

  it("keeps the exact native metadata snapshot order when dropping schema", () => {
    const config: ModuleJoinerConfig = { ...configs[0] };
    expect(captureJoinerServiceConfigs([{ ...config, schema: "large SDL" }])).toEqual([config]);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    Object.defineProperty(config, "schema", { enumerable: true, value: cycle });
    expect(() => captureJoinerServiceConfigs([config])).toThrow(TypeError);
  });

  it("normalizes the named counted callback through the unchanged native fetch executor", async () => {
    const read = vi.fn(async () => [[{ id: "one" }], 1]);
    const common = { serviceName: "thing", methodSuffix: "Things", keyField: "id", ids: ["one"], filters: { visible: true } };
    expect(await executeCountedRemoteFetchRequest({ ...common, options: { select: ["id"], relations: [], take: 1 } }, read))
      .toEqual({ data: [{ id: "one" }] });
    expect(read).toHaveBeenLastCalledWith({ visible: true, id: ["one"] }, { select: ["id"], relations: [], take: null });
    expect(await executeCountedRemoteFetchRequest({ ...common, options: { relations: [], skip: 0, take: 1 } }, read))
      .toEqual({ data: { rows: [{ id: "one" }], metadata: { skip: 0, take: 1, count: 1 } }, path: "rows" });
    const before = read.mock.calls.length;
    expect(await executeCountedRemoteFetchRequest({ ...common, ids: [], options: { relations: [] } }, read)).toEqual({ data: [] });
    expect(read).toHaveBeenCalledTimes(before);
    await expect(executeCountedRemoteFetchRequest({ ...common, options: { relations: [] } }, async () => [{ id: "invented" }]))
      .rejects.toThrow("must return an actual list-and-count tuple");
  });
});
