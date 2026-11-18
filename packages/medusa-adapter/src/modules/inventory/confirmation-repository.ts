import { Effect, Result, Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { inventoryLevelsAvailableQuantity } from "@medusajs/inventory/inventory-level-availability";
import { prepareScalarRepository } from "../../repository/scalar";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { deniedCommerceRepository } from "../../repository/denied";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { readCommerceRelationRows } from "../../query/relations";
import type { InventoryConfirmationContracts } from "./confirmation-input";
import { InventoryConfirmationLocations } from "./confirmation-input";

const decodeSelection = commerceDecoder(Schema.Tuple([ScalarId, InventoryConfirmationLocations]), "unsupportedProfile");
type LevelRow = Effect.Success<ReturnType<InventoryConfirmationContracts["levelContracts"]["decodeStoredRow"]>>;

/** The pinned repository selects active Levels by Location membership and Item
 * identity. Only the existing logical query owner executes that predicate. */
export function inventoryConfirmationLevelPredicate(item: string, locations: readonly string[]): JsonObject {
  return { kind: "and", children: [
    { kind: "in", column: "location_id", values: [...new Set(locations)] },
    { kind: "in", column: "inventory_item_id", values: [item] },
    { kind: "isNull", column: "deleted_at" },
  ] };
}

export function prepareInventoryConfirmationRepository(contracts: InventoryConfirmationContracts) {
  return Result.gen(function* () {
    const item = yield* prepareScalarRepository(contracts.item, "InventoryItem", scalarIdWhere);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = item.bind(ctx, owner), denied = deniedCommerceRepository(bound.repository, bound.refuse);
      const itemRepository: DAL.RepositoryService = { ...denied, find: bound.repository.find, serialize: bound.repository.serialize };
      const getAvailableQuantity = (inventoryItemId: string, locationIds: string[], shared?: Context) =>
        bound.bridge.executeInput(shared, [inventoryItemId, locationIds], (current, input) => bound.bridge.checked(current, Effect.gen(function* () {
          const [itemId, locations] = yield* Effect.fromResult(captureCommerceInput(input, current.resources).pipe(Result.flatMap(decodeSelection)));
          const selected = yield* readCommerceRelationRows(current, contracts.level.name,
            inventoryConfirmationLevelPredicate(itemId, locations), "id", { includeIdentities: true });
          if (selected.length > 16) return yield* current.refuse(commerceError("unsupportedProfile"));
          const rows: LevelRow[] = [];
          for (const row of selected) rows.push(yield* contracts.levelContracts.decodeStoredRow(row));
          return yield* Effect.try({ try: () => inventoryLevelsAvailableQuantity(rows), catch: cause => commerceError("storedCorruption", cause) });
        })));
      const levelRepository: DAL.RepositoryService & {
        getAvailableQuantity: typeof getAvailableQuantity;
        getStockedQuantity: typeof bound.refuse;
        getReservedQuantity: typeof bound.refuse;
      } = { ...denied, getAvailableQuantity, getStockedQuantity: bound.refuse, getReservedQuantity: bound.refuse };
      return { ...bound, itemRepository, denied, levelRepository };
    };
    return { query: item.query, bind };
  });
}
