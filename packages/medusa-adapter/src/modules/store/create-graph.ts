import { Effect, Result } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import type { CommerceRelation } from "../../query/relations";
import type { GraphCatalog, GraphEntity, ReplacementProfile } from "../../write/graph-model";
import { StoreCreate, StoreCurrencyCreate, StoreLocaleCreate, type compileStoreCreationContracts } from "./create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileStoreCreationContracts>>;

/** Store selects only its two native owned-child hasMany relations. Shared
 * graph replacement owns generated keys, FK checks, writes and hydration. */
export function prepareStoreCreationGraph(contracts: Contracts) {
  return Result.gen(function* () {
    const { lifecycle } = contracts;
    const entities: GraphEntity[] = [];
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
    const decodeStore = commerceDecoder(StoreCreate, "invalidInput"), decodeCurrency = commerceDecoder(StoreCurrencyCreate, "invalidInput"),
      decodeLocale = commerceDecoder(StoreLocaleCreate, "invalidInput");
    const catalog: GraphCatalog = { entities, tables: lifecycle.entities.map(entity => entity.table), writablePivots: [],
      queryRelations: new Map([[lifecycle.store.name, relations]]),
      decodeRow: (entity, input) => Result.gen(function* () {
        const supplied = entity.table === lifecycle.store ? yield* decodeStore(input)
          : entity.table === lifecycle.currency ? yield* decodeCurrency(input)
            : entity.table === lifecycle.locale ? yield* decodeLocale(input)
              : yield* Result.fail(commerceError("unsupportedProfile"));
        return { supplied, key: undefined };
      }),
      decodeReference: () => Result.fail(commerceError("unsupportedProfile")),
      decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
    };
    const profile: ReplacementProfile = { catalog,
      allowedRelations: entity => entity === store ? ["supported_currencies", "supported_locales"] : [],
      ownedToOne: () => [], mutableForeignKeys: () => false,
      admitSelection: (table, rows) => Result.gen(function* () {
        const entity = lifecycle.entities.find(entity => entity.table === table);
        if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
        for (const row of rows) yield* entity.decodeRow(row);
      }),
      prepareProjection: () => Effect.void,
      toManyMode: (entity, name, child) => entity === store && relations.get(name)?.targetTable === child.table.name
        ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")),
      projectionPaths: (_entity, names) => names,
      project: rows => Result.succeed(rows),
    };
    return { catalog, profile, store };
  });
}
