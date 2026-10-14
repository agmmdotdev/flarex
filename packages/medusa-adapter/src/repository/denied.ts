import type { DAL } from "@medusajs/framework/types";

/** Keep the borrowed manager ABI while explicitly refusing every data method.
 * A new native DAL member must be classified here rather than inherited. */
export function deniedCommerceRepository(repository: DAL.RepositoryService, refuse: () => Promise<never>): DAL.RepositoryService {
  return {
    getFreshManager: repository.getFreshManager.bind(repository),
    getActiveManager: repository.getActiveManager.bind(repository),
    transaction: repository.transaction.bind(repository),
    serialize: refuse, find: refuse, findAndCount: refuse,
    create: refuse, update: refuse, delete: refuse,
    softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse,
  };
}
