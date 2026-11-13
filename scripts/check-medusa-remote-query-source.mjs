// @ts-check
import ts from "@typescript/typescript6";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const upstream = "third_party/medusa/upstream/packages/core/";
export const remoteQuerySourcePairs = [
  ["orchestration/src/joiner/remote-joiner.ts", "packages/medusa-orchestration/src/joiner/remote-joiner.ts"],
  ["orchestration/src/joiner/helpers.ts", "packages/medusa-orchestration/src/joiner/helpers.ts"],
  ...["remote-query", "query", "normalize-query-config", "to-remote-query", "parse-filters", "remote-fetch-data"].map(name =>
    ["modules-sdk/src/remote-query/" + name + ".ts", "packages/medusa-modules-sdk/src/remote-query/" + name + ".ts"]),
  ["utils/src/common/filter-operator-map.ts", "packages/medusa-utils/src/common/filter-operator-map.ts"],
].map(([source, target]) => ({ source: upstream + source, target }));
export const remoteQueryTestSourcePairs = [
  ["orchestration/src/__tests__/joiner/remote-joiner.ts", "packages/medusa-orchestration/test/native-remote-joiner.test.ts"],
  ["orchestration/src/__tests__/joiner/helpers.ts", "packages/medusa-orchestration/test/native-joiner-helpers.test.ts"],
  ["orchestration/src/__mocks__/joiner/mock_data.ts", "packages/medusa-orchestration/test/fixtures/mock_data.ts"],
  ["orchestration/src/__fixtures__/joiner/data.ts", "packages/medusa-orchestration/test/fixtures/data.ts"],
  ["modules-sdk/src/remote-query/__tests__/remote-fetch-data.spec.ts", "packages/medusa-modules-sdk/test/native-remote-fetch-data.test.ts"],
].map(([source, target]) => ({ source: upstream + source, target }));

/** @param {readonly {target:string,source?:string,classification:string}[]} files */
export function verifyRemoteQuerySelection(files) {
  for (const { pairs, classification } of [{ pairs: remoteQuerySourcePairs, classification: "remoteQueryFork" },
    { pairs: remoteQueryTestSourcePairs, classification: "remoteQueryTestPort" }]) {
    for (const pair of pairs) {
      const matches = files.filter(file => file.target === pair.target);
      if (matches.length !== 1 || matches[0].source !== pair.source || matches[0].classification !== classification)
        throw new Error("Native Remote Query selection outside its exact pinned source pair: " + pair.target);
    }
    if (files.some(file => file.classification === classification && !pairs.some(pair => pair.target === file.target)))
      throw new Error("Native Remote Query classification outside its source closure");
  }
}

/** @param {string} source @param {string} before @param {string} after */
function replace(source, before, after) {
  if (source.split(before).length !== 2) throw new Error("Changed native Remote Query adaptation anchor: " + before.slice(0, 90));
  return source.replace(before, after);
}
/** @param {string} source @param {string} name */
function method(source, name) {
  const parsed = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = parsed.statements.filter(ts.isClassDeclaration).flatMap(node => node.members)
    .filter(node => node.name?.getText(parsed) === name);
  if (found.length !== 1) throw new Error("Changed native Remote Query method: " + name);
  return found[0].getText(parsed);
}

/** Deterministic source promotion: explicit dependency injection, unadmitted
 * host removal and the related-data dictionary correction are exact forks.
 * All query algorithms remain in their Medusa owner and are compared below.
 * @param {string} input @param {string} target */
