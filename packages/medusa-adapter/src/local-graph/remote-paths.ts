import { Effect, Result, Schema } from "effect";
import { groupHasManyRows, groupManyToManyRows, tupleKey } from "@medusajs/drizzle/relation-query";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import type { ProjectionNode } from "../query/projection";
import type { GraphParticipant, GraphReadSelection, GraphRemotePath } from "./model";
import { decodeGraphRemotePaths, decodeGraphLinkEndpoints, type GraphLinkEndpoint } from "./links";
import { planGraphFields } from "./fields";
import { captureCommerceInput } from "../value/input";

export interface ResolvedGraphRemotePath extends GraphRemotePath {
  readonly source: GraphReadSelection;
  readonly link: GraphReadSelection;
  readonly target: GraphReadSelection;
}
export interface ResolvedGraphLinkEndpoint extends GraphLinkEndpoint { readonly target: GraphReadSelection }

/** Direct Link endpoints retain the declaring participant's row authority and
 * borrow only the selected endpoint's authentic read command. */
export function prepareGraphLinkEndpoints(participants: readonly GraphParticipant[], models: ReadonlyMap<string, readonly GraphReadSelection[]>) {
  return Result.gen(function* () {
    const roots = new Map<string, Map<string, ResolvedGraphLinkEndpoint>>();
    for (const participant of participants) {
      const definitions = yield* captureCommerceInput(participant.module.linkEndpoints ?? []).pipe(Result.flatMap(decodeGraphLinkEndpoints));
      for (const definition of definitions) {
        const sources = models.get(definition.root), targets = models.get(definition.targetModel), source = sources?.[0], target = targets?.[0];
        if (sources?.length !== 1 || source === undefined || source.participant !== participant.participant || targets?.length !== 1 || target === undefined ||
          source.read.result === "list" || target.read.result === "list" ||
          !source.read.table.columns.includes(definition.sourceKey) || target.read.table.primaryKeys.length !== 1 || target.read.table.primaryKeys[0] !== definition.targetKey ||
          source.read.paths.some(path => path.path === definition.path)) return yield* Result.fail(commerceError("unsupportedProfile"));
        const paths = roots.get(definition.root) ?? new Map<string, ResolvedGraphLinkEndpoint>();
        if (paths.has(definition.path)) return yield* Result.fail(commerceError("unsupportedProfile"));
        paths.set(definition.path, Object.freeze({ ...definition, target })); roots.set(definition.root, paths);
      }
    }
    return roots;
  });
}

function projectionFields(node: ProjectionNode, prefix = ""): string[] {
  return [...[...node.fields].map(field => prefix + field), ...node.children.flatMap(child => projectionFields(child.node, prefix + child.name + "."))];
}

/** Resolve a complete composition of authentic read commands. A module's Link
 * declarations can only traverse its own selected Link read capability. */
