import { Result, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { mergeFieldAlias, selectFieldAlias, type JoinerFieldAliases } from "@medusajs/orchestration/joiner-field-alias";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";

const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Bound = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 }));
export const GraphLinkEndpointSchema = Schema.Struct({ root: Name, path: Name, sourceKey: Name, targetModel: Name, targetKey: Name,
  maximumSources: Bound, maximumTargets: Bound });
export type GraphLinkEndpoint = typeof GraphLinkEndpointSchema.Type;
export const decodeGraphLinkEndpoints = commerceDecoder(Schema.Array(GraphLinkEndpointSchema).check(Schema.isMaxLength(16)), "unsupportedProfile");
export const GraphRemotePathSelectionSchema = Schema.Struct({
  root: Name, path: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,15}$/)),
  maximumSources: Bound, maximumLinks: Bound, maximumTargets: Bound, maximumPerSource: Bound,
});
export const GraphRemotePathSchema = Schema.Struct({ ...GraphRemotePathSelectionSchema.fields,
  sourceModel: Name, sourceKey: Name, linkModel: Name, sourceColumn: Name,
  targetColumn: Name, targetModel: Name, targetKey: Name,
  many: Schema.optionalKey(Schema.Literal(false)),
});
/** Native Link metadata selects read-only paths with explicit complete-set bounds. */
export type GraphRemotePathSelection = typeof GraphRemotePathSelectionSchema.Type;
export type GraphRemotePath = typeof GraphRemotePathSchema.Type;
export const decodeGraphRemotePaths = commerceDecoder(Schema.Array(GraphRemotePathSchema).check(Schema.isMaxLength(16)), "unsupportedProfile");
const Rest = [Schema.Record(Schema.String, Schema.Json)] as const;
const Endpoint = Schema.StructWithRest(Schema.Struct({ serviceName: Schema.String, entity: Name,
  primaryKey: Name, foreignKey: Name, alias: Name }), Rest);
const Extension = Schema.StructWithRest(Schema.Struct({ entity: Schema.optionalKey(Name), serviceName: Schema.String,
  fieldAlias: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.String,
    Schema.StructWithRest(Schema.Struct({ path: Schema.String, isList: Schema.optionalKey(Schema.Boolean) }), Rest)]))),
  relationship: Schema.StructWithRest(Schema.Struct({ primaryKey: Name, foreignKey: Name, alias: Name, isList: Schema.optionalKey(Schema.Boolean) }), Rest),
}), Rest);
const decodeJoinerSchema = Schema.StructWithRest(Schema.Struct({ isLink: Schema.Literal(true), serviceName: Name,
  alias: Schema.Array(Schema.StructWithRest(Schema.Struct({ entity: Name }), Rest)),
  relationships: Schema.Array(Endpoint), extends: Schema.Array(Extension),
}), Rest);
const decodeJoiner = commerceDecoder(decodeJoinerSchema, "unsupportedProfile");
const decodeConfiguredLinks = commerceDecoder(Schema.Array(decodeJoinerSchema).check(Schema.isLengthBetween(1, 16)), "unsupportedProfile");
const decodeName = commerceDecoder(Name, "unsupportedProfile");
const decodeSelections = commerceDecoder(Schema.Array(GraphRemotePathSelectionSchema).check(Schema.isMaxLength(16)), "unsupportedProfile");
const decodeEndpointSelections = commerceDecoder(Schema.Array(Schema.Struct({
  path: Name, maximumSources: Bound, maximumTargets: Bound,
})).check(Schema.isMaxLength(16)), "unsupportedProfile");

/** Link-root Query traverses the native relationship directly to one endpoint.
 * Endpoint keys and cardinality come from the same checked joiner definition. */
