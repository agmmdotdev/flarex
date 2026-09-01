import {
  Context,
  DAL,
  FindConfig,
  InferEntityType,
  ModulePersistenceAdapter,
  ModulePersistenceMutationService,
  ProductTypes,
} from "@medusajs/framework/types"
import {
  createMedusaMikroOrmEventSubscriber,
  FreeTextSearchFilterKeyPrefix,
  InjectManager,
  InjectTransactionManager,
  generateEntityId,
  isDefined,
  MedusaContext,
  MedusaError,
  MedusaInternalService,
  MedusaService,
  ModulesSdkUtils,
  registerInternalServiceEventSubscriber,
} from "@medusajs/framework/utils"
import { EntityManager, EventType } from "@mikro-orm/core"
import { ProductCategory } from "@models"
import { ProductCategoryRepository } from "@repositories"
import { UpdateCategoryInput } from "@types"

type InjectedDependencies = {
  productCategoryRepository: DAL.TreeRepositoryService
  productModuleService: ReturnType<typeof MedusaService> &
    ModulePersistenceMutationService
  modulePersistenceAdapter?: ModulePersistenceAdapter
}

type PreparedProductCategoryCreate = ProductTypes.CreateProductCategoryDTO & {
  id: string
  mpath: string
}

type ProductCategoryRecord = Omit<
  InferEntityType<typeof ProductCategory>,
  "parent_category" | "category_children"
> & {
  parent_category_id?: string | null
  parent_category?: ProductCategoryRecord | null
  category_children?: ProductCategoryRecord[]
}

type ProductCategoryMutationRepository = DAL.RepositoryService<
  typeof ProductCategory
>

type CategoryTransformOptions = {
  includeDescendantsTree?: boolean
  includeAncestorsTree?: boolean
}

export default class ProductCategoryService extends MedusaInternalService<
  InjectedDependencies,
  typeof ProductCategory
