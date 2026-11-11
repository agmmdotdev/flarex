import { Result, Schema } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { commerceDecoder } from "../value/decoder";
import type { GraphRemotePath } from "./links";

const Path = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,15}$/));
export const GraphQueryContexts = Schema.Record(Path, Schema.JsonObject).check(Schema.makeFilter(value => Object.keys(value).length <= 16));
export type GraphQueryContexts = typeof GraphQueryContexts.Type;
export const decodeGraphQueryContexts = commerceDecoder(GraphQueryContexts, "unsupportedProfile");

/** Native QueryContext tags are lowered by the native ABI before this seam.
 * Only authenticated selected forwarding edges can carry calculation data. */
export function prepareGraphContexts(context: GraphQueryContexts, fields: readonly string[], paths: ReadonlyMap<string, GraphRemotePath>) {
  return Result.gen(function* () {
    const merged = new Map<string, JsonObject>();
    const selected = (path: string) => fields.some(field => field === path || field.startsWith(path + "."));
    // The native planner accumulates declared forwarding targets across the
    // selected expansion plan before processing its synthetic alias expands.
    const forwarding = [...paths.values()].filter(edge => selected(edge.path) && edge.forwardArgumentsOnPath?.length === 1);
    for (const [path, value] of Object.entries(context)) {
      const edge = paths.get(path);
      if (edge === undefined || !selected(path))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      if (Object.keys(value).length === 0) continue;
      const canonical = edge.canonicalPath ?? edge.path, existing = merged.get(canonical);
      if (!forwarding.some(target => (target.canonicalPath ?? target.path) === canonical && target.root === edge.root &&
        target.sourceModel === edge.sourceModel && target.sourceKey === edge.sourceKey && target.linkModel === edge.linkModel &&
        target.sourceColumn === edge.sourceColumn && target.targetColumn === edge.targetColumn &&
        target.targetModel === edge.targetModel && target.targetKey === edge.targetKey))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      if (existing !== undefined && !jsonEqual(existing, value)) return yield* Result.fail(commerceError("unsupportedProfile"));
      merged.set(canonical, value);
    }
    return merged;
  });
}
