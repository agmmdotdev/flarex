import type { BigNumber } from "@medusajs/utils/totals/big-number";
import type { Context, DAL } from '@medusajs/types';
export interface InventoryLevelRepository extends DAL.RepositoryService {
 getStockedQuantity(item: string, locations: string[], context?: Context): Promise<BigNumber>;
 getReservedQuantity(item: string, locations: string[], context?: Context): Promise<BigNumber>;
 getAvailableQuantity(item: string, locations: string[], context?: Context): Promise<BigNumber>;
}
