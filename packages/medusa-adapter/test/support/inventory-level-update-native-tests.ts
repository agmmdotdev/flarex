import { beforeEach, expect, it } from "vitest";
export interface NativeInventoryLevelUpdateItemInput { readonly sku: string; readonly origin_country: string }
export interface NativeInventoryLevelUpdateInput {
  readonly inventory_item_id: string;
  readonly location_id: string;
  readonly stocked_quantity?: number;
  readonly incoming_quantity?: number;
}
export interface NativeInventoryLevelUpdateRow { readonly id: string; readonly incoming_quantity?: number }
export interface NativeInventoryLevelUpdateTestService {
  createInventoryItems(input: NativeInventoryLevelUpdateItemInput): Promise<NativeInventoryLevelUpdateRow>;
  createInventoryLevels(input: NativeInventoryLevelUpdateInput): Promise<NativeInventoryLevelUpdateRow>;
  updateInventoryLevels(input: NativeInventoryLevelUpdateInput): Promise<NativeInventoryLevelUpdateRow>;
}
/** Complete pinned absolute-Level update bodies and original beforeEach seed.
 * The connected fixture supplies actual native commands and cleanup. */
export function registerNativeInventoryLevelUpdateTests(service: NativeInventoryLevelUpdateTestService) {
        let inventoryLevel: NativeInventoryLevelUpdateRow
        let inventoryItem: NativeInventoryLevelUpdateRow

        beforeEach(async () => {
          inventoryItem = await service.createInventoryItems({
            sku: "test-sku",
            origin_country: "test-country",
          })

          const data = {
            inventory_item_id: inventoryItem.id,
            location_id: "location-1",
            stocked_quantity: 2,
          }

          inventoryLevel = await service.createInventoryLevels(data)
        })

        it("should update inventory level", async () => {
          const updatedLevel = await service.updateInventoryLevels({
            location_id: "location-1",
            inventory_item_id: inventoryItem.id,
            incoming_quantity: 4,
          })

          expect(updatedLevel.incoming_quantity).toEqual(4)
        })

        it("should fail to update inventory level for item in location that isn't stocked", async () => {
          const error = await service
            .updateInventoryLevels({
              inventory_item_id: inventoryItem.id,
              location_id: "does-not-exist",
              stocked_quantity: 10,
            })
            .catch((error) => error)

          expect(error.message).toEqual(
            `Item ${inventoryItem.id} is not stocked at location does-not-exist`
          )
        })
}
