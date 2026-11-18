import { Effect, Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { GraphCatalog, ReplacementProfile } from "../../write/graph-model";
import { commerceDecoder } from "../../value/decoder";
import { projectNativeRow } from "../../repository/result";
import { ShippingOptionId } from "./shipping-option-create-input";
import { ShippingOptionUpdate, ShippingOptionUpdateRule, ShippingOptionUpdateType, type compileShippingOptionUpdateContracts } from "./shipping-option-update-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionUpdateContracts>>;

export function prepareShippingOptionUpdateGraph(contracts: Contracts) {
  const entity = (value: Contracts["optionEntity"]) => ({ table: value.table, model: value.model, keyColumn: "id", prefix: value.table.columns.find(column => column.name === "id")?.options?.prefix });
  const option = entity(contracts.optionEntity), rule = entity(contracts.ruleEntity), type = entity(contracts.typeEntity);
  const decodeOption = commerceDecoder(ShippingOptionUpdate, "invalidInput"), decodeRule = commerceDecoder(ShippingOptionUpdateRule, "invalidInput"),
    decodeType = commerceDecoder(ShippingOptionUpdateType, "invalidInput"), decodeReference = commerceDecoder(ShippingOptionId, "invalidInput");
  const catalog: GraphCatalog = { entities: [option, type, rule], tables: contracts.entities.map(entity => entity.table),
    writablePivots: [], queryRelations: contracts.relations,
    decodeRow: (entity, input) => Result.gen(function* () {
      const row = entity === option ? yield* decodeOption(input) : entity === rule ? yield* decodeRule(input)
        : entity === type ? yield* decodeType(input) : yield* Result.fail(commerceError("unsupportedProfile"));
      return { supplied: entity === option ? Object.fromEntries(Object.entries(row).filter(([field]) => field !== "type_id")) : row, key: row.id };
    }),
    decodeReference: (entity, input) => entity === type ? decodeReference(input).pipe(Result.map(key => ({ key }))) : Result.fail(commerceError("unsupportedProfile")),
    decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
  };
  const profile: ReplacementProfile = { catalog, operation: "update", ordering: new Map([[contracts.rule.name, { kind: "storageInsertion", direction: "asc" }]]),
    touchOwnedToOne: true, allowReconstitution: true,
    allowedRelations: entity => entity === option ? ["rules", "type"] : [], ownedToOne: entity => entity === option ? ["type"] : [],
    mutableForeignKeys: entity => entity === option,
    admitSelection: (table, rows) => Result.gen(function* () {
      const entity = contracts.entities.find(entity => entity.table.name === table.name);
      if (entity === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      if (rows.length > entity.maximum) return yield* Result.fail(commerceError("limitExceeded"));
      for (const row of rows) yield* entity.decodeRow(projectNativeRow(row));
    }), prepareProjection: () => Effect.void,
    toManyMode: (entity, name, child) => entity === option && name === "rules" && child === rule ? Result.succeed("replace") : Result.fail(commerceError("unsupportedProfile")),
    validateLink: () => Effect.fail(commerceError("unsupportedProfile")), projectionPaths: (_entity, relations) => relations,
    project: rows => Result.succeed(new Map([...rows].map(([table, rows]) => [table, rows.filter(row => row.deleted_at === null)]))),
  };
  return { option, rule, type, catalog, profile };
}
