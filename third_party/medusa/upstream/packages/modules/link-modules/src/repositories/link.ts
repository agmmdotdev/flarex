import { Context, ModuleJoinerConfig } from "@medusajs/framework/types"
import { EntitySchema } from "@medusajs/framework/mikro-orm/core"

import {
  generateEntityId,
  type MikroOrmBaseRepository,
  mikroOrmBaseRepositoryFactory,
} from "@medusajs/framework/utils"
import { SqlEntityManager } from "@medusajs/framework/mikro-orm/postgresql"

type LinkRepositoryConstructor = {
  new (args: {
    joinerConfig: ModuleJoinerConfig
    manager?: SqlEntityManager
  }): MikroOrmBaseRepository
}

export function getLinkRepository(model: EntitySchema): LinkRepositoryConstructor {
  return class LinkRepository extends mikroOrmBaseRepositoryFactory(model) {
    readonly joinerConfig_: ModuleJoinerConfig

    constructor({ joinerConfig }: { joinerConfig: ModuleJoinerConfig }) {
      // @ts-ignore
      super(...arguments)
      this.joinerConfig_ = joinerConfig
    }

    async delete(data: any, context: Context = {}): Promise<string[]> {
      const filter = {}
      for (const key in data) {
        filter[key] = {
          $in: Array.isArray(data[key]) ? data[key] : [data[key]],
        }
      }

      return await super.delete(filter, context)
    }

    async create(data: object[], context: Context = {}): Promise<object[]> {
      const manager = this.getActiveManager<SqlEntityManager>(context)

      const links = data.map((link: any) => {
        link.id = generateEntityId(
          link.id,
          this.joinerConfig_.databaseConfig?.idPrefix ?? "link"
        )
        link.deleted_at = null
        return manager.create(model, link)
      })

      await manager.upsertMany(model, links)

      return links
    }
  }
}
