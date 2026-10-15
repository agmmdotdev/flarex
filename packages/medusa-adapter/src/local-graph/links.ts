import { Result, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";

const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Bound = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 }));
export const GraphRemotePathSelectionSchema = Schema.Struct({
  root: Name, path: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/)),
  maximumSources: Bound, maximumLinks: Bound, maximumTargets: Bound, maximumPerSource: Bound,
});
export const GraphRemotePathSchema = Schema.Struct({ ...GraphRemotePathSelectionSchema.fields,
  sourceModel: Name, sourceKey: Name, linkModel: Name, sourceColumn: Name,
  targetColumn: Name, targetModel: Name, targetKey: Name,
});
/** Native Link metadata selects read-only paths with explicit complete-set bounds. */
export type GraphRemotePathSelection = typeof GraphRemotePathSelectionSchema.Type;
export type GraphRemotePath = typeof GraphRemotePathSchema.Type;
export const decodeGraphRemotePaths = commerceDecoder(Schema.Array(GraphRemotePathSchema).check(Schema.isMaxLength(16)), "unsupportedProfile");
const Rest = [Schema.Record(Schema.String, Schema.Json)] as const;
const Endpoint = Schema.StructWithRest(Schema.Struct({ serviceName: Schema.String, entity: Name,
  primaryKey: Name, foreignKey: Name, alias: Name }), Rest);
const Extension = Schema.StructWithRest(Schema.Struct({ entity: Name, serviceName: Schema.String,
  fieldAlias: Schema.Record(Schema.String, Schema.Union([Schema.String,
    Schema.StructWithRest(Schema.Struct({ path: Schema.String, isList: Schema.optionalKey(Schema.Boolean) }), Rest)])),
  relationship: Schema.StructWithRest(Schema.Struct({ primaryKey: Name, foreignKey: Name, alias: Name, isList: Schema.Literal(true) }), Rest),
}), Rest);
const decodeJoiner = commerceDecoder(Schema.StructWithRest(Schema.Struct({ isLink: Schema.Literal(true),
  alias: Schema.Array(Schema.StructWithRest(Schema.Struct({ entity: Name }), Rest)),
  relationships: Schema.Array(Endpoint), extends: Schema.Array(Extension),
}), Rest), "unsupportedProfile");
const decodeSelections = commerceDecoder(Schema.Array(GraphRemotePathSelectionSchema).check(Schema.isMaxLength(16)), "unsupportedProfile");

/** Resolve the pinned Link's extends/fieldAlias/relationship chain. Business
 * owners select finite paths and bounds; they do not restate endpoint keys. */
export function nativeLinkGraphPaths(joiner: ModuleJoinerConfig, selections: readonly GraphRemotePathSelection[]) {
  return Result.gen(function* () {
    const native = yield* captureCommerceInput(joiner).pipe(Result.flatMap(decodeJoiner));
    const selected = yield* captureCommerceInput(selections).pipe(Result.flatMap(decodeSelections));
    const models = new Set(native.alias.map(alias => alias.entity));
    const linkModel = [...models][0];
    if (models.size !== 1 || linkModel === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const result: GraphRemotePath[] = [];
    for (const selection of selected) {
      let current = selection.root;
      let resolved: Omit<GraphRemotePath, keyof GraphRemotePathSelection> | undefined;
      for (const part of selection.path.split(".")) {
        const extensions = native.extends.filter(extension => extension.entity === current && Object.hasOwn(extension.fieldAlias, part));
        const extension = extensions[0];
        if (extensions.length !== 1 || extension === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        const alias = extension.fieldAlias[part];
        const path = typeof alias === "string" ? alias : alias?.path;
        const pieces = path?.split(".");
        const sources = native.relationships.filter(relation => relation.entity === current && relation.serviceName === extension.serviceName);
        const targets = native.relationships.filter(relation => relation.alias === pieces?.[1]);
        const source = sources[0], target = targets[0];
        if (pieces?.length !== 2 || pieces[0] !== extension.relationship.alias || sources.length !== 1 || targets.length !== 1 || source === undefined || target === undefined ||
          source.foreignKey !== extension.relationship.primaryKey || source.primaryKey !== extension.relationship.foreignKey)
          return yield* Result.fail(commerceError("unsupportedProfile"));
        resolved = { sourceModel: current, sourceKey: source.primaryKey, linkModel,
          sourceColumn: source.foreignKey, targetColumn: target.foreignKey, targetModel: target.entity, targetKey: target.primaryKey };
        current = target.entity;
      }
      if (resolved === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      result.push(Object.freeze({ ...selection, ...resolved }));
    }
    return Object.freeze(result);
  });
}
