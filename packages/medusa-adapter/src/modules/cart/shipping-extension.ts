import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder, commerceRowDecoder } from "../../value/decoder";
import type { prepareCartCreationRepository } from "./creation-repository";

type Creation = Result.Result.Success<ReturnType<typeof prepareCartCreationRepository>>;
const row = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const id = commerceDecoder(Schema.String.check(Schema.isBetweenLength(1, 256)), "unsupportedProfile");

/** Extend the workflow's checked Cart catalog with genuine scalar Shipping
 * models. Standalone Cart creation retains its existing authoring contract. */
export function prepareCartShippingExtension(creation: Creation) {
  return Result.gen(function* () {
    const additions = yield* Result.all(([["cart_shipping_method", "ShippingMethod"], ["cart_shipping_method_tax_line", "ShippingMethodTaxLine"],
      ["cart_shipping_method_adjustment", "ShippingMethodAdjustment"]] as const).map(([name, model]) => Result.gen(function* () {
      const contract = creation.byName.get(name);
      const primary = contract?.table.columns.filter(column => column.primaryKey);
      if (contract === undefined || primary?.length !== 1 || primary[0]?.name !== "id") return yield* Result.fail(commerceError("unsupportedProfile"));
      return { ...contract, model, graph: { table: contract.table, model, keyColumn: "id", prefix: primary[0].options?.prefix },
        create: commerceRowDecoder(contract.table.columns.filter(column => !["created_at", "updated_at", "deleted_at"].includes(column.name)).map(column => column.name), "unsupportedProfile") };
    })));
    const entities = [...creation.entities, ...additions], catalog = creation.creationCatalog;
    return { ...creation, entities, creationCatalog: { ...catalog, entities: entities.map(entity => entity.graph),
      decodeRow: (entity: Parameters<typeof catalog.decodeRow>[0], input: Parameters<typeof catalog.decodeRow>[1]) => {
        const addition = additions.find(candidate => candidate.table.name === entity.table.name);
        return addition === undefined ? catalog.decodeRow(entity, input) : Result.gen(function* () {
          const supplied = yield* row(yield* addition.create(input));
          return { supplied, key: supplied.id === undefined ? undefined : yield* id(supplied.id) };
        });
      } } };
  });
}
