import { Effect, Result, Schema } from "effect";
import { commerceError, commerceLimits, capturePrivateJsonData, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import { QueryLimit, QueryOffset } from "../query/decoder";
import { makeReadCatalog } from "../query/catalog";
import { isGraphReadCommand } from "./commands";
import { planGraphFields } from "./fields";
import { captureGraphPresentation, graphSelectableColumns } from "./presentation";
import type { GraphParticipant, GraphReadDefinition, GraphReadSelection, GraphRelationPath, LocalGraphQuery, PreparedLocalGraph } from "./model";
import { prepareGraphRemotePaths, prepareGraphLinkEndpoints, validateGraphPathPrefixes } from "./remote-paths";
import { prepareGraphDirectPaths } from "./direct-paths";
import { GraphQueryContexts } from "./context";
import { captureGraphComputedObjects } from "./computed";
import { prepareNativeReadRegistry } from "./native-registry";
import { prepareNativeCohorts } from "./native-cohorts";
import { admitNativeQueryPaths, makeNativeQueryBridge } from "./native-bridge";
import { decodeNativeGraphOptions, prepareNativeGraphInput } from "./native-input";
import { captureCommerceInput } from "../value/input";

const queryFields = {
  context: Schema.optionalKey(GraphQueryContexts),
  fields: Schema.Array(Schema.String.check(Schema.isBetweenLength(1, 256))).check(Schema.isBetweenLength(1, 256)),
  filters: Schema.optionalKey(Schema.JsonObject),
  pagination: Schema.Struct({ take: QueryLimit, skip: Schema.optionalKey(QueryOffset),
    order: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literals(["ASC", "DESC"]))),
  }),
};
const decodeInput = commerceDecoder(Schema.Struct({ entity: Schema.String.check(Schema.isBetweenLength(1, 256)), ...queryFields }), "unsupportedProfile");
export const decodeGraphList = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)), "storedCorruption");
export const decodeGraphCount = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)),
  Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
]), "storedCorruption");

function nativeFilters(value: Json, allowOr: boolean): boolean {
  if (Array.isArray(value)) return value.every(member => nativeFilters(member, allowOr));
  if (!isJsonObject(value)) return true;
  return Object.entries(value).every(([key, member]) => key === "$or"
    ? allowOr && Array.isArray(member) && member.every(branch => isJsonObject(branch) && nativeFilters(branch, allowOr))
    : !key.startsWith("$") && nativeFilters(member, allowOr));
}

function graphOrder(read: GraphReadDefinition, supplied: Readonly<Record<string, "ASC" | "DESC">> | undefined): Result.Result<JsonObject, CommerceTransactionError> {
  const identity = read.table.primaryKeys[0];
  if (identity === undefined) return Result.fail(commerceError("unsupportedProfile"));
  const order = { ...supplied };
  if (Object.keys(order).some(key => !read.orderable.includes(key))) return Result.fail(commerceError("unsupportedProfile"));
  // The physical reader appends every remaining primary-key component as an
  // ascending tie-breaker. Do not pretend the leading component is unique.
  if (!Object.keys(order).some(key => read.uniqueOrder.includes(key)) && !Object.hasOwn(order, identity)) order[identity] = "ASC";
  if (!read.multipleOrder && Object.keys(order).length !== 1) return Result.fail(commerceError("unsupportedProfile"));
  return Result.succeed(order);
}

function planQuery(input: unknown, entries: ReadonlyMap<string, GraphReadSelection>) {
  return Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, commerceLimits.commandBytes, commerceError);
    const args = yield* decodeInput(captured.value);
    const entry = entries.get(args.entity);
    if (entry === undefined || entry.read.result === "list") return yield* Result.fail(commerceError("unsupportedProfile"));
    if (!nativeFilters(args.filters ?? {}, entry.read.allowOrFilters === true)) return yield* Result.fail(commerceError("unsupportedProfile"));
    yield* planGraphFields(entry.read, args.fields);
    return { entry, args, order: yield* graphOrder(entry.read, args.pagination.order) };
  });
}

/** Capture trusted module metadata once. Scope/installation/command authority
 * remains with core; this registry only restricts graph dispatch and projection. */
