import { expect, it } from "vitest";
export interface NativeInventoryInput { sku: string; origin_country: string }
export interface NativeInventoryRow { readonly id: string }
export interface NativeInventoryTestService {
  createInventoryItems(input: NativeInventoryInput): Promise<NativeInventoryRow>;
  createInventoryItems(input: NativeInventoryInput[]): Promise<readonly NativeInventoryRow[]>;
}
/** Complete pinned item creation bodies, checked by the source promotion guard. */
export function registerNativeInventoryTests(service: NativeInventoryTestService) {
        it("should create an inventory item", async () => {
          const data = { sku: "test-sku", origin_country: "test-country" }
          const inventoryItem = await service.createInventoryItems(data)

          expect(inventoryItem).toEqual(
            expect.objectContaining({ id: expect.any(String), ...data })
          )
        })

        it("should create inventory items from array", async () => {
          const data = [
            { sku: "test-sku", origin_country: "test-country" },
            { sku: "test-sku-1", origin_country: "test-country-1" },
          ]
          const inventoryItems = await service.createInventoryItems(data)

          expect(inventoryItems).toEqual([
            expect.objectContaining({ id: expect.any(String), ...data[0] }),
            expect.objectContaining({ id: expect.any(String), ...data[1] }),
          ])
        })
}
