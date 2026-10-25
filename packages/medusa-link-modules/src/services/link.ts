import { buildQuery } from "@medusajs/utils/modules-sdk/build-query"
import type { Context, DAL, FindConfig } from "@medusajs/framework/types"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
} from "@medusajs/framework/utils/portable"
import type { LinkOperationStore } from "../operations/store"

type InjectedDependencies = {
  linkRepository: DAL.RepositoryService
  linkOperationStore?: LinkOperationStore
}

export default class LinkService<TEntity> {
  protected readonly linkRepository_: any
  readonly linkOperationStore: LinkOperationStore | undefined

  constructor({ linkRepository, linkOperationStore }: InjectedDependencies) {
    this.linkRepository_ = linkRepository
    this.linkOperationStore = linkOperationStore
  }

  private async rotateSelected(filters: unknown, context: Context): Promise<void> {
    const store = this.linkOperationStore
    if (store === undefined) return
    const rows = await this.list(filters, { take: null, withDeleted: true }, context)
    const serialized: unknown[] = await this.linkRepository_.serialize(rows)
    await store.rotate(store.pairs(serialized), context)
  }

  @InjectManager("linkRepository_")
  async list(
    filters: unknown = {},
    config: FindConfig<unknown> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<TEntity[]> {
    const queryOptions = buildQuery<unknown>(
      filters as any,
      config
    )
    return await this.linkRepository_.find(queryOptions, sharedContext)
  }

  @InjectManager("linkRepository_")
  async listAndCount(
    filters = {},
    config: FindConfig<unknown> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[TEntity[], number]> {
    const queryOptions = buildQuery<unknown>(filters, config)
    return await this.linkRepository_.findAndCount(queryOptions, sharedContext)
  }

  @InjectTransactionManager("linkRepository_")
  async create(
    data: unknown[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<TEntity[]> {
    if (this.linkOperationStore !== undefined) {
      await this.linkOperationStore.rotate(this.linkOperationStore.pairs(data), sharedContext)
    }
    return await this.linkRepository_.create(data, {
      transactionManager: sharedContext.transactionManager,
    })
  }

  @InjectTransactionManager("linkRepository_")
  async dismiss(
    data: unknown[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<TEntity[]> {
    if (this.linkOperationStore !== undefined) {
      await this.linkOperationStore.rotate(this.linkOperationStore.pairs(data), sharedContext)
    }
    const filter: any = []
    for (const pair of data) {
      filter.push({
        $and: Object.entries(pair as object).map(([key, value]) => ({
          [key]: value,
        })),
      })
    }

    const [rows] = await this.linkRepository_.softDelete(
      { $or: filter },
      {
        transactionManager: sharedContext.transactionManager,
      }
    )

    return rows
  }

  @InjectTransactionManager("linkRepository_")
  async delete(
    data: unknown,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    await this.rotateSelected({ $or: Array.isArray(data) ? data : [data] }, sharedContext)
    await this.linkRepository_.delete(data, {
      transactionManager: sharedContext.transactionManager,
    })
  }

  @InjectTransactionManager("linkRepository_")
  async softDelete(
    data: any[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[object[], Record<string, string[]>]> {
    const deleteFilters = {
      $or: data.map((dataEntry) => {
        const filter = {}
        for (const key in dataEntry) {
          filter[key] = {
            $in: Array.isArray(dataEntry[key])
              ? dataEntry[key]
              : [dataEntry[key]],
          }
        }
        return filter
      }),
    }

    await this.rotateSelected(deleteFilters, sharedContext)
    return await this.linkRepository_.softDelete(deleteFilters, {
      transactionManager: sharedContext.transactionManager,
    })
  }

  @InjectTransactionManager("linkRepository_")
  async restore(
    data: any,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[object[], Record<string, string[]>]> {
    const restoreFilters = {
      $or: data.map((dataEntry) => {
        const filter = {}
        for (const key in dataEntry) {
          filter[key] = {
            $in: Array.isArray(dataEntry[key])
              ? dataEntry[key]
              : [dataEntry[key]],
          }
        }
        return filter
      }),
    }

    await this.rotateSelected(restoreFilters, sharedContext)
    return await this.linkRepository_.restore(restoreFilters, {
      transactionManager: sharedContext.transactionManager,
    })
  }
}