>(ProductCategory) {
  protected readonly productCategoryRepository_: DAL.TreeRepositoryService
  protected readonly container: InjectedDependencies

  constructor(container: InjectedDependencies) {
    // @ts-expect-error
    super(...arguments)
    this.container = container
    this.productCategoryRepository_ = container.productCategoryRepository
  }

  // TODO: Add support for object filter
  @InjectManager("productCategoryRepository_")
  // @ts-expect-error
  async retrieve(
    productCategoryId: string,
    config: FindConfig<ProductTypes.ProductCategoryDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<InferEntityType<typeof ProductCategory>> {
    if (!isDefined(productCategoryId)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `"productCategoryId" must be defined`
      )
    }

    const queryOptions = ModulesSdkUtils.buildQuery(
      {
        id: productCategoryId,
      },
      config
    )

    // TODO: Currently remoteQuery doesn't allow passing custom objects, so the `include*` are part of the filters
    // Modify remoteQuery to allow passing custom objects
    const transformOptions = {
      includeDescendantsTree: true,
    }

    const productCategories = await this.productCategoryRepository_.find(
      queryOptions,
      {},
      sharedContext
    )

    const transformedCategories = await this.applyCategoryTransforms(
      productCategories as ProductCategoryRecord[],
      transformOptions,
      queryOptions,
      sharedContext
    )

    if (!transformedCategories?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductCategory with id: ${productCategoryId} was not found`
      )
    }

    return transformedCategories[0] as unknown as InferEntityType<
      typeof ProductCategory
    >
  }

  @InjectManager("productCategoryRepository_")
  async list(
    filters: ProductTypes.FilterableProductCategoryProps = {},
    config: FindConfig<ProductTypes.ProductCategoryDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<InferEntityType<typeof ProductCategory>[]> {
    const transformOptions = {
      includeDescendantsTree: filters?.include_descendants_tree || false,
      includeAncestorsTree: filters?.include_ancestors_tree || false,
    }
    delete filters.include_descendants_tree
    delete filters.include_ancestors_tree

    // Apply free text search filter
    if (isDefined(filters?.q)) {
      config.filters ??= {}
      config.filters[FreeTextSearchFilterKeyPrefix + ProductCategory.name] = {
        value: filters.q,
        fromEntity: ProductCategory.name,
      }

      delete filters.q
    }

    const queryOptions = ModulesSdkUtils.buildQuery(filters, config)
    queryOptions.where ??= {}
    queryOptions.options.orderBy ??= {
      id: "ASC",
      rank: "ASC",
    }

    const categories = await this.productCategoryRepository_.find(
      queryOptions,
      {},
      sharedContext
    )

    return (await this.applyCategoryTransforms(
      categories as ProductCategoryRecord[],
      transformOptions,
      queryOptions,
      sharedContext
    )) as unknown as InferEntityType<typeof ProductCategory>[]
  }

  @InjectManager("productCategoryRepository_")
  async listAndCount(
    filters: ProductTypes.FilterableProductCategoryProps = {},
    config: FindConfig<ProductTypes.ProductCategoryDTO> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[InferEntityType<typeof ProductCategory>[], number]> {
    const transformOptions = {
      includeDescendantsTree: filters?.include_descendants_tree || false,
      includeAncestorsTree: filters?.include_ancestors_tree || false,
    }
    delete filters.include_descendants_tree
    delete filters.include_ancestors_tree

    // Apply free text search filter
    if (isDefined(filters?.q)) {
      config.filters ??= {}
      config.filters[FreeTextSearchFilterKeyPrefix + ProductCategory.name] = {
        value: filters.q,
        fromEntity: ProductCategory.name,
      }

      delete filters.q
    }

    const queryOptions = ModulesSdkUtils.buildQuery(filters, config)
    queryOptions.where ??= {}
    queryOptions.options.orderBy ??= {
      id: "ASC",
      rank: "ASC",
    }

    const [categories, count] = await this.productCategoryRepository_.findAndCount(
      queryOptions,
      {},
      sharedContext
    )

    return [
      (await this.applyCategoryTransforms(
        categories as ProductCategoryRecord[],
        transformOptions,
        queryOptions,
        sharedContext
      )) as unknown as InferEntityType<typeof ProductCategory>[],
      count,
    ]
  }

  private async applyCategoryTransforms(
    categories: ProductCategoryRecord[],
    transformOptions: CategoryTransformOptions,
    findOptions: DAL.FindOptions<typeof ProductCategory>,
    sharedContext: Context
  ): Promise<ProductCategoryRecord[]> {
    const relations = findOptions.options?.populate ?? []
    const fields = findOptions.options?.fields ?? []
    const shouldHydrateChildren =
      transformOptions.includeDescendantsTree ||
      relations.includes("category_children")
    const shouldHydrateParents =
      transformOptions.includeAncestorsTree ||
      relations.includes("parent_category") ||
      fields.includes("parent_category_id")

    if (!shouldHydrateChildren && !shouldHydrateParents) {
      return categories
    }

    const shouldProjectFields = fields.length > 0
    const treeFields = new Set<string>(["id"])
    for (const field of fields) {
      if (typeof field !== "string") {
        continue
      }
      treeFields.add(field)
      const [relationName] = field.split(".")
      if (relationName !== field) {
        treeFields.add(relationName)
      }
    }
    // MikroORM may mutate `populate` in place into hint objects during the
    // preceding find; only string relation names are used for projection.
    for (const relation of relations) {
      if (typeof relation !== "string") {
        continue
      }
      const [relationName] = relation.split(".")
      treeFields.add(relationName)
    }
    treeFields.add("mpath")
    treeFields.add("parent_category_id")

    const allCategories = (await this.productCategoryRepository_.find(
      {
        where: treeScopeWhere(findOptions.where ?? {}),
        options: {
          orderBy: {
            id: "ASC",
            rank: "ASC",
          },
          // Bypass identity-map leftovers from a prior field-limited find so
          // mpath/parent_category_id are loaded for tree hydration on MikroORM.
          disableIdentityMap: true,
        } as DAL.FindOptions<typeof ProductCategory>["options"] & {
          disableIdentityMap?: boolean
        },
      },
      {},
      sharedContext
    )) as ProductCategoryRecord[]

    const categoryById = new Map(allCategories.map((category) => [
      category.id,
      category,
    ]))
    const childrenByParentId = new Map<string | null, ProductCategoryRecord[]>()
    for (const category of allCategories) {
      const parentId = category.parent_category_id ?? null
      const children = childrenByParentId.get(parentId) ?? []
      children.push(category)
      childrenByParentId.set(parentId, children)
    }
    for (const children of childrenByParentId.values()) {
      children.sort(
        (a, b) => a.id.localeCompare(b.id) || (a.rank ?? 0) - (b.rank ?? 0)
      )
    }

    const cloneCategory = (
      category: ProductCategoryRecord
    ): ProductCategoryRecord =>
      shouldProjectFields
        ? projectCategory(category, treeFields)
        : {
            ...category,
          }

    const attachChildren = (category: ProductCategoryRecord): ProductCategoryRecord => {
      const cloned = cloneCategory(category)
      cloned.category_children = (childrenByParentId.get(category.id) ?? []).map(
        attachChildren
      )
      return cloned
    }

    const attachParent = (category: ProductCategoryRecord): ProductCategoryRecord => {
      const cloned = cloneCategory(category)
      const parentId = category.parent_category_id ?? null
      const parentCategory = parentId ? categoryById.get(parentId) : undefined
      if (parentCategory) {
        cloned.parent_category = attachParent(parentCategory)
      } else if (!parentId) {
        cloned.parent_category = null
      } else {
        cloned.parent_category = undefined
      }
      return cloned
    }

    return categories.map((category) => {
      // Prefer the full tree-scoped record for mpath/parent links, but keep
      // populated relations (e.g. products) from the original row. Spreading the
      // original row last used to wipe tree scalars when MikroORM returned a
      // field-limited identity-map entity.
      const treeRecord = categoryById.get(category.id)
      const source = {
        ...(treeRecord ?? {}),
        ...category,
      } as ProductCategoryRecord

      if (treeRecord) {
        if (category.mpath === undefined) {
          source.mpath = treeRecord.mpath
        }
        if (category.parent_category_id === undefined) {
          source.parent_category_id = treeRecord.parent_category_id
        }
        if (category.rank === undefined) {
          source.rank = treeRecord.rank
        }
      }

      let transformed = cloneCategory(source)

      if (shouldHydrateChildren) {
        transformed = attachChildren(transformed)
      }

      if (shouldHydrateParents) {
        const withParent = attachParent(transformed)
        if (shouldHydrateChildren && transformed.category_children) {
          withParent.category_children = transformed.category_children
        }
        transformed = withParent
      }

      return transformed
    })
  }

  @InjectTransactionManager("productCategoryRepository_")
  async create(
    data: ProductTypes.CreateProductCategoryDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<InferEntityType<typeof ProductCategory>[]> {
    const categories = await this.prepareCategoriesForCreate(
      data,
      sharedContext
    )

    return await this.productCategoryRepository_.create(
      categories,
      sharedContext
    )
  }

  private async prepareCategoriesForCreate(
    data: ProductTypes.CreateProductCategoryDTO[],
    sharedContext: Context
  ): Promise<PreparedProductCategoryCreate[]> {
    const prepared: PreparedProductCategoryCreate[] = []
    const preparedById = new Map<
      string,
      PreparedProductCategoryCreate
    >()
    const batchRankOffsets = new Map<string, number>()

    for (const entry of data) {
      const categoryId = generateEntityId(getOptionalString(entry, "id"), "pcat")
      const category: PreparedProductCategoryCreate = {
        ...entry,
        id: categoryId,
        mpath: "",
      }

      const parentCategoryId =
        category.parent_category_id ?? getParentCategoryId(entry)
      const parentCategory = parentCategoryId
        ? preparedById.get(parentCategoryId) ??
          (await this.retrieveCategoryForCreate(parentCategoryId, sharedContext))
        : undefined
      const rankScope = parentCategoryId ?? "__root__"
      const batchOffset = batchRankOffsets.get(rankScope) ?? 0
      const siblingsCount = await this.countSiblingCategories(
        parentCategoryId,
        sharedContext
      )
      const maxRank = siblingsCount + batchOffset

      category.parent_category_id = parentCategoryId
      category.rank ??= maxRank
      if (category.rank > maxRank) {
        category.rank = maxRank
      }
      category.mpath = parentCategory
        ? `${parentCategory.mpath}.${categoryId}`
        : categoryId

      prepared.push(category)
      preparedById.set(categoryId, category)
      batchRankOffsets.set(rankScope, batchOffset + 1)
    }

    return prepared
  }

  private async retrieveCategoryForCreate(
    id: string,
    sharedContext: Context
  ): Promise<Pick<InferEntityType<typeof ProductCategory>, "id" | "mpath">> {
    const [category] = await this.productCategoryRepository_.find(
      {
        where: { id },
        options: {
          fields: ["id", "mpath"],
          limit: 1,
        },
      },
      {},
      sharedContext
    )

    if (!category) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `Parent category with id: '${id}' does not exist`
      )
    }

    return category
  }

  private async countSiblingCategories(
    parentCategoryId: string | undefined,
    sharedContext: Context
  ): Promise<number> {
    const [, count] = await this.productCategoryRepository_.findAndCount(
      {
        where: {
          parent_category_id: parentCategoryId ?? null,
        },
        options: {
          fields: ["id"],
          limit: 0,
        },
      },
      {},
      sharedContext
    )

    return count
  }

  @InjectTransactionManager("productCategoryRepository_")
  // @ts-expect-error
  async update(
    data: UpdateCategoryInput[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<InferEntityType<typeof ProductCategory>[]> {
    if (this.productCategoryRepository_ instanceof ProductCategoryRepository) {
      return await this.productCategoryRepository_.update(data, sharedContext)
    }

    return await this.updateWithPortableRepository(data, sharedContext)
  }

  @InjectTransactionManager("productCategoryRepository_")
  // @ts-expect-error
  async delete(
    ids: string[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<string[]> {
    if (!(this.productCategoryRepository_ instanceof ProductCategoryRepository)) {
      return await this.deleteWithPortableRepository(ids, sharedContext)
    }

    const persistenceAdapter = this.container.modulePersistenceAdapter
    const subscriber = createMedusaMikroOrmEventSubscriber(
      [ProductCategory.name],
      this.container["productModuleService"]
    )

    registerInternalServiceEventSubscriber(
      sharedContext,
      subscriber,
      persistenceAdapter
    )

    const deletedIds = await this.productCategoryRepository_.delete(
      ids,
      sharedContext
    )

    // Delete are handled a bit differently since we are going to the DB directly, therefore
    // just like upsert with replace, we need to dispatch the events manually.
    if (deletedIds.length) {
      if (persistenceAdapter?.dispatchMutationEvent) {
        const dispatchMutationEvent =
          persistenceAdapter.dispatchMutationEvent.bind(persistenceAdapter)
        await Promise.all(
          deletedIds.map((id) =>
            dispatchMutationEvent(
              "afterDelete",
              {
                entity: { id },
                meta: { className: ProductCategory.name },
              },
              sharedContext,
              subscriber
            )
          )
        )
      } else {
        const manager = (sharedContext.transactionManager ??
          sharedContext.manager) as EntityManager
        const eventManager = manager.getEventManager()

        await Promise.all(
          deletedIds.map((id) =>
            eventManager.dispatchEvent(EventType.afterDelete, {
              entity: { id },
              meta: {
                className: ProductCategory.name,
              } as Parameters<typeof eventManager.dispatchEvent>[2],
            })
          )
        )
      }
    }

    return deletedIds
  }

  private async updateWithPortableRepository(
    data: UpdateCategoryInput[],
    sharedContext: Context
  ): Promise<InferEntityType<typeof ProductCategory>[]> {
    const repository = this.getMutationRepository()
    const updatedCategories: InferEntityType<typeof ProductCategory>[] = []

    for (const entry of data) {
      const existing = await this.retrieveCategoryForMutation(
        entry.id,
        sharedContext
      )
      const parentCategoryId = getUpdatedParentCategoryId(entry)
      const parentChanged =
        parentCategoryId !== undefined &&
        parentCategoryId !== (existing.parent_category_id ?? null)
      const nextParentCategoryId = parentChanged
        ? parentCategoryId
        : existing.parent_category_id ?? null
      const parentCategory = nextParentCategoryId
        ? await this.retrieveCategoryForCreate(
            nextParentCategoryId,
            sharedContext
          )
        : undefined
      const nextMpath = parentCategory
        ? `${parentCategory.mpath}.${existing.id}`
        : existing.id
      const update = compactCategoryUpdate(entry)

      if (parentChanged) {
        update.parent_category_id = nextParentCategoryId
        update.mpath = nextMpath
      }

      if (parentChanged || isDefined(entry.rank)) {
        const nextRank = await this.updateCategoryRanksForMutation(
          existing,
          nextParentCategoryId,
          entry.rank,
          parentChanged,
          sharedContext
        )
        update.rank = nextRank
      }

      const [updatedCategory] = await repository.update(
        [
          {
            entity: { id: existing.id },
            update,
          },
        ],
        sharedContext
      )

      if (parentChanged && existing.mpath !== nextMpath) {
        await this.updateDescendantMpaths(
          existing.mpath,
          nextMpath,
          sharedContext
        )
      }

      updatedCategories.push(updatedCategory)
    }

    return updatedCategories
  }

  private async updateCategoryRanksForMutation(
    existing: ProductCategoryRecord,
    nextParentCategoryId: string | null,
    requestedRank: number | undefined,
    parentChanged: boolean,
    sharedContext: Context
  ): Promise<number> {
    const repository = this.getMutationRepository()
    const currentParentCategoryId = existing.parent_category_id ?? null
    const currentRank = existing.rank ?? 0
    const targetSiblings = await this.listSiblingCategories(
      nextParentCategoryId,
      sharedContext
    )
    const maxRank = parentChanged
      ? targetSiblings.length
      : Math.max(targetSiblings.length - 1, 0)
    const nextRank = Math.min(requestedRank ?? maxRank, maxRank)
    const updates = new Map<string, { rank: number }>()

    if (parentChanged) {
      const oldSiblings = await this.listSiblingCategories(
        currentParentCategoryId,
        sharedContext
      )
      for (const sibling of oldSiblings) {
        if (sibling.id !== existing.id && (sibling.rank ?? 0) > currentRank) {
          updates.set(sibling.id, { rank: (sibling.rank ?? 0) - 1 })
        }
      }

      for (const sibling of targetSiblings) {
        if ((sibling.rank ?? 0) >= nextRank) {
          updates.set(sibling.id, { rank: (sibling.rank ?? 0) + 1 })
        }
      }
    } else if (currentRank < nextRank) {
      for (const sibling of targetSiblings) {
        const siblingRank = sibling.rank ?? 0
        if (
          sibling.id !== existing.id &&
          siblingRank > currentRank &&
          siblingRank <= nextRank
        ) {
          updates.set(sibling.id, { rank: siblingRank - 1 })
        }
      }
    } else if (currentRank > nextRank) {
      for (const sibling of targetSiblings) {
        const siblingRank = sibling.rank ?? 0
        if (
          sibling.id !== existing.id &&
          siblingRank >= nextRank &&
          siblingRank < currentRank
        ) {
          updates.set(sibling.id, { rank: siblingRank + 1 })
        }
      }
    }

    if (updates.size) {
      await repository.update(
        [...updates].map(([id, update]) => ({
          entity: { id },
          update,
        })),
        sharedContext
      )
    }

    return nextRank
  }

  private async updateDescendantMpaths(
    oldMpath: string,
    nextMpath: string,
    sharedContext: Context
  ): Promise<void> {
    const repository = this.getMutationRepository()
    const allCategories = await this.listAllCategories(sharedContext)
    const descendantPrefix = `${oldMpath}.`
    const descendantUpdates = allCategories
      .filter((category) => category.mpath?.startsWith(descendantPrefix))
      .map((category) => ({
        entity: { id: category.id },
        update: {
          mpath: `${nextMpath}.${category.mpath.slice(
            descendantPrefix.length
          )}`,
        },
      }))

    if (descendantUpdates.length) {
      await repository.update(descendantUpdates, sharedContext)
    }
  }

  private async deleteWithPortableRepository(
    ids: string[],
    sharedContext: Context
  ): Promise<string[]> {
    const repository = this.getMutationRepository()

    for (const id of ids) {
      const category = await this.retrieveCategoryForMutation(
        id,
        sharedContext
      )
      const children = await this.listSiblingCategories(id, sharedContext)

      if (children.length) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Deleting ProductCategory (${id}) with category children is not allowed`
        )
      }

      const siblings = await this.listSiblingCategories(
        category.parent_category_id ?? null,
        sharedContext
      )
      const siblingUpdates = siblings
        .filter(
          (sibling) =>
            sibling.id !== category.id &&
            (sibling.rank ?? 0) > (category.rank ?? 0)
        )
        .map((sibling) => ({
          entity: { id: sibling.id },
          update: { rank: (sibling.rank ?? 0) - 1 },
        }))

      if (siblingUpdates.length) {
        await repository.update(siblingUpdates, sharedContext)
      }
    }

    const deletedIds = await this.productCategoryRepository_.delete(
      ids,
      sharedContext
    )
    const persistenceAdapter = this.container.modulePersistenceAdapter

    if (
      !deletedIds.length ||
      !persistenceAdapter?.createEventSubscriber ||
      !persistenceAdapter.dispatchMutationEvent
    ) {
      return deletedIds
    }

    const subscriber = persistenceAdapter.createEventSubscriber(
      [ProductCategory.name],
      this.container.productModuleService
    )
    const dispatchMutationEvent =
      persistenceAdapter.dispatchMutationEvent.bind(persistenceAdapter)
    await Promise.all(
      deletedIds.map((id) =>
        dispatchMutationEvent(
          "afterDelete",
          {
            entity: { id },
            meta: { className: ProductCategory.name },
          },
          sharedContext,
          subscriber
        )
      )
    )

    return deletedIds
  }

  private async retrieveCategoryForMutation(
    id: string,
    sharedContext: Context
  ): Promise<ProductCategoryRecord> {
    const [category] = (await this.productCategoryRepository_.find(
      {
        where: { id },
        options: { limit: 1 },
      },
      {},
      sharedContext
    )) as ProductCategoryRecord[]

    if (!category) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `ProductCategory with id: ${id} was not found`
      )
    }

    return category
  }

  private async listSiblingCategories(
    parentCategoryId: string | null,
    sharedContext: Context
  ): Promise<ProductCategoryRecord[]> {
    return (await this.productCategoryRepository_.find(
      {
        where: {
          parent_category_id: parentCategoryId,
        },
        options: {
          orderBy: {
            rank: "ASC",
          },
        },
      },
      {},
      sharedContext
    )) as ProductCategoryRecord[]
  }

  private async listAllCategories(
    sharedContext: Context
  ): Promise<ProductCategoryRecord[]> {
    return (await this.productCategoryRepository_.find(
      {
        where: {},
      },
      {},
      sharedContext
    )) as ProductCategoryRecord[]
  }

  private getMutationRepository(): ProductCategoryMutationRepository {
    return this
      .productCategoryRepository_ as unknown as ProductCategoryMutationRepository
  }

  @InjectTransactionManager("productCategoryRepository_")
  // @ts-expect-error
  async softDelete(
    ids: string[],
    @MedusaContext() sharedContext?: Context
  ): Promise<Record<string, string[]> | void> {
    return (await (
      this.productCategoryRepository_ as unknown as ProductCategoryRepository
    ).softDelete(ids, sharedContext)) as any
  }

  @InjectTransactionManager("productCategoryRepository_")
  // @ts-expect-error
  async restore(
    ids: string[],
    @MedusaContext() sharedContext?: Context
  ): Promise<Record<string, string[]> | void> {
    return (await (
      this.productCategoryRepository_ as unknown as ProductCategoryRepository
    ).restore(ids, sharedContext)) as any
  }
}

