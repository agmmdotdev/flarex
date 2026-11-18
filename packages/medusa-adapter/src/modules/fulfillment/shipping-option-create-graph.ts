import { Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import type { CreationProfile, GraphCatalog } from "../../write/graph-model";
import { ShippingOptionCreate, ShippingOptionId, ShippingOptionInlineRule, ShippingOptionInlineType,
  type compileShippingOptionCreationContracts } from "./shipping-option-create-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionCreationContracts>>;

export function prepareShippingOptionCreationGraph(contracts: Contracts) {
  const entity = (value: Contracts["entities"][number]) => ({ table: value.table, model: value.model, keyColumn: "id",
    prefix: value.table.columns.find(column => column.name === "id")?.options?.prefix });
  const type = entity(contracts.typeEntity), option = entity(contracts.optionEntity), rule = entity(contracts.ruleEntity);
  const decodeOption = commerceDecoder(ShippingOptionCreate, "invalidInput"), decodeType = commerceDecoder(ShippingOptionInlineType, "invalidInput"),
    decodeRule = commerceDecoder(ShippingOptionInlineRule, "invalidInput"), decodeReference = commerceDecoder(ShippingOptionId, "invalidInput");
  const catalog: GraphCatalog = { entities: [type, option, rule], tables: contracts.entities.map(entity => entity.table),
    writablePivots: [], queryRelations: contracts.relations,
    decodeRow: (entity, input) => Result.gen(function* () {
      const row = entity === option ? yield* decodeOption(input) : entity === type ? yield* decodeType(input)
        : entity === rule ? yield* decodeRule(input) : yield* Result.fail(commerceError("unsupportedProfile"));
      // Native normalization already supplied type_id -> type, so this graph
      // consumes that relation without reproducing the workflow's decision.
      const supplied = entity === option ? Object.fromEntries(Object.entries(row).filter(([name]) => !["type_id", "prices"].includes(name))) : row;
      return { supplied, key: undefined };
    }),
    decodeReference: (entity, input) => entity === type ? decodeReference(input).pipe(Result.map(key => ({ key })))
      : Result.fail(commerceError("unsupportedProfile")),
    decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
  };
  const profile: CreationProfile = { catalog, root: { entity: option, omitRelations: ["type", "rules"], steps: [
    { kind: "ownedToOne", name: "type", foreignKey: "shipping_option_type_id", node: { entity: type, omitRelations: [], steps: [] } },
    { kind: "children", name: "rules", foreignKey: "shipping_option_id", node: { entity: rule, omitRelations: [], steps: [] } },
  ] }, rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }) };
  return { catalog, profile };
}
