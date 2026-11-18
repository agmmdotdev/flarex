import { beforeEach, expect, it } from "vitest";
export interface NativeInventoryUpdateCreate { readonly sku: string; readonly origin_country?: string }
export interface NativeInventoryUpdateInput { readonly id: string; readonly sku: string }
export interface NativeInventoryUpdateRow { readonly id: string }
export interface NativeInventoryUpdateTestService {
  createInventoryItems(input: NativeInventoryUpdateCreate): Promise<NativeInventoryUpdateRow>;
  updateInventoryItems(input: NativeInventoryUpdateInput): Promise<NativeInventoryUpdateRow>;
  updateInventoryItems(input: NativeInventoryUpdateInput[]): Promise<readonly NativeInventoryUpdateRow[]>;
}
/** The two complete pinned item-update bodies and their original beforeEach
 * seed. The connected host supplies real native commands and storage cleanup. */
export function registerNativeInventoryUpdateTests(service: NativeInventoryUpdateTestService) {
        let inventoryItem: NativeInventoryUpdateRow

        beforeEach(async () => {
          inventoryItem = await service.createInventoryItems({
            sku: "test-sku",
            origin_country: "test-country",
          })
        })

        it("should update the inventory item", async () => {
          const update = {
            id: inventoryItem.id,
            sku: "updated-sku",
          }
          const updated = await service.updateInventoryItems(update)

          expect(updated).toEqual(expect.objectContaining(update))
        })

        it("should update multiple inventory items", async () => {
          const item2 = await service.createInventoryItems({
            sku: "test-sku-1",
          })

          const updates = [
            {
              id: inventoryItem.id,
              sku: "updated-sku",
            },
            {
              id: item2.id,
              sku: "updated-sku-2",
            },
          ]
          const updated = await service.updateInventoryItems(updates)

          expect(updated).toEqual([
            expect.objectContaining(updates[0]),
            expect.objectContaining(updates[1]),
          ])
        })
}
