import { Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphParticipant, GraphReadSelection, GraphRemotePath } from "./model";
import { decodeGraphRemotePaths, decodeGraphLinkEndpoints, type GraphLinkEndpoint } from "./links";
import { captureCommerceInput } from "../value/input";
import type { ResolvedGraphDirectPath } from "./direct-paths";

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
        if (path.targetSuffix !== undefined && (path.canonicalPath === undefined || path.many !== false ||
          target.read.computedObjects?.[path.targetSuffix] === undefined && !target.read.paths.some(local => local.path === path.targetSuffix)))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        if (path.targetSuffix !== undefined && (target.read.computedObjects?.[path.targetSuffix] !== undefined
          ? path.outputMany !== false : target.read.paths.find(local => local.path === path.targetSuffix)?.many !== path.outputMany))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        const paths = byRoot.get(root.read.model) ?? new Map<string, ResolvedGraphRemotePath>();
        if (paths.has(path.path) || root.read.paths.some(local => local.path === path.path)) return yield* Result.fail(commerceError("unsupportedProfile"));
        paths.set(path.path, Object.freeze({ ...path, source, link, target }));
        byRoot.set(root.read.model, paths);
      }
    }
    return byRoot;
  });
}

/** Authenticate every prefix against the same complete module composition. */
export function validateGraphPathPrefixes(remote: ReadonlyMap<string, ReadonlyMap<string, ResolvedGraphRemotePath>>,
  direct: ReadonlyMap<string, ReadonlyMap<string, ResolvedGraphDirectPath>>, models: ReadonlyMap<string, readonly GraphReadSelection[]>) {
  return Result.gen(function* () {
    const roots = new Set([...remote.keys(), ...direct.keys()]);
    for (const root of roots) {
      const paths = new Map<string, ResolvedGraphRemotePath | ResolvedGraphDirectPath>([...remote.get(root) ?? [], ...direct.get(root) ?? []]);
      if (paths.size !== (remote.get(root)?.size ?? 0) + (direct.get(root)?.size ?? 0)) return yield* Result.fail(commerceError("unsupportedProfile"));
      const candidates = models.get(root), owner = candidates?.[0];
      if (candidates?.length !== 1 || owner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      for (const path of paths.values()) {
        const dot = path.path.lastIndexOf(".");
        const prefix = path.path.slice(0, dot);
        // A local suffix belongs to the nearest authenticated target read.
        // Prefix length strictly decreases; no new graph or relation loader is
        // inferred from names, and the genuine target keeps population ownership.
        const ancestor = [...paths.values()].filter(candidate => prefix.startsWith(candidate.path + "."))
          .sort((left, right) => right.path.length - left.path.length)[0];
        const localOwner = ancestor?.target ?? owner;
        const suffix = ancestor === undefined ? prefix : prefix.slice(ancestor.path.length + 1);
        const local = dot === -1 ? undefined : localOwner.read.paths.find(relation => relation.path === suffix);
        const parent = dot === -1 ? root : paths.get(prefix)?.targetModel ??
          (local !== undefined && local.table.name === path.source.read.table.name && path.source.participant === localOwner.participant
            && local.table.primaryKeys.length === 1 && local.table.primaryKeys[0] === path.source.read.table.primaryKeys[0]
            && local.table.columns.includes(path.sourceKey)
            && local.table.columns.every(column => path.source.read.table.columns.includes(column)) ? path.sourceModel : undefined);
        if (parent !== path.sourceModel) return yield* Result.fail(commerceError("unsupportedProfile", {
          root, path: path.path, sourceModel: path.sourceModel, prefix,
        }));
      }
    }
  });
}