export function nativeLinkGraphEndpoints(joiner: ModuleJoinerConfig,
  selections: readonly { readonly path: string; readonly maximumSources: number; readonly maximumTargets: number }[]) {
  return Result.gen(function* () {
    const native = yield* captureCommerceInput(joiner).pipe(Result.flatMap(decodeJoiner));
    const selected = yield* captureCommerceInput(selections).pipe(Result.flatMap(decodeEndpointSelections));
    const models = new Set(native.alias.map(alias => alias.entity)), root = [...models][0];
    if (models.size !== 1 || root === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const paths: GraphLinkEndpoint[] = [];
    for (const selection of selected) {
      const relationships = native.relationships.filter(relationship => relationship.alias === selection.path), endpoint = relationships[0];
      if (relationships.length !== 1 || endpoint === undefined || paths.some(path => path.path === selection.path))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      paths.push({ ...selection, root, sourceKey: endpoint.foreignKey, targetModel: endpoint.entity, targetKey: endpoint.primaryKey });
    }
    return paths;
  });
}

/** Resolve the pinned Link's extends/fieldAlias/relationship chain. Business
 * owners select finite paths and bounds; they do not restate endpoint keys. */
export function nativeLinkGraphPaths(joiner: ModuleJoinerConfig, selections: readonly GraphRemotePathSelection[], sourceModel?: string,
  configuredLinks: readonly ModuleJoinerConfig[] = [joiner]) {
  return Result.gen(function* () {
    const native = yield* captureCommerceInput(joiner).pipe(Result.flatMap(decodeJoiner));
    const configured = yield* captureCommerceInput(configuredLinks).pipe(Result.flatMap(decodeConfiguredLinks));
    const selected = yield* captureCommerceInput(selections).pipe(Result.flatMap(decodeSelections));
    const models = new Set(native.alias.map(alias => alias.entity));
    const linkModel = [...models][0];
    if (models.size !== 1 || linkModel === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const result: GraphRemotePath[] = [];
    for (const selection of selected) {
      let current = sourceModel === undefined ? selection.root : yield* decodeName(sourceModel);
      let resolved: Omit<GraphRemotePath, keyof GraphRemotePathSelection> | undefined;
      // A selected source resolves one suffix after a checked local/remote
      // prefix. The complete composition authenticates that prefix separately.
      for (const part of sourceModel === undefined ? selection.path.split(".") : selection.path.split(".").slice(-1)) {
        const sources = native.relationships.filter(relation => relation.entity === current);
        const source = sources[0];
        if (sources.length !== 1 || source === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        const aliases: JoinerFieldAliases = { fieldAlias: {} };
        yield* Result.try({ try: () => {
          for (const link of configured) for (const extension of link.extends)
            if (extension.serviceName === source.serviceName) mergeFieldAlias(aliases, extension);
        }, catch: cause => commerceError("unsupportedProfile", cause) });
        const supplied = aliases.fieldAlias[part];
        if (supplied === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        const alias = yield* Result.try({ try: () => selectFieldAlias(supplied, current, selection.path.split(".").slice(0, -1)),
          catch: cause => commerceError("unsupportedProfile", cause) });
        const pieces = alias.path.split(".");
        const extensions = native.extends.filter(extension => (extension.entity === undefined || extension.entity === current)
          && extension.serviceName === source.serviceName && extension.relationship.alias === pieces[0]);
        const extension = extensions[0];
        const targets = native.relationships.filter(relation => relation.alias === pieces?.[1]);
        const target = targets[0];
        if (pieces.length !== 2 || extensions.length !== 1 || extension === undefined || targets.length !== 1 || target === undefined ||
          source.foreignKey !== extension.relationship.primaryKey || source.primaryKey !== extension.relationship.foreignKey)
          return yield* Result.fail(commerceError("unsupportedProfile"));
        resolved = { sourceModel: current, sourceKey: source.primaryKey, linkModel,
          sourceColumn: source.foreignKey, targetColumn: target.foreignKey, targetModel: target.entity, targetKey: target.primaryKey,
          ...(alias.isList === true || extension.relationship.isList === true ? {} : { many: false as const }) };
        current = target.entity;
      }
      if (resolved === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      result.push(Object.freeze({ ...selection, ...resolved }));
    }
    return Object.freeze(result);
  });
}

/** Preserve the authentic generated Link service identity instead of inventing
 * an entity alias for the callable RemoteQuery service ABI. */
export function nativeLinkGraphServices(joiner: ModuleJoinerConfig) {
  return Result.gen(function* () {
    const native = yield* captureCommerceInput(joiner).pipe(Result.flatMap(decodeJoiner));
    const models = new Set(native.alias.map(alias => alias.entity));
    const model = [...models][0];
    if (models.size !== 1 || model === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return Object.freeze([Object.freeze({ name: native.serviceName, model })]);
  });
}