export function prepareLocalGraph(participants: readonly GraphParticipant[]): Result.Result<PreparedLocalGraph, CommerceTransactionError> {
  return Result.gen(function* () {
    const entries = new Map<string, GraphReadSelection>();
    const services = new Map<string, GraphReadSelection>();
    const allModels = new Map<string, GraphReadSelection[]>();
    const capturedParticipants: GraphParticipant[] = [];
    for (const { participant, module } of participants) {
      const models = new Map<string, GraphReadDefinition>();
      for (const input of module.reads) {
        if (!input.model.trim() || models.has(input.model) || !isGraphReadCommand(input.command)
          || input.result !== undefined && input.result !== "count" && input.result !== "list"
          || input.allowOrFilters !== undefined && input.allowOrFilters !== true
          || input.nativeFields !== undefined && input.nativeFields !== true
          || input.optionalFields !== undefined && (input.nativeFields !== true || input.optionalFields.length > 16 ||
            new Set(input.optionalFields).size !== input.optionalFields.length || input.optionalFields.some(field =>
              !/^[a-z][a-z0-9_]*$/.test(field) || input.table.columns.includes(field)))
          || input.table.primaryKeys.length === 0 || input.table.primaryKeys.length > 16
          || new Set(input.table.primaryKeys).size !== input.table.primaryKeys.length) return yield* Result.fail(commerceError("unsupportedProfile"));
        // Reuse the read catalog's owned metadata snapshots; its relation map is
        // unnecessary here because services retain population responsibility.
        const tables = new Map([input.table, ...input.paths.map(path => path.table)].map(table => [table.name, table]));
        const catalog = yield* makeReadCatalog([...tables.values()], new Map());
        const presentation = input.presentation === undefined ? undefined : yield* captureGraphPresentation(input.presentation, input.table);
        const computedObjects = input.computedObjects === undefined ? undefined : yield* captureGraphComputedObjects(input.computedObjects);
        if (computedObjects !== undefined && Object.keys(computedObjects).some(name => input.table.columns.includes(name) ||
          presentation?.columns.includes(name) || input.paths.some(path => path.path === name)))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        const paths = [];
        const names = new Set<string>();
        for (const relation of input.paths) {
          if (names.has(relation.path) || relation.path.split(".").some(part => !/^[a-z][a-z0-9_]*$/.test(part)) ||
            relation.nativeFields !== undefined && relation.nativeFields !== true ||
            relation.optionalFields !== undefined && (input.nativeFields !== true || relation.optionalFields.length > 16 ||
              new Set(relation.optionalFields).size !== relation.optionalFields.length || relation.optionalFields.some(field =>
                !/^[a-z][a-z0-9_]*$/.test(field) || graphSelectableColumns(relation).includes(field) ||
                Object.hasOwn(relation.computedObjects ?? {}, field)))) return yield* Result.fail(commerceError("unsupportedProfile"));
          names.add(relation.path);
          const presentation = relation.presentation === undefined ? undefined : yield* captureGraphPresentation(relation.presentation, relation.table);
          const computedObjects = relation.computedObjects === undefined ? undefined : yield* captureGraphComputedObjects(relation.computedObjects);
          const outputObject = relation.outputObject === undefined ? undefined : (yield* captureGraphComputedObjects({ output: relation.outputObject })).output;
          paths.push(Object.freeze({ ...relation, table: yield* catalog.table(relation.table.name),
            ...(computedObjects === undefined ? {} : { computedObjects }), ...(outputObject === undefined ? {} : { outputObject }),
            ...(presentation === undefined ? {} : { presentation }),
            ...(relation.optionalFields === undefined ? {} : { optionalFields: Object.freeze([...relation.optionalFields]) }),
            ...(relation.targetFields === undefined ? {} : { targetFields: Object.freeze([...relation.targetFields]) }),
            ...(relation.sourceFields === undefined ? {} : { sourceFields: Object.freeze([...relation.sourceFields]) }) }));
        }
        if ([...names].some(path => path.includes(".") && !names.has(path.slice(0, path.lastIndexOf("."))))) return yield* Result.fail(commerceError("unsupportedProfile"));
        for (const relation of paths) if (relation.sourceFields !== undefined) {
          const dot = relation.path.lastIndexOf(".");
          const parent = dot === -1 ? input.table : paths.find(candidate => candidate.path === relation.path.slice(0, dot))?.table;
          if (parent === undefined || relation.sourceFields.length === 0 || relation.sourceFields.length > 16 ||
            new Set(relation.sourceFields).size !== relation.sourceFields.length ||
            relation.sourceFields.some(column => !parent.columns.includes(column) || !parent.foreignKeys.includes(column) && !parent.primaryKeys.includes(column)))
            return yield* Result.fail(commerceError("unsupportedProfile"));
        }
        for (const relation of paths) if (relation.targetFields !== undefined &&
          (relation.targetFields.length === 0 || relation.targetFields.length > 16 ||
            new Set(relation.targetFields).size !== relation.targetFields.length ||
            relation.targetFields.some(column => !relation.table.columns.includes(column) ||
              !relation.table.primaryKeys.includes(column) && !relation.table.foreignKeys.includes(column))))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        const table = yield* catalog.table(input.table.name);
        const identity = table.primaryKeys[0];
        if (identity === undefined || !input.orderable.includes(identity)
          || (table.primaryKeys.length === 1 && !input.uniqueOrder.includes(identity))
          || input.orderable.some(field => !table.columns.includes(field)) || input.uniqueOrder.some(field => !input.orderable.includes(field))) return yield* Result.fail(commerceError("unsupportedProfile"));
        const read = Object.freeze({ ...input, table, paths: Object.freeze(paths),
          ...(computedObjects === undefined ? {} : { computedObjects }),
          ...(presentation === undefined ? {} : { presentation }),
          ...(input.optionalFields === undefined ? {} : { optionalFields: Object.freeze([...input.optionalFields]) }),
          orderable: Object.freeze([...input.orderable]), uniqueOrder: Object.freeze([...input.uniqueOrder]) });
        models.set(read.model, read);
        const existing = allModels.get(read.model) ?? [];
        existing.push({ participant, read }); allModels.set(read.model, existing);
      }
      const selected = new Set<string>();
      for (const alias of module.aliases) {
        const read = models.get(alias.model);
        if (read === undefined) continue;
        if (!/^[a-z][a-z0-9_]*$/.test(alias.name) || entries.has(alias.name)) return yield* Result.fail(commerceError("unsupportedProfile"));
        entries.set(alias.name, { participant, read });
        selected.add(alias.model);
      }
      for (const service of module.services ?? []) {
        const read = models.get(service.model);
        if (read === undefined || !/^[A-Za-z][A-Za-z0-9_]{0,255}$/.test(service.name) || services.has(service.name))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        services.set(service.name, { participant, read });
      }
      if (selected.size !== models.size) return yield* Result.fail(commerceError("unsupportedProfile"));
      capturedParticipants.push({ participant, module: { ...module, reads: Object.freeze([...models.values()]) } });
    }
    if (entries.size === 0) return yield* Result.fail(commerceError("unsupportedProfile"));
    const remotePaths = yield* prepareGraphRemotePaths(participants, allModels);
    const linkEndpoints = yield* prepareGraphLinkEndpoints(participants, allModels);
    const directPaths = yield* prepareGraphDirectPaths(participants, allModels);
    yield* validateGraphPathPrefixes(remotePaths, directPaths, allModels);
    for (const catalog of [entries, services]) for (const [alias, entry] of catalog) {
      const paths = remotePaths.get(entry.read.model);
      const endpoints = linkEndpoints.get(entry.read.model);
      const direct = directPaths.get(entry.read.model);
      if (paths === undefined && endpoints === undefined && direct === undefined) continue;
      if ([...endpoints?.keys() ?? []].some(path => paths?.has(path) || direct?.has(path))) return yield* Result.fail(commerceError("unsupportedProfile"));
      const nativePrefixes = [...paths?.keys() ?? [], ...direct?.keys() ?? []];
      const expanded: GraphRelationPath[] = [
        ...entry.read.paths.map(path => entry.read.nativeFields === true && !path.many && nativePrefixes.some(prefix => prefix.startsWith(path.path + "."))
          ? Object.freeze({ ...path, nativeFields: true as const }) : path),
        ...[...paths?.values() ?? []].map(path => Object.freeze({ path: path.path,
          table: path.target.read.paths.find(local => local.path === path.targetSuffix)?.table ?? path.target.read.table,
          ...(path.target.read.presentation === undefined ? {} : { presentation: path.target.read.presentation }),
          ...(path.target.read.computedObjects === undefined ? {} : { computedObjects: path.target.read.computedObjects }),
          ...(path.targetSuffix === undefined || path.target.read.computedObjects?.[path.targetSuffix] === undefined ? {}
            : { outputObject: path.target.read.computedObjects[path.targetSuffix] }),
          many: path.outputMany ?? path.many !== false, optional: path.many === false, nativeFields: true as const, sourceFields: Object.freeze([path.sourceKey]) })),
        ...[...direct?.values() ?? []].map(path => Object.freeze({ path: path.path, table: path.target.read.table,
          ...(path.target.read.presentation === undefined ? {} : { presentation: path.target.read.presentation }),
          many: path.many, optional: !path.many, ...(path.nativeFields === true ? { nativeFields: true as const } : {}),
          sourceFields: Object.freeze([path.sourceKey]), targetFields: Object.freeze([path.targetKey]) })),
        ...[...endpoints?.values() ?? []].map(endpoint =>
          Object.freeze({ path: endpoint.path, table: endpoint.target.read.table, many: false, sourceFields: Object.freeze([endpoint.sourceKey]),
            ...(endpoint.target.read.presentation === undefined ? {} : { presentation: endpoint.target.read.presentation }) }),
        ),
      ];
      const edges = [...paths?.values() ?? [], ...direct?.values() ?? [], ...endpoints?.values() ?? []];
      const declared = new Set(expanded.map(path => path.path));
      for (const edge of edges) for (const local of edge.target.read.paths) {
        const suffix = "targetSuffix" in edge && typeof edge.targetSuffix === "string" ? edge.targetSuffix : undefined;
        if (suffix !== undefined && !local.path.startsWith(suffix + ".")) continue;
        const path = edge.path + "." + (suffix === undefined ? local.path : local.path.slice(suffix.length + 1));
        // A deeper explicit edge owns its target and descendants. Copy only
        // the selected target's original local metadata, never recursively
        // expanded metadata or a competing parent's relation definition.
        if (declared.has(path) || edges.some(other => other !== edge && other.path.startsWith(edge.path + ".") &&
          (path === other.path || path.startsWith(other.path + ".")))) continue;
        expanded.push(Object.freeze({ ...local, path,
          ...(edge.target.read.nativeFields === true && !local.many && nativePrefixes.some(prefix => prefix.startsWith(path + "."))
            ? { nativeFields: true as const } : {}) }));
        declared.add(path);
      }
      catalog.set(alias, { ...entry, read: Object.freeze({ ...entry.read, paths: Object.freeze(expanded) }) });
    }
    const nativeRegistry = yield* prepareNativeReadRegistry(capturedParticipants);
    const decodePage = commerceDecoder(Schema.Struct({ data: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(commerceLimits.catalogRows)),
      metadata: Schema.Struct({ count: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows })),
        skip: QueryOffset, take: QueryLimit }) }), "storedCorruption");
    return Object.freeze({ entities: Object.freeze([...entries.keys()]),
      admitProjection: (entity: string, fields: readonly string[]) =>
        planQuery({ entity, fields, pagination: { take: 1 } }, entries).pipe(Result.map(() => undefined)),
      bind: (context): LocalGraphQuery => {
      const native = Effect.fn("LocalGraph.nativeQuery")(function* (method: "query" | "graph", input: unknown, options?: unknown) {
        const registry = nativeRegistry;
        const inspected = yield* checkedCommerceValue(context, () => prepareNativeGraphInput(input, registry.metadata, (name, service, fields) => {
          const root = (service ? services : entries).get(name);
          return root === undefined ? Result.fail(commerceError("unsupportedProfile"))
            : fields === undefined ? Result.succeed(undefined) : planGraphFields(root.read, fields);
        }));
        const entry = (inspected.service ? services : entries).get(inspected.entity);
        if (entry === undefined || method === "graph" && !("entity" in inspected.value))
          return yield* context.refuse(commerceError("unsupportedProfile"));
        yield* checkedCommerceValue(context, () => planGraphFields(entry.read, inspected.fields));
        if (options !== undefined) yield* checkedCommerceValue(context, () => admitNativeQueryPaths(options).pipe(Result.flatMap(decodeNativeGraphOptions)));
        const cohorts = yield* checkedCommerceValue(context, () => prepareNativeCohorts({ root: entry, fields: inspected.fields,
          remote: remotePaths.get(entry.read.model) ?? new Map(), direct: directPaths.get(entry.read.model) ?? new Map(),
          endpoints: linkEndpoints.get(entry.read.model) ?? new Map() }));
        const bridge = makeNativeQueryBridge({ ...registry.metadata, read: registry.bind(context, cohorts.observe), recordFailure: context.recordFailure });
        return yield* (method === "query" ? bridge.query(inspected.value, options) : bridge.graph(inspected.value, options));
      });
      const graph = Effect.fn("LocalGraph.graph")(function* (input: unknown, options?: unknown) {
        const { args, order } = yield* checkedCommerceValue(context, () => planQuery(input, entries));
        const result = yield* native("graph", { ...args, pagination: { ...args.pagination, skip: args.pagination.skip ?? 0, order } }, options);
        return yield* checkedCommerceValue(context, () => captureCommerceInput(result).pipe(Result.flatMap(decodePage)));
      });
      return Object.freeze({ graph,
        remoteQuery: (input: unknown, options?: unknown) => native("query", input, options),
        nativeGraph: (input: unknown, options?: unknown) => native("graph", input, options),
      });
    } } satisfies PreparedLocalGraph);
  });
}
