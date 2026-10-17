import { Effect, Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import type { ReplacementProfile } from "../../write/graph-model";
import { StoreCreate, StoreCurrencyCreate, StoreLocaleCreate, type compileStoreCreationContracts } from "./create-input";
import { prepareStoreGraph } from "./graph";

type Contracts = Result.Result.Success<ReturnType<typeof compileStoreCreationContracts>>;

/** Creation admits no supplied root/child identities or managed-field DTOs. */
export function prepareStoreCreationGraph(contracts: Contracts) {
  return Result.gen(function* () {
    const { lifecycle } = contracts;
    const decodeStore = commerceDecoder(StoreCreate, "invalidInput"), decodeCurrency = commerceDecoder(StoreCurrencyCreate, "invalidInput"),
      decodeLocale = commerceDecoder(StoreLocaleCreate, "invalidInput");
    const graph = yield* prepareStoreGraph(contracts, (entity, input) => Result.gen(function* () {
      const supplied = entity.table === lifecycle.store ? yield* decodeStore(input)
        : entity.table === lifecycle.currency ? yield* decodeCurrency(input)
          : entity.table === lifecycle.locale ? yield* decodeLocale(input)
            : yield* Result.fail(commerceError("unsupportedProfile"));
      return { supplied, key: undefined };
    }));
    const { catalog, store, relations, admitSelection } = graph;
    const profile: ReplacementProfile = { catalog, operation: "upsertWithReplace", ordering: new Map(),
      allowedRelations: entity => entity === store ? ["supported_currencies", "supported_locales"] : [],
      ownedToOne: () => [], mutableForeignKeys: () => false, admitSelection,
      prepareProjection: () => Effect.void,
      toManyMode: (entity, name, child) => entity === store && relations.get(name)?.targetTable === child.table.name
        ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
      validateLink: () => Effect.fail(commerceError("unsupportedProfile")),
      projectionPaths: (_entity, names) => names, project: rows => Result.succeed(rows),
    };
    return { catalog, profile, store };
  });
}