export function promoteRemoteQuerySource(input, target) {
  let source = input.replaceAll("\r\n", "\n");
  if (target.endsWith("/filter-operator-map.ts")) return source;
  if (target.endsWith("/remote-fetch-data.ts")) return source + `\n/** Explicit bounded counted-callback transport. The reader owns authority and\n * its actual tuple/count; this does not claim a native module.list invocation.\n * Native automatic dispatch still owns ID merging, take:null, batching and\n * pagination presentation through the private callback facade below. */\nexport async function executeCountedRemoteFetchRequest(\n  request: Omit<RemoteFetchServiceRequest, "service" | "traceFetchData">,\n  read: (filters: Record<string, unknown>, options: RemoteFetchOptions) => Promise<unknown>\n): Promise<RemoteFetchServiceResult> {\n  const counted = async (filters: Record<string, unknown>, options: RemoteFetchOptions) => {\n    const result = await read(filters, options)\n    if (!isListAndCountResult(result)) throw new Error("Native counted callback must return an actual list-and-count tuple")\n    return result\n  }\n  const service = {\n    [appendRemoteFetchMethodSuffix("listAndCount", request.methodSuffix)]: counted,\n    [appendRemoteFetchMethodSuffix("list", request.methodSuffix)]: async (filters: Record<string, unknown>, options: RemoteFetchOptions) => (await counted(filters, options))[0],\n  }\n  return executeRemoteFetchServiceRequest({ ...request, service })\n}\n`;
  if (target.endsWith("/joiner/helpers.ts")) {
    source = replace(source, "import { RemoteJoinerQuery }", "import { ModuleJoinerConfig, RemoteJoinerQuery }");
    return source + `\n/** The pinned RemoteJoiner constructor's metadata snapshot. */\nexport function captureJoinerServiceConfigs(serviceConfigs: readonly ModuleJoinerConfig[]): ModuleJoinerConfig[] {\n  return JSON.parse(JSON.stringify(serviceConfigs), (key, value) => {\n    if (key === "schema") { return }\n    return value\n  })\n}\n`;
  }
  if (target.endsWith("/joiner/remote-joiner.ts")) {
    source = replace(source, "  GraphQLUtils,\n", "");
    source = replace(source, '} from "@medusajs/utils"', '} from "./utils"');
    source = 'import { captureJoinerServiceConfigs } from "./helpers"\n' + source;
    source = replace(source, method(source, "parseQuery"), "");
    source = replace(source, "      entitiesMap?: Map<string, any>", "      entityRelations?: ReadonlyMap<string, ReadonlyMap<string, string>>");
    source = replace(source, "  constructor(\n    serviceConfigs: ModuleJoinerConfig[]", "  constructor(\n    serviceConfigs: readonly ModuleJoinerConfig[]");
    source = replace(source, `    if (this.options.entitiesMap) {\n      this.entityMap = GraphQLUtils.extractRelationsFromGQL(\n        this.options.entitiesMap\n      )\n    }`,
      `    if (this.options.entityRelations) {\n      this.entityMap = new Map([...this.options.entityRelations].map(([entity, fields]) => [entity, new Map(fields)]))\n    }`);
    source = replace(source, `      JSON.parse(JSON.stringify(serviceConfigs), (key, value) => {\n        if (key === "schema") {\n          return\n        }\n        return value\n      })`, "      captureJoinerServiceConfigs(serviceConfigs)");
    // Valid identifier values must never consult Object.prototype. Retain the
    // complete native grouping algorithm and change only its dictionary seed.
    const relatedData = method(source, "createRelatedDataMap");
    source = replace(source, relatedData, replace(relatedData, "    }, {})", "    }, Object.create(null))"));
    // Retain the native parser's resolved owners when same-service expands
    // are grouped. This sidecar observes the existing plan, never resolves it.
    source = replace(source, "  private entityMap: Map<string, Map<string, string>> = new Map()", `  private entityMap: Map<string, Map<string, string>> = new Map()

  private groupedParentContexts = new WeakMap<RemoteExpandProperty,
    Map<string, Pick<InternalJoinerServiceConfig, "serviceName" | "entity">>>()

  public getGroupedParentContexts(expand: RemoteExpandProperty) {
    return Array.from(this.groupedParentContexts.get(expand) ?? [], ([path, context]) => ({ path, ...context }))
  }`);
    source = replace(source, "    const mergedPaths = new Map<string, RemoteExpandProperty>()", `    const mergedPaths = new Map<string, RemoteExpandProperty>()
    for (const [path, expand] of parsedExpands) {
      this.groupedParentContexts.set(expand, new Map([[path, {
        serviceName: expand.serviceConfig.serviceName,
        entity: expand.serviceConfig.entity,
      }]]))
    }`);
    source = replace(source, "        mergedExpands.delete(path)", `        for (const [localPath, context] of this.groupedParentContexts.get(expand)!) {
          this.groupedParentContexts.get(parentExpand)!.set(localPath, context)
        }

        mergedExpands.delete(path)`);
    source = replace(source, "          if (unionArgs.length) {", `          this.groupedParentContexts.set(aggExpand, new Map(ctxs.flatMap(c =>
            Array.from(this.groupedParentContexts.get(c.expand) ?? []))))

          if (unionArgs.length) {`);
    return source;
  }
  if (target.endsWith("/parse-filters.ts")) {
    source = replace(source, 'import { isObject, isString } from "@medusajs/utils"', 'import { isObject } from "@medusajs/utils/common/is-object"\nimport { isString } from "@medusajs/utils/common/is-string"');
    source = replace(source, 'import { MedusaModule } from "../medusa-module"\n', "");
    source = replace(source, "const joinerConfigMapCache = new Map()", `export function parseAndAssignFilters(input: Parameters<ReturnType<typeof createFilterParser>>[0], entitiesMap: Map<string, any>, joinerConfigs: ModuleJoinerConfig[]) {\n  return createFilterParser(joinerConfigs)(input, entitiesMap)\n}\n\nfunction createFilterParser(joinerConfigs: ModuleJoinerConfig[]) {\nconst joinerConfigMapCache = new Map()`);
    source = replace(source, "export function parseAndAssignFilters(\n", "function parseAndAssignFilters(\n");
    source = replace(source, "  const joinerConfigs = MedusaModule.getAllJoinerConfigs()\n", "");
    return (source + "\nreturn parseAndAssignFilters\n}\n").replaceAll("joinerConfigs: ModuleJoinerConfig[]", "joinerConfigs: readonly ModuleJoinerConfig[]");
  }
  if (target.endsWith("/to-remote-query.ts")) {
    source = replace(source, "  RemoteQueryFilters,", "  ModuleJoinerConfig,\n  RemoteQueryFilters,");
    source = replace(source, 'import { isObject, QueryContext } from "@medusajs/utils"', 'import { isObject } from "@medusajs/utils/common/is-object"\nimport { QueryContext } from "@medusajs/utils/modules-sdk/query-context"');
    source = replace(source, "  entitiesMap: Map<string, any>\n", "  entitiesMap: Map<string, any>,\n  joinerConfigs: readonly ModuleJoinerConfig[]\n");
    source = replace(source, "QueryContext.isQueryContext(src)", "QueryContext.isQueryContext(src as Record<string, unknown>)");
    source = replace(source, "    entitiesMap\n  )", "    entitiesMap,\n    joinerConfigs\n  )");
    return source;
  }
  if (target.endsWith("/normalize-query-config.ts")) {
    source = replace(source, "  RemoteJoinerQuery,", "  ModuleJoinerConfig,\n  RemoteJoinerQuery,");
    source = replace(source, 'from "@medusajs/utils"', 'from "@medusajs/utils/common/remote-query-object-from-string"');
    source = replace(source, "  entitiesMap,\n", "  entitiesMap,\n  joinerConfigs,\n");
    source = replace(source, "  entitiesMap: RemoteQueryEntityMap\n", "  entitiesMap: RemoteQueryEntityMap\n  joinerConfigs: readonly ModuleJoinerConfig[]\n");
    source = replace(source, "toRemoteQuery(config, entitiesMap)", "toRemoteQuery(config, entitiesMap, joinerConfigs)");
    return source;
  }
  if (target.endsWith("/remote-query.ts")) {
    source = replace(source, 'from "@medusajs/orchestration"', 'from "@medusajs/orchestration/joiner"');
    source = replace(source, "  LoadedModule,\n", "");
    source = replace(source, "  RemoteFetchDataCallback,\n", "  captureJoinerServiceConfigs,\n");
    source = replace(source, "  JoinerServiceConfig,\n", "");
    source = replace(source, 'import { isString } from "@medusajs/utils"', 'import { isString } from "@medusajs/utils/common/is-string"');
    source = replace(source, 'import { MedusaModule } from "../medusa-module"\n', "");
    source = replace(source, "  executeRemoteFetchServiceRequest,\n", "");
    source = replace(source, "  type RemoteFetchTrace,", "  type RemoteFetchServiceRequest,\n  type RemoteFetchServiceResult,");
    const start = source.indexOf("export class RemoteQuery"), constructorEnd = source.indexOf("  public getEntitiesMap()");
    if (start < 0 || constructorEnd < start) throw new Error("Changed native Remote Query constructor");
    source = source.slice(0, start) + `export interface RemoteQueryFetchRequest extends Omit<RemoteFetchServiceRequest, "service" | "traceFetchData"> {\n  readonly expand: RemoteExpandProperty\n  readonly relationship?: JoinerRelationship\n  readonly groupedParentContexts?: ReturnType<RemoteJoiner["getGroupedParentContexts"]>\n}\nexport type RemoteQueryFetchData = (request: RemoteQueryFetchRequest) => Promise<RemoteFetchServiceResult>\n\nexport class RemoteQuery {\n  private remoteJoiner: RemoteJoiner\n  private entitiesMap: Map<string, unknown>\n  private servicesConfig: ModuleJoinerConfig[]\n  private fetchData: RemoteQueryFetchData\n\n  constructor({ servicesConfig, entitiesMap, entityRelations, remoteFetchData }: {\n    servicesConfig: ModuleJoinerConfig[]\n    entitiesMap: Map<string, unknown>\n    entityRelations: ReadonlyMap<string, ReadonlyMap<string, string>>\n    remoteFetchData: RemoteQueryFetchData\n  }) {\n    if (typeof remoteFetchData !== "function") throw new Error("Native Remote Query requires an authenticated fetch callback")\n    this.servicesConfig = structuredClone(servicesConfig)\n    this.entitiesMap = new Map(entitiesMap)\n    this.fetchData = remoteFetchData\n    this.remoteJoiner = new RemoteJoiner(this.servicesConfig, this.remoteFetchData.bind(this), { autoCreateServiceNameAlias: false, entityRelations })\n  }\n\n  public getJoinerConfigs() { return structuredClone(this.servicesConfig) }\n\n` + source.slice(constructorEnd);
    source = replace(source, method(source, "setFetchDataCallback"), "");
    const fetch = method(source, "remoteFetchData"), bodyStart = fetch.indexOf("    if (this.customRemoteFetchData)"), bodyEnd = fetch.indexOf("    return this.executeFetchRequest");
    if (bodyStart < 0 || bodyEnd < bodyStart) throw new Error("Changed native fetch callback boundary");
    source = replace(source, fetch, fetch.slice(0, bodyStart) + fetch.slice(bodyEnd));
    source = replace(source, "    const service = this.modulesMap.get(serviceConfig.serviceName)!\n", "");
    source = replace(source, "return await executeRemoteFetchServiceRequest({", "return await this.fetchData({");
    source = replace(source, "      service,\n", "      expand,\n      relationship,\n      groupedParentContexts: this.remoteJoiner.getGroupedParentContexts(expand),\n");
    source = replace(source, "      traceFetchData: RemoteQuery.traceFetchRemoteData,\n", "");
    source = replace(source, "      finalQuery = RemoteJoiner.parseQuery(query, variables)", '      throw new Error("GraphQL is outside the admitted native Remote Query profile")');
    source = replace(source, "this.servicesConfig = structuredClone(servicesConfig)", "this.servicesConfig = captureJoinerServiceConfigs(servicesConfig)");
    source = replace(source, "    servicesConfig: ModuleJoinerConfig[]", "    servicesConfig: readonly ModuleJoinerConfig[]");
    source = replace(source, "return structuredClone(this.servicesConfig)", "return captureJoinerServiceConfigs(this.servicesConfig)");
    return source;
  }
  if (target.endsWith("/query.ts")) {
    let unwrap = method(source, "#unwrapQueryConfig");
    unwrap = replace(unwrap, "      entitiesMap: this.#remoteQuery.getEntitiesMap(),", "      entitiesMap: this.#remoteQuery.getEntitiesMap(),\n      joinerConfigs: this.#remoteQuery.getJoinerConfigs(),");
    let query = method(source, "query");
    const trace = query.indexOf("    if (Query.traceRemoteQuery)"), direct = query.indexOf("    return await this.#remoteQuery.query(config, undefined, options)");
    if (trace < 0 || direct < trace) throw new Error("Changed native Query trace boundary");
    query = query.slice(0, trace) + query.slice(direct);
    let graph = method(source, "graph");
    graph = replace(graph, "@Cached(cacheDecoratorOptions)\n  ", "");
    graph = replace(graph, "      this.#remoteQuery.getEntitiesMap()", "      this.#remoteQuery.getEntitiesMap(),\n      this.#remoteQuery.getJoinerConfigs()");
    const tracing = graph.indexOf("    if (Query.traceGraphQuery)"), result = graph.indexOf("    const result = this.#unwrapRemoteQueryResponse(response)");
    if (tracing < 0 || result < tracing) throw new Error("Changed native graph trace boundary");
    graph = graph.slice(0, tracing) + "    response = await this.#remoteQuery.query(normalizedQuery, undefined, options)\n\n" + graph.slice(result);
    const locale = graph.indexOf("    if (options?.locale)"), returning = graph.indexOf("    return result");
    if (locale < 0 || returning < locale) throw new Error("Changed native locale boundary");
    graph = graph.slice(0, locale) + graph.slice(returning);
    graph = replace(graph, "    const normalizedQuery = toRemoteQuery(", '    if (options?.locale) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Locale is outside the admitted native Query profile")\n    const normalizedQuery = toRemoteQuery(');
    return `import type { GraphResultSet, RemoteJoinerOptions, RemoteJoinerQuery, RemoteQueryInput, RemoteQueryObjectConfig, RemoteQueryObjectFromStringResult, RemoteQueryFunctionReturnPagination } from "@medusajs/types"\nimport { MedusaError } from "@medusajs/utils/common/errors"\nimport { isObject } from "@medusajs/utils/common/is-object"\nimport { normalizeQueryConfig } from "./normalize-query-config"\nimport { RemoteQuery } from "./remote-query"\nimport { toRemoteQuery } from "./to-remote-query"\n\nexport class Query {\n  #remoteQuery: RemoteQuery\n  constructor({ remoteQuery }: { remoteQuery: RemoteQuery }) { this.#remoteQuery = remoteQuery }\n\n${unwrap}\n\n${method(source, "#unwrapRemoteQueryResponse")}\n\n${query}\n\n${graph}\n}\n\nexport function createQuery({ remoteQuery }: { remoteQuery: RemoteQuery }) {\n  const query = new Query({ remoteQuery })\n  function backwardCompatibleQuery(...args: Parameters<Query["query"]>) { return query.query.apply(query, args) }\n  backwardCompatibleQuery.graph = query.graph.bind(query)\n  return backwardCompatibleQuery\n}\n`;
  }
  throw new Error("Unknown native Remote Query target " + target);
}