function getOptionalString(
  value: object,
  key: string
): string | undefined {
  if (!(key in value)) {
    return undefined
  }

  const fieldValue = value[key as keyof typeof value]
  return typeof fieldValue === "string" ? fieldValue : undefined
}

function getParentCategoryId(
  value: object
): string | undefined {
  if (!("parent_category" in value)) {
    return undefined
  }

  const parentCategory = value.parent_category
  if (
    parentCategory &&
    typeof parentCategory === "object" &&
    "id" in parentCategory &&
    typeof parentCategory.id === "string"
  ) {
    return parentCategory.id
  }

  return undefined
}

function getUpdatedParentCategoryId(
  value: UpdateCategoryInput
): string | null | undefined {
  if ("parent_category_id" in value) {
    return value.parent_category_id ?? null
  }

  return getParentCategoryId(value)
}

function compactCategoryUpdate(
  value: UpdateCategoryInput
): Record<string, unknown> {
  const update: Record<string, unknown> = {}

  for (const [key, fieldValue] of Object.entries(value)) {
    if (
      key === "id" ||
      key === "parent_category" ||
      key === "category_children" ||
      !isDefined(fieldValue)
    ) {
      continue
    }

    update[key] = fieldValue
  }

  return update
}

function projectCategory(
  category: ProductCategoryRecord | undefined,
  fields: Set<string>
): ProductCategoryRecord {
  const projected: Partial<ProductCategoryRecord> = {}
  if (!category) {
    return projected as ProductCategoryRecord
  }

  for (const field of fields) {
    if (field in category) {
      Object.assign(projected, {
        [field]: unwrapProjectedValue(
          category[field as keyof ProductCategoryRecord]
        ),
      })
    }
  }

  return projected as ProductCategoryRecord
}

function unwrapProjectedValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => unwrapProjectedEntity(entry))
  }

  const collection = value as {
    isInitialized?: () => boolean
    getItems?: () => unknown[]
  }

  if (
    typeof collection.isInitialized === "function" &&
    typeof collection.getItems === "function"
  ) {
    if (!collection.isInitialized()) {
      return []
    }

    return collection.getItems().map((entry) => unwrapProjectedEntity(entry))
  }

  return unwrapProjectedEntity(value)
}

function unwrapProjectedEntity(value: unknown): unknown {
  if (value == null || typeof value !== "object") {
    return value
  }

  const entity = value as Record<string, unknown>
  if (typeof entity.id !== "string" && typeof entity.id !== "number") {
    return value
  }

  const projected: Record<string, unknown> = {}
  for (const [key, fieldValue] of Object.entries(entity)) {
    if (
      fieldValue == null ||
      typeof fieldValue === "string" ||
      typeof fieldValue === "number" ||
      typeof fieldValue === "boolean"
    ) {
      projected[key] = fieldValue
    }
  }

  return projected
}

function treeScopeWhere(
  where: DAL.FindOptions<typeof ProductCategory>["where"]
): DAL.FindOptions<typeof ProductCategory>["where"] {
  const scopedWhere = { ...where }
  delete scopedWhere.id
  delete scopedWhere.handle
  delete scopedWhere.mpath
  delete scopedWhere.parent_category_id

  return scopedWhere
}
