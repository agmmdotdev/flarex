import { Result } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceRelation } from "../../query/relations";
import type { GraphCatalog, GraphEntity, ReplacementProfile } from "../../write/graph-model";
import type { compileStoreCreationContracts } from "./create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileStoreCreationContracts>>;

/** Checked Store topology is shared; each operation supplies its own admitted
 * row decoder and replacement authority. This exposes no persistence handle. */
export function prepareStoreGraph(contracts: Contracts, decodeRow: GraphCatalog["decodeRow"]) {
  return Result.gen(function* () {
    const { lifecycle } = contracts, entities: GraphEntity[] = [];
    for (const entity of lifecycle.entities) {
      const primary = entity.table.columns.filter(column => column.primaryKey);
      if (primary.length !== 1 || primary[0]?.name !== "id" || primary[0].type !== "id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      entities.push({ table: entity.table, model: entity.model, keyColumn: "id", prefix: primary[0].options?.prefix });
    }
    const store = entities.find(entity => entity.table === lifecycle.store);
    if (store === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map<string, CommerceRelation>();
    for (const name of ["supported_currencies", "supported_locales"]) {
      const relation = describeToManyRelation(lifecycle.store, name, lifecycle.entities.map(entity => entity.table));
      if (relation?.join.type !== "hasMany" || relation.join.foreignKeys.length !== 1 || relation.join.foreignKeys[0] !== "store_id")
        return yield* Result.fail(commerceError("unsupportedProfile"));
      relations.set(name, relation);
    }
    const catalog: GraphCatalog = { entities, tables: lifecycle.entities.map(entity => entity.table), writablePivots: [],
      queryRelations: new Map([[lifecycle.store.name, relations]]), decodeRow,
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")),
      decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
    };
    const admitSelection: ReplacementProfile["admitSelection"] = (table, rows) => Result.gen(function* () {
      const entity = lifecycle.entities.find(entity => entity.table === table);
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* entity.decodeRow(row);
    });
    return { catalog, store, relations, admitSelection };
  });
}
