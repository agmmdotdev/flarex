import { Effect, Result, Schema } from "effect";
import { groupHasManyRows, groupManyToManyRows, tupleKey } from "@medusajs/drizzle/relation-query";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { checkedCommerceValue } from "../value/checked";
import type { ProjectionNode } from "../query/projection";
import type { GraphParticipant, GraphReadSelection, GraphRemotePath } from "./model";
import { decodeGraphRemotePaths } from "./links";
import { captureCommerceInput } from "../value/input";

export interface ResolvedGraphRemotePath extends GraphRemotePath {
  readonly source: GraphReadSelection;
  readonly link: GraphReadSelection;
  readonly target: GraphReadSelection;
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
        if (link.participant !== participant.participant ||
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
      const parent = dot === -1 ? root : paths.get(path.path.slice(0, dot))?.targetModel;
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
) {
  const complete = Effect.fn("LocalGraph.readCompleteRemote")(function* (
    selected: GraphReadSelection, filters: JsonObject, fields: readonly string[], maximum: number,
  ) {
    const column = selected.read.orderable[0];
    if (column === undefined) return yield* context.refuse(commerceError("unsupportedProfile"));
    const value = yield* context.call(selected.participant, selected.read.command, {
      filters, config: { select: fields, relations: [], order: { [column]: "ASC" }, skip: 0, take: maximum },
    });
    return yield* checkedCommerceValue(context, () => selected.read.decode(value).pipe(Result.flatMap(([found, count]) =>
      count > maximum ? Result.fail(commerceError("unsupportedProfile")) : found.length !== count
        ? Result.fail(commerceError("storedCorruption")) : Result.succeed(found))));
  });
  const visit = Effect.fn("LocalGraph.attachRemotePath")(function* (
    parents: readonly JsonObject[], projection: ProjectionNode, prefix: string,
  ): Effect.fn.Return<JsonObject[], CommerceTransactionError> {
    const result = parents.map(row => ({ ...row }));
    for (const child of projection.children) {
      const name = prefix + child.name, path = paths.get(name);
      if (path === undefined) continue; // Module-local relations stay service-owned.
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