export function prepareGraphRemotePaths(participants: readonly GraphParticipant[], models: ReadonlyMap<string, readonly GraphReadSelection[]>) {
  return Result.gen(function* () {
    const byRoot = new Map<string, Map<string, ResolvedGraphRemotePath>>();
    const one = (model: string) => {
      const found = models.get(model);
      const entry = found?.[0];
      return found?.length === 1 && entry !== undefined ? Result.succeed(entry) : Result.fail(commerceError("unsupportedProfile"));
    };
    for (const participant of participants) {
      const selected = yield* captureCommerceInput(participant.module.remotePaths ?? []).pipe(Result.flatMap(decodeGraphRemotePaths));
      for (const path of selected) {
        const root = yield* one(path.root), source = yield* one(path.sourceModel), link = yield* one(path.linkModel), target = yield* one(path.targetModel);
        if ([root, source, link, target].some(entry => entry.read.result === "list") || link.participant !== participant.participant ||
          source.read.table.primaryKeys.length !== 1 || source.read.table.primaryKeys[0] !== path.sourceKey ||
          target.read.table.primaryKeys.length !== 1 || target.read.table.primaryKeys[0] !== path.targetKey ||
          !link.read.table.columns.includes(path.sourceColumn) || !link.read.table.columns.includes(path.targetColumn))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        const paths = byRoot.get(root.read.model) ?? new Map<string, ResolvedGraphRemotePath>();
        if (paths.has(path.path) || root.read.paths.some(local => local.path === path.path)) return yield* Result.fail(commerceError("unsupportedProfile"));
        paths.set(path.path, Object.freeze({ ...path, source, link, target }));
        byRoot.set(root.read.model, paths);
      }
    }
    for (const [root, paths] of byRoot) for (const path of paths.values()) {
      const dot = path.path.lastIndexOf(".");
      const prefix = path.path.slice(0, dot);
      const local = dot === -1 ? undefined : (yield* one(root)).read.paths.find(relation => relation.path === prefix);
      const parent = dot === -1 ? root : paths.get(prefix)?.targetModel ??
        (local !== undefined && local.table.name === path.source.read.table.name && path.source.participant === (yield* one(root)).participant
          && local.table.primaryKeys.length === 1 && local.table.primaryKeys[0] === path.sourceKey
          && local.table.columns.every(column => path.source.read.table.columns.includes(column)) ? path.sourceModel : undefined);
      if (parent !== path.sourceModel) return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    return byRoot;
  });
}

const decodeKey = commerceDecoder(Schema.String.check(Schema.isLengthBetween(1, 256)), "storedCorruption");
const keys = (rows: readonly JsonObject[], column: string) => Result.gen(function* () {
  const values: string[] = [];
  for (const row of rows) values.push(yield* decodeKey(row[column]));
  return [...new Set(values)];
});

/** Every Link and endpoint query is an existing authenticated participant call.
 * Counts prove complete selections; native grouping supplies attachment order. */
export const populateGraphRemotePaths = Effect.fn("LocalGraph.populateRemotePaths")(function* (
  context: AtomicCommerceContext, rows: readonly JsonObject[], node: ProjectionNode,
  paths: ReadonlyMap<string, ResolvedGraphRemotePath>,
  endpoints: ReadonlyMap<string, ResolvedGraphLinkEndpoint> = new Map(),
) {
  const complete = Effect.fn("LocalGraph.readCompleteRemote")(function* (
    selected: GraphReadSelection, filters: JsonObject, fields: readonly string[], maximum: number, relations: readonly string[] = [],
  ) {
    const read = selected.read, column = read.orderable[0];
    if (column === undefined || read.result === "list") return yield* context.refuse(commerceError("unsupportedProfile"));
    const value = yield* context.call(selected.participant, selected.read.command, {
      filters, config: { select: fields, relations, order: { [column]: "ASC" }, skip: 0, take: maximum },
    });
    return yield* checkedCommerceValue(context, () => read.decode(value).pipe(Result.flatMap(([found, count]) =>
      count > maximum ? Result.fail(commerceError("unsupportedProfile")) : found.length !== count
        ? Result.fail(commerceError("storedCorruption")) : Result.succeed(found))));
  });
  const visit = Effect.fn("LocalGraph.attachRemotePath")(function* (
    parents: readonly JsonObject[], projection: ProjectionNode, prefix: string,
  ): Effect.fn.Return<JsonObject[], CommerceTransactionError> {
    const result = parents.map(row => ({ ...row }));
    for (const child of projection.children) {
      const name = prefix + child.name, path = paths.get(name);
      const endpoint = endpoints.get(name);
      if (endpoint !== undefined) {
        if (parents.length > endpoint.maximumSources) return yield* context.refuse(commerceError("unsupportedProfile"));
        const selected = yield* checkedCommerceValue(context, () => keys(parents, endpoint.sourceKey));
        if (selected.length > endpoint.maximumTargets) return yield* context.refuse(commerceError("unsupportedProfile"));
        const plan = yield* checkedCommerceValue(context, () => planGraphFields(endpoint.target.read, projectionFields(child.node), true));
        const targets = selected.length === 0 ? [] : yield* complete(endpoint.target, { [endpoint.targetKey]: selected }, plan.select, endpoint.maximumTargets, plan.relations);
        const ids = yield* checkedCommerceValue(context, () => keys(targets, endpoint.targetKey));
        if (ids.length !== targets.length || ids.some(id => !selected.includes(id))) return yield* context.refuse(commerceError("storedCorruption"));
        const byId = new Map(targets.map(target => [target[endpoint.targetKey], target]));
        for (const parent of result) parent[child.name] = byId.get(parent[endpoint.sourceKey]) ?? null;
        continue;
      }
      if (path === undefined) {
        // Service-owned local hydration can prefix a stored Link. Collect the
        // complete cohort before recursion so per-edge limits cannot be reset
        // for each local parent or silently omit a sibling's endpoints.
        const local: JsonObject[] = [];
        const lengths: number[] = [];
        for (const parent of parents) {
          const value = parent[child.name];
          if (child.many) {
            if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* context.refuse(commerceError("storedCorruption"));
            lengths.push(value.length); local.push(...value);
          } else if (value === null || value === undefined && child.optional === true) lengths.push(0);
          else {
            if (value === undefined || !isJsonObject(value)) return yield* context.refuse(commerceError("storedCorruption"));
            lengths.push(1); local.push(value);
          }
        }
        const attached = yield* visit(local, child.node, name + ".");
        let offset = 0;
        for (let index = 0; index < result.length; index++) {
          const parent = result[index], length = lengths[index];
          if (parent === undefined || length === undefined) return yield* context.refuse(commerceError("storedCorruption"));
          if (child.many) parent[child.name] = attached.slice(offset, offset + length);
          else if (length === 1) {
            const value = attached[offset];
            if (value === undefined) return yield* context.refuse(commerceError("storedCorruption"));
            parent[child.name] = value;
          }
          offset += length;
        }
        continue;
      }
      if (parents.length > path.maximumSources) return yield* context.refuse(commerceError("unsupportedProfile"));
      const sourceIds = yield* checkedCommerceValue(context, () => keys(parents, path.sourceKey));
      if (sourceIds.length === 0) {
        for (const parent of result) parent[child.name] = [];
        continue;
      }
      const links = yield* complete(path.link, { [path.sourceColumn]: sourceIds }, [path.sourceColumn, path.targetColumn], path.maximumLinks);
      const linkedSources = yield* checkedCommerceValue(context, () => keys(links, path.sourceColumn));
      if (linkedSources.some(id => !sourceIds.includes(id))) return yield* context.refuse(commerceError("storedCorruption"));
      for (const group of groupHasManyRows(links, [path.sourceColumn]).values())
        if (group.length > path.maximumPerSource) return yield* context.refuse(commerceError("unsupportedProfile"));
      const targetIds = yield* checkedCommerceValue(context, () => keys(links, path.targetColumn));
      if (targetIds.length > path.maximumTargets) return yield* context.refuse(commerceError("unsupportedProfile"));
      const selected = new Set([...child.node.fields, path.targetKey]);
      for (const descendant of child.node.children) {
        const edge = paths.get(name + "." + descendant.name);
        if (edge !== undefined) selected.add(edge.sourceKey);
      }
      const targets = targetIds.length === 0 ? [] : yield* complete(path.target, { [path.targetKey]: targetIds }, [...selected], path.maximumTargets);
      const returnedIds = yield* checkedCommerceValue(context, () => keys(targets, path.targetKey));
      if (returnedIds.length !== targets.length || returnedIds.some(id => !targetIds.includes(id)))
        return yield* context.refuse(commerceError("storedCorruption"));
      const nested = yield* visit(targets, child.node, name + ".");
      const grouped = groupManyToManyRows(nested, links, [path.targetKey], [path.sourceColumn], [path.targetColumn]);
      for (const parent of result) parent[child.name] = grouped.get(tupleKey(parent, [path.sourceKey])) ?? [];
    }
    return result;
  });
  return yield* visit(rows, node, "");
});