/** @param {string} source */
function program(source) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true }, reportDiagnostics: true });
  if (output.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error("Invalid Remote Query source syntax");
  return ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile("runtime.js", output.outputText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
}
/** @param {string} source */
const typedProgram = source => ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile("native.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
/** @param {string} native @param {string} promoted @param {string} target */
export function verifyRemoteQuerySource(native, promoted, target) {
  if (!remoteQuerySourcePairs.some(pair => pair.target === target)) throw new Error("Unknown native Remote Query target");
  const expected = promoteRemoteQuerySource(native, target);
  if (program(promoted) !== program(expected) || typedProgram(promoted) !== typedProgram(expected)) throw new Error("Changed native Remote Query program: " + target);
}
/** Exact native assertion ports: only imports/runner ownership move.
 * @param {string} source @param {string} target */
export function promoteRemoteQueryTestSource(source, target) {
  let text = source.replaceAll("\r\n", "\n");
  const names = target.endsWith("native-remote-joiner.test.ts") ? "beforeAll, beforeEach, describe, expect, it, vi as jest"
    : target.endsWith("native-joiner-helpers.test.ts") ? "beforeEach, describe, expect, it, vi as jest"
    : target.endsWith("native-remote-fetch-data.test.ts") ? "describe, expect, it, vi as jest"
    : target.endsWith("mock_data.ts") ? "vi as jest" : undefined;
  if (names !== undefined) text = `import { ${names} } from "vitest"\n` + text;
  return text.replace('import { lowerCaseFirst, toPascalCase } from "@medusajs/utils"', 'import { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first"\nimport { toPascalCase } from "@medusajs/utils/common/to-pascal-case"')
    .replace('"../../__mocks__/joiner/mock_data"', '"./fixtures/mock_data"').replace('"./../../joiner"', '"../src/joiner"')
    .replace('"../../joiner/helpers"', '"../src/joiner/helpers"').replace('"./../../__fixtures__/joiner/data"', '"./data"')
    .replace('"../remote-fetch-data"', '"../src/remote-query/remote-fetch-data"');
}
/** @param {string} native @param {string} promoted @param {string} target */
export function verifyRemoteQueryTestSource(native, promoted, target) {
  if (!remoteQueryTestSourcePairs.some(pair => pair.target === target)) throw new Error("Unknown native Remote Query test target");
  const expected = promoteRemoteQueryTestSource(native, target);
  if (program(promoted) !== program(expected) || typedProgram(promoted) !== typedProgram(expected)) throw new Error("Changed native Remote Query test: " + target);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const pair of remoteQuerySourcePairs) verifyRemoteQuerySource(readFileSync(pair.source, "utf8"), readFileSync(pair.target, "utf8"), pair.target);
  for (const pair of remoteQueryTestSourcePairs) verifyRemoteQueryTestSource(readFileSync(pair.source, "utf8"), readFileSync(pair.target, "utf8"), pair.target);
  console.log("Verified " + remoteQuerySourcePairs.length + " native Remote Query source pairs and " + remoteQueryTestSourcePairs.length + " native test ports.");
}
