import { Option, Result, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../value/input";
import { commerceDecoder } from "../value/decoder";
import type { ReadCatalog } from "../query/catalog";
import type { GraphParticipant, GraphReadSelection } from "./model";

const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_]*$/));
const Path = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,15}$/));
const Bound = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 128 }));
const Selection = Schema.Struct({ root: Name, path: Path, maximumSources: Bound, maximumTargets: Bound, maximumPerSource: Bound });
export type GraphDirectPathSelection = typeof Selection.Type;
export const GraphDirectPathSchema = Schema.Struct({ ...Selection.fields,
  sourceModel: Name, sourceKey: Name, targetModel: Name, targetKey: Name, many: Schema.Boolean,
  /** Cross-module native joins retain endpoint identities. Local has-many
   * hydration masks its storage-only foreign key. */
  nativeFields: Schema.optionalKey(Schema.Literal(true)),
});
export type GraphDirectPath = typeof GraphDirectPathSchema.Type;
export const decodeGraphDirectPaths = commerceDecoder(Schema.Array(GraphDirectPathSchema).check(Schema.isMaxLength(16)), "unsupportedProfile");
const decodeSelections = commerceDecoder(Schema.Array(Selection).check(Schema.isMaxLength(16)), "unsupportedProfile");
const Rest = [Schema.Record(Schema.String, Schema.Json)] as const;
const Relationship = Schema.StructWithRest(Schema.Struct({ entity: Schema.optionalKey(Name), primaryKey: Name,
  foreignKey: Name, alias: Name, isList: Schema.optionalKey(Schema.Boolean) }), Rest);
const decodeJoiner = commerceDecoder(Schema.StructWithRest(Schema.Struct({ isLink: Schema.Literal(true),
  isReadOnlyLink: Schema.optionalKey(Schema.Boolean),
  alias: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ entity: Name }), Rest))),
  relationships: Schema.optionalKey(Schema.Array(Relationship)),
  extends: Schema.Array(Schema.StructWithRest(Schema.Struct({ entity: Schema.optionalKey(Name), relationship: Relationship }), Rest)),
}), Rest), "unsupportedProfile");

/** Direct native relationships include rich Link rows and the read-only Level
 * extension. They borrow actual source/target commands, never a fake Link. */
export function nativeLinkGraphDirectPaths(joiner: ModuleJoinerConfig, selections: readonly GraphDirectPathSelection[], sourceModel: string) {
  return Result.gen(function* () {
    const native = yield* captureCommerceInput(joiner).pipe(Result.flatMap(decodeJoiner));
    const selected = yield* captureCommerceInput(selections).pipe(Result.flatMap(decodeSelections));
    const result: GraphDirectPath[] = [];
    const linkModels = new Set(native.alias?.map(alias => alias.entity));
    for (const selection of selected) {
      const part = selection.path.split(".").at(-1);
      if (native.isReadOnlyLink === true) {
        const candidates = native.extends.filter(extension => extension.entity === sourceModel && extension.relationship.alias === part);
        const relation = candidates[0]?.relationship;
        if (candidates.length !== 1 || relation?.entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        result.push({ ...selection, sourceModel, sourceKey: relation.foreignKey, targetModel: relation.entity,
          targetKey: relation.primaryKey, many: relation.isList === true, nativeFields: true });
        continue;
      }
      const linkModel = [...linkModels][0];
      if (linkModels.size !== 1 || linkModel === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (sourceModel === linkModel) {
        const candidates = native.relationships?.filter(relation => relation.alias === part), relation = candidates?.[0];
        if (candidates?.length !== 1 || relation?.entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        result.push({ ...selection, sourceModel, sourceKey: relation.foreignKey, targetModel: relation.entity,
          targetKey: relation.primaryKey, many: relation.isList === true, nativeFields: true });
      } else {
        const candidates = native.extends.filter(extension => extension.entity === sourceModel && extension.relationship.alias === part);
        const relation = candidates[0]?.relationship;
        const endpoints = native.relationships?.filter(endpoint => endpoint.entity === sourceModel), endpoint = endpoints?.[0];
        if (candidates.length !== 1 || relation === undefined || endpoints?.length !== 1 || endpoint === undefined ||
          relation.primaryKey !== endpoint.foreignKey || relation.foreignKey !== endpoint.primaryKey)
          return yield* Result.fail(commerceError("unsupportedProfile"));
        result.push({ ...selection, sourceModel, sourceKey: endpoint.primaryKey, targetModel: linkModel,
          targetKey: endpoint.foreignKey, many: relation.isList === true, nativeFields: true });
      }
    }
    return result;
  });
}

/** Module-local relationships are derived from the existing checked DML
 * catalog; they need no new stored Link or duplicate population algorithm. */
export function localGraphDirectPath(catalog: ReadCatalog, sourceTable: string, sourceModel: string, targetModel: string,
  relationName: string, selection: GraphDirectPathSelection) {
  return Result.gen(function* () {
    const relation = yield* catalog.relation(sourceTable, relationName).pipe(Option.match({
      onNone: () => Result.fail(commerceError("unsupportedProfile")), onSome: Result.succeed,
    }));
    if (relation.join.type !== "hasMany") return yield* Result.fail(commerceError("unsupportedProfile"));
    const sourceKey = relation.sourcePrimaryKeys[0], targetKey = relation.join.foreignKeys[0];
    if (relation.sourcePrimaryKeys.length !== 1 || relation.join.foreignKeys.length !== 1 || sourceKey === undefined || targetKey === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* captureCommerceInput({ ...selection, sourceModel, sourceKey, targetModel, targetKey, many: true })
      .pipe(Result.flatMap(commerceDecoder(GraphDirectPathSchema, "unsupportedProfile")));
  });
}

export interface ResolvedGraphDirectPath extends GraphDirectPath {
  readonly source: GraphReadSelection;
  readonly target: GraphReadSelection;
}

export function prepareGraphDirectPaths(participants: readonly GraphParticipant[], models: ReadonlyMap<string, readonly GraphReadSelection[]>) {
  return Result.gen(function* () {
    const roots = new Map<string, Map<string, ResolvedGraphDirectPath>>();
    for (const participant of participants) {
      const selected = yield* captureCommerceInput(participant.module.directPaths ?? []).pipe(Result.flatMap(decodeGraphDirectPaths));
      for (const path of selected) {
        const sources = models.get(path.sourceModel), targets = models.get(path.targetModel), rootsForModel = models.get(path.root);
        const source = sources?.[0], target = targets?.[0], root = rootsForModel?.[0];
        if (sources?.length !== 1 || targets?.length !== 1 || rootsForModel?.length !== 1 || source === undefined || target === undefined || root === undefined ||
          source.read.result === "list" || target.read.result === "list" || root.read.result === "list" ||
          source.participant !== participant.participant && target.participant !== participant.participant ||
          !source.read.table.columns.includes(path.sourceKey) || !target.read.table.columns.includes(path.targetKey))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        const paths = roots.get(path.root) ?? new Map<string, ResolvedGraphDirectPath>();
        if (paths.has(path.path) || root.read.paths.some(local => local.path === path.path)) return yield* Result.fail(commerceError("unsupportedProfile"));
        paths.set(path.path, Object.freeze({ ...path, source, target })); roots.set(path.root, paths);
      }
    }
    return roots;
  });
}
