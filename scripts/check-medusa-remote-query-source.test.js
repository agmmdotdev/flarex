// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { remoteQuerySourcePairs, remoteQueryTestSourcePairs, verifyRemoteQuerySelection, verifyRemoteQuerySource, verifyRemoteQueryTestSource } from "./check-medusa-remote-query-source.mjs";

describe("complete pinned native Remote Query programs", () => {
  it("requires the complete exact source and native test cohort", () => {
    const files = [...remoteQuerySourcePairs.map(pair => ({ ...pair, classification: "remoteQueryFork" })),
      ...remoteQueryTestSourcePairs.map(pair => ({ ...pair, classification: "remoteQueryTestPort" }))];
    expect(() => verifyRemoteQuerySelection(files)).not.toThrow();
    for (let index = 0; index < files.length; index++) {
      expect(() => verifyRemoteQuerySelection(files.filter((_file, at) => at !== index))).toThrow("exact pinned source pair");
      expect(() => verifyRemoteQuerySelection(files.map((file, at) => at === index ? { ...file, classification: "authored" } : file)))
        .toThrow("exact pinned source pair");
      expect(() => verifyRemoteQuerySelection(files.map((file, at) => at === index ? { ...file, source: file.source + ".other" } : file)))
        .toThrow("exact pinned source pair");
    }
    expect(() => verifyRemoteQuerySelection([...files, { target: "unadmitted.ts", classification: "remoteQueryFork" }]))
      .toThrow("source closure");
  });
  it.each(remoteQuerySourcePairs)("preserves $target with only the exact explicit-host seam", pair => {
    expect(() => verifyRemoteQuerySource(readFileSync(pair.source, "utf8"), readFileSync(pair.target, "utf8"), pair.target)).not.toThrow();
  });
  it.each(remoteQueryTestSourcePairs)("preserves the complete native assertions/fixture $target", pair => {
    const native = readFileSync(pair.source, "utf8"), promoted = readFileSync(pair.target, "utf8");
    expect(() => verifyRemoteQueryTestSource(native, promoted, pair.target)).not.toThrow();
    expect(() => verifyRemoteQueryTestSource(native, promoted + "\nthrow new Error('unadmitted test change')", pair.target)).toThrow("Changed native Remote Query test");
  });
  it.each([
    ["joiner/remote-joiner.ts", 'fields.includes("*")', "false"],
    ["joiner/remote-joiner.ts", "this.serviceConfigCache.has(`alias_${alias.name}`)", "false"],
    ["joiner/remote-joiner.ts", "this.checkIfKeysExist({", "this.ignoreMissingKeys({"],
    ["joiner/remote-joiner.ts", "remoteFetchData: RemoteFetchDataCallback", "remoteFetchData?: RemoteFetchDataCallback"],
    ["joiner/remote-joiner.ts", "new Map(fields)", "fields"],
    ["joiner/remote-joiner.ts", "Object.create(null)", "{}"],
    ["joiner/remote-joiner.ts", "Object.create(null)", "Object.create(Object.prototype)"],
    ["joiner/remote-joiner.ts", "acc[key].push(data)", "acc[key] = data"],
    ["joiner/remote-joiner.ts", "new WeakMap<RemoteExpandProperty,", "new Map<RemoteExpandProperty,"],
    ["joiner/remote-joiner.ts", "entity: expand.serviceConfig.entity", "entity: expand.parentConfig?.entity"],
    ["joiner/remote-joiner.ts", "this.groupedParentContexts.get(parentExpand)!.set(localPath, context)", "this.groupedParentContexts.get(parentExpand)!.set(localPath, {})"],
    ["joiner/remote-joiner.ts", "Array.from(this.groupedParentContexts.get(c.expand) ?? [])", "[]"],
    ["joiner/helpers.ts", 'key === "schema"', 'key === "relationships"'],
    ["joiner/helpers.ts", "reference.fields = value.__fields ?? value.fields", "reference.fields = []"],
    ["remote-query/remote-query.ts", 'typeof remoteFetchData !== "function"', "false"],
    ["remote-query/remote-query.ts", "remoteFetchData: RemoteQueryFetchData", "remoteFetchData?: RemoteQueryFetchData"],
    ["remote-query/remote-query.ts", "groupedParentContexts: this.remoteJoiner.getGroupedParentContexts(expand)", "groupedParentContexts: []"],
    ["remote-query/remote-query.ts", "return await this.fetchData({", "return undefined ?? await this.fetchData({"],
    ["remote-query/remote-query.ts", 'filters["context"] = arg.value', 'filters["context"] = {}'],
    ["remote-query/remote-query.ts", "options[argName] = arg.value", "options[argName] = undefined"],
    ["remote-query/remote-query.ts", "relationship?.args?.methodSuffix ?? serviceConfig?.args?.methodSuffix", "serviceConfig?.args?.methodSuffix"],
    ["remote-query/remote-query.ts", "keyField,\n      ids,", "keyField,\n      ids: [],"],
    ["remote-query/query.ts", "return { data: response, metadata: undefined }", "return { data: response, metadata: {} }"],
    ["remote-query/query.ts", "metadata: response.metadata", "metadata: undefined"],
    ["remote-query/query.ts", "options?.locale", "false"],
    ["remote-query/query.ts", "backwardCompatibleQuery.graph = query.graph.bind(query)", "backwardCompatibleQuery.graph = query.query.bind(query)"],
    ["remote-query/query.ts", "this.#remoteQuery.getJoinerConfigs()", "[]"],
    ["remote-query/normalize-query-config.ts", "return config.__value", "return {}"],
    ["remote-query/normalize-query-config.ts", "toRemoteQuery(config, entitiesMap, joinerConfigs)", "toRemoteQuery(config, entitiesMap, [])"],
    ["remote-query/to-remote-query.ts", 'const FIELDS = "__fields"', 'const FIELDS = "fields"'],
    ["remote-query/to-remote-query.ts", "joinerQuery[entity][ARGUMENTS][\"withDeleted\"] = true", "joinerQuery[entity][ARGUMENTS][\"withDeleted\"] = false"],
    ["remote-query/parse-filters.ts", "return createFilterParser(joinerConfigs)(input, entitiesMap)", "return createFilterParser([])(input, entitiesMap)"],
    ["remote-query/parse-filters.ts", "const joinerConfigMapCache = new Map()", "const joinerConfigMapCache = globalThis.queryCache"],
    ["remote-query/parse-filters.ts", "filterKeyJoinerConfig.serviceName === entryJoinerConfig.serviceName", "true"],
    ["remote-query/remote-fetch-data.ts", 'const attrs = ["skip", "cursor"]', 'const attrs = ["skip", "cursor", "take"]'],
    ["remote-query/remote-fetch-data.ts", "options.take = null", "options.take = 256"],
    ["remote-query/remote-fetch-data.ts", 'const baseName = paginated ? "listAndCount" : "list"', 'const baseName = "listAndCount"'],
    ["remote-query/remote-fetch-data.ts", "count,\n  }", "count: 0,\n  }"],
    ["remote-query/remote-fetch-data.ts", "if (!isListAndCountResult(result)) throw new Error(\"Native counted callback", "if (false) throw new Error(\"Native counted callback"],
    ["remote-query/remote-fetch-data.ts", "return executeRemoteFetchServiceRequest({ ...request, service })", "return { data: [] }"],
  ])("rejects changed native body %s / %s", (suffix, before, after) => {
    const pair = remoteQuerySourcePairs.find(pair => pair.target.endsWith(suffix));
    if (pair === undefined) throw new Error("Missing native pair");
    const source = readFileSync(pair.source, "utf8"), promoted = readFileSync(pair.target, "utf8");
    expect(promoted).toContain(before);
    expect(() => verifyRemoteQuerySource(source, promoted.replace(before, after), pair.target)).toThrow("Changed native Remote Query program");
  });
});
