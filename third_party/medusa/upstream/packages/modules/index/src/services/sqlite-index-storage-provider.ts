import type {
  Event,
  IndexTypes,
  QueryGraphFunction,
  RemoteQueryFunction,
  Subscriber,
} from "@medusajs/framework/types"
import {
  CommonEvents,
  ContainerRegistrationKeys,
  isDefined,
} from "@medusajs/framework/utils/portable"
import {
  buildSqliteIndexQueryPlan,
  buildSqliteIndexResultSet,
  readSqliteCount,
  type SqliteIndexRelationNode,
} from "../utils/sqlite-query-builder"

type IndexEntityData = {
  id: string
  [key: string]: unknown
}

type JsonObject = Record<string, unknown>

export type SqliteIndexValue = string | number | null

export type SqliteIndexExecutor = {
  execute(
    sql: string,
    params?: readonly SqliteIndexValue[]
  ): Promise<readonly Record<string, SqliteIndexValue>[]>
}

type SqliteIndexProviderOptions = {
  schemaObjectRepresentation: IndexTypes.SchemaObjectRepresentation
  entityMap: Record<string, unknown>
  executor?: SqliteIndexExecutor
}

type InjectedDependencies = {
  [ContainerRegistrationKeys.QUERY]: RemoteQueryFunction
  sqliteIndexExecutor?: SqliteIndexExecutor
}

type ParsedIndexData = {
  data: IndexEntityData[]
  entityProperties: string[]
  parentsProperties: Record<string, string[]>
}

type IndexDataRow = {
  id: string
  name: string
  data: Record<string, unknown>
  staled_at: null
}

type IndexRelationRow = {
  pivot: string
  parent_name: string
  parent_id: string
  child_name: string
  child_id: string
  staled_at: null
}

type ParsedMessageData = {
  action: string
  data: IndexEntityData[]
  ids: string[]
}

type RelationRow = {
  parent_id: string
  child_id: string
  child_name: string
}

export class SqliteIndexStorageProvider implements IndexTypes.StorageProvider {
  protected readonly query_: RemoteQueryFunction
  protected readonly executor_: SqliteIndexExecutor
  protected readonly schemaObjectRepresentation_: IndexTypes.SchemaObjectRepresentation
  protected readonly schemaEntitiesMap_: Record<string, unknown>

  protected readonly eventActionToMethodMap_ = {
    created: "onCreate",
    updated: "onUpdate",
    deleted: "onDelete",
    attached: "onAttach",
    detached: "onDetach",
  } as const

  constructor(
    container: InjectedDependencies,
    options: SqliteIndexProviderOptions
  ) {
    const executor = options.executor ?? container.sqliteIndexExecutor

    if (!executor) {
      throw new Error("SQLite Index storage provider requires a SQL executor")
    }

    this.query_ = container[ContainerRegistrationKeys.QUERY]
    this.executor_ = executor
    this.schemaObjectRepresentation_ = options.schemaObjectRepresentation
    this.schemaEntitiesMap_ = options.entityMap
  }

  async onApplicationStart(): Promise<void> {
    await this.executor_.execute(`
      CREATE TABLE IF NOT EXISTS index_data (
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        staled_at TEXT,
        PRIMARY KEY (id, name)
      )
    `)

    await this.executor_.execute(`
      CREATE TABLE IF NOT EXISTS index_relation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pivot TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        child_name TEXT NOT NULL,
        child_id TEXT NOT NULL,
        staled_at TEXT,
        UNIQUE (pivot, parent_id, child_id, parent_name, child_name)
      )
    `)
  }

  async query<const TEntry extends string>(
    config: IndexTypes.IndexQueryConfig<TEntry>
  ): Promise<IndexTypes.QueryResultSet<TEntry>> {
    const plan = buildSqliteIndexQueryPlan(
      config,
      this.schemaObjectRepresentation_
    )
    const [rows, countRows] = await Promise.all([
      this.executor_.execute(plan.sql, plan.params),
      plan.countSql
        ? this.executor_.execute(plan.countSql, plan.countParams)
        : Promise.resolve(undefined),
    ])

    const idsOnly = config.idsOnly ?? false
    const data = buildSqliteIndexResultSet(rows, false)

    await this.hydrateRelations_(
      plan.rootEntity,
      data,
      plan.relationTree,
      false
    )

    const searchFilteredData = this.applySearchFilter_(data, plan.searchQuery)
    const filteredData = this.applyNestedFilters_(
      searchFilteredData,
      config.filters,
      plan.rootKey
    )
    this.applyJoinFilters_(filteredData, config.joinFilters)
    this.applyNestedOrder_(filteredData, config.pagination?.order, plan.rootKey)
    const paginatedData = plan.deferredPagination
      ? filteredData.slice(
          plan.deferredPagination.skip,
          plan.deferredPagination.skip + plan.deferredPagination.take
        )
      : filteredData
    const resultData = this.projectResultRows_(
      paginatedData,
      plan.outputRelationTree,
      idsOnly,
      plan.rootFields
    )
    const estimateCount = plan.deferredPagination
      ? filteredData.length
      : countRows
      ? readSqliteCount(countRows)
      : 0

    return {
      data: resultData as IndexTypes.QueryResultSet<TEntry>["data"],
      metadata:
        config.pagination?.take === undefined
          ? undefined
          : {
              estimate_count: estimateCount,
              skip: config.pagination.skip ?? 0,
              take: config.pagination.take,
            },
    }
  }

  consumeEvent(
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  ): Subscriber<{ id: string | string[] }> {
    return async (event: Event): Promise<void> => {
      const data = this.normalizeEventData_(event.data)
      let ids = data.flatMap((entry) =>
        Array.isArray(entry.id) ? entry.id : [entry.id]
      )
      let action = event.name.split(".").pop() ?? ""

      const parsedMessage = SqliteIndexStorageProvider.parseMessageData(event)
      if (parsedMessage) {
        action = parsedMessage.action
        ids = parsedMessage.ids
      }

      const targetMethod = this.eventActionToMethodMap_[
        action as keyof typeof this.eventActionToMethodMap_
      ]

      if (!targetMethod) {
        return
      }

      const { fields, alias } = schemaEntityObjectRepresentation
      const withDeleted =
        action === CommonEvents.DELETED || action === CommonEvents.DETACHED
          ? true
          : undefined

      for (const idsBatch of this.chunkIds_(ids, 100)) {
        const graphConfig: Parameters<QueryGraphFunction>[0] = {
          entity: alias,
          filters: {
            id: idsBatch,
          },
          fields: [...new Set(["id", ...fields])],
          withDeleted,
        }

        const { data: entityData } = await this.query_.graph(graphConfig)

        await this[targetMethod]({
          entity: schemaEntityObjectRepresentation.entity,
          data: entityData,
          schemaEntityObjectRepresentation,
        })
      }
    }
  }

  async onCreate({
    entity,
    data,
    schemaEntityObjectRepresentation,
  }: {
    entity: string
    data: IndexEntityData | IndexEntityData[]
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  }): Promise<void> {
    const parsed = SqliteIndexStorageProvider.parseData(
      data,
      schemaEntityObjectRepresentation
    )

    const dataRows = this.buildIndexDataRows_(entity, parsed)
    const relationRows = this.buildParentRelationRows_(
      entity,
      parsed,
      schemaEntityObjectRepresentation
    )

    await this.upsertIndexData_(dataRows)
    await this.upsertIndexRelations_(relationRows)
  }

  async onUpdate({
    entity,
    data,
    schemaEntityObjectRepresentation,
  }: {
    entity: string
    data: IndexEntityData | IndexEntityData[]
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  }): Promise<void> {
    const parsed = SqliteIndexStorageProvider.parseData(
      data,
      schemaEntityObjectRepresentation
    )

    await this.upsertIndexData_(this.buildIndexDataRows_(entity, parsed))
  }

  async onDelete({
    entity,
    data,
    schemaEntityObjectRepresentation,
  }: {
    entity: string
    data: IndexEntityData | IndexEntityData[]
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  }): Promise<void> {
    const { data: parsedData } = SqliteIndexStorageProvider.parseData(
      data,
      schemaEntityObjectRepresentation
    )

    await this.deleteByEntityIds_(
      entity,
      parsedData.map((entry) => entry.id)
    )
  }

  async onAttach({
    entity,
    data,
    schemaEntityObjectRepresentation,
  }: {
    entity: string
    data: IndexEntityData | IndexEntityData[]
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  }): Promise<void> {
    const parsed = SqliteIndexStorageProvider.parseData(
      data,
      schemaEntityObjectRepresentation
    )
    const relationRows = this.buildAttachRelationRows_(
      entity,
      parsed,
      schemaEntityObjectRepresentation
    )

    await this.upsertIndexData_(this.buildIndexDataRows_(entity, parsed))
    await this.upsertIndexRelations_(relationRows)
  }

  async onDetach({
    entity,
    data,
    schemaEntityObjectRepresentation,
  }: {
    entity: string
    data: IndexEntityData | IndexEntityData[]
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  }): Promise<void> {
    await this.onDelete({ entity, data, schemaEntityObjectRepresentation })
  }

  protected static parseData(
    data: IndexEntityData | IndexEntityData[],
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  ): ParsedIndexData {
    const data_ = Array.isArray(data) ? data : [data]
    const entityProperties = ["id"]
    const parentsProperties: Record<string, string[]> = {}

    for (const field of schemaEntityObjectRepresentation.fields) {
      if (field.includes(".")) {
        const parentAlias = field.split(".")[0]
        const parentSchemaObjectRepresentation =
          schemaEntityObjectRepresentation.parents.find(
            (parent) => parent.inverseSideProp === parentAlias
          )

        if (!parentSchemaObjectRepresentation) {
          throw new Error(
            `IndexModule error, unable to parse data for ${schemaEntityObjectRepresentation.entity}. The parent schema object representation could not be found for the alias ${parentAlias} for the entity ${schemaEntityObjectRepresentation.entity}.`
          )
        }

        parentsProperties[parentSchemaObjectRepresentation.ref.entity] ??= []
        parentsProperties[parentSchemaObjectRepresentation.ref.entity].push(
          field
        )
      } else {
        entityProperties.push(field)
      }
    }

    return {
      data: data_,
      entityProperties,
      parentsProperties,
    }
  }

  protected static parseMessageData(message?: Event): ParsedMessageData | void {
    const metadata = message?.metadata

    if (!message || !metadata || !isDefined(message.data) || !isDefined(metadata.action)) {
      return
    }

    const data = SqliteIndexStorageProvider.normalizeMessageData_(message.data)

    return {
      action: String(metadata.action),
      data,
      ids: data.flatMap((entry) =>
        Array.isArray(entry.id) ? entry.id : [entry.id]
      ),
    }
  }

  private static normalizeMessageData_(data: unknown): IndexEntityData[] {
    const entries = Array.isArray(data) ? data : [data]

    return entries.map((entry) => {
      if (!SqliteIndexStorageProvider.isIndexEntityData_(entry)) {
        throw new Error("Index event data requires an id")
      }

      return entry
    })
  }

  private static isIndexEntityData_(value: unknown): value is IndexEntityData {
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      typeof value.id === "string"
    )
  }

  private normalizeEventData_(data: unknown): IndexEntityData[] {
    return SqliteIndexStorageProvider.normalizeMessageData_(data)
  }

  private chunkIds_(
    ids: readonly string[],
    chunkSize: number
  ): readonly string[][] {
    const chunks: string[][] = []

    for (let index = 0; index < ids.length; index += chunkSize) {
      chunks.push(ids.slice(index, index + chunkSize))
    }

    return chunks
  }

  private buildIndexDataRows_(
    entity: string,
    parsed: ParsedIndexData
  ): IndexDataRow[] {
    return parsed.data.map((entityData) => {
      const data = parsed.entityProperties.reduce<Record<string, unknown>>(
        (accumulator, property) => {
          accumulator[property] = entityData[property]
          return accumulator
        },
        {}
      )

      return {
        id: entityData.id,
        name: entity,
        data,
        staled_at: null,
      }
    })
  }

  private buildParentRelationRows_(
    entity: string,
    parsed: ParsedIndexData,
    _schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  ): IndexRelationRow[] {
    const relations = new Map<string, IndexRelationRow>()

    parsed.data.forEach((entityData, index) => {
      for (const [parentEntity, parentProperties] of Object.entries(
        parsed.parentsProperties
      )) {
        const parentAlias = parentProperties[0]?.split(".")[0]

        if (!parentAlias) {
          continue
        }

        const parentData = parsed.data[index]?.[parentAlias]

        if (!parentData) {
          continue
        }

        const parentDataCollection = Array.isArray(parentData)
          ? parentData
          : [parentData]

        for (const parent of parentDataCollection) {
          if (!SqliteIndexStorageProvider.isIndexEntityData_(parent)) {
            continue
          }

          const relation = {
            parent_id: parent.id,
            parent_name: parentEntity,
            child_id: entityData.id,
            child_name: entity,
            pivot: `${parentEntity}-${entity}`,
            staled_at: null,
          } satisfies IndexRelationRow

          relations.set(this.relationKey_(relation), relation)
        }
      }
    })

    return [...relations.values()]
  }

  private buildAttachRelationRows_(
    entity: string,
    parsed: ParsedIndexData,
    schemaEntityObjectRepresentation: IndexTypes.SchemaObjectEntityRepresentation
  ): IndexRelationRow[] {
    const [parentRelationship, childRelationship] =
      schemaEntityObjectRepresentation.moduleConfig.relationships ?? []

    if (!parentRelationship || !childRelationship) {
      throw new Error(
        `IndexModule error, unable to handle attach event for ${entity}. The link entity must have parent and child relationships.`
      )
    }

    const parentEntityName = this.resolveLinkedEntityName_(
      parentRelationship.serviceName,
      parentRelationship.foreignKey,
      "parent",
      entity
    )
    const childEntityName = this.resolveLinkedEntityName_(
      childRelationship.serviceName,
      childRelationship.foreignKey,
      "child",
      entity
    )

    return parsed.data.flatMap((entityData) => [
      {
        parent_id: this.requireStringProperty_(
          entityData,
          parentRelationship.foreignKey,
          entity
        ),
        parent_name: parentEntityName,
        child_id: entityData.id,
        child_name: entity,
        pivot: `${parentEntityName}-${entity}`,
        staled_at: null,
      },
      {
        parent_id: entityData.id,
        parent_name: entity,
        child_id: this.requireStringProperty_(
          entityData,
          childRelationship.foreignKey,
          entity
        ),
        child_name: childEntityName,
        pivot: `${entity}-${childEntityName}`,
        staled_at: null,
      },
    ])
  }

  private resolveLinkedEntityName_(
    serviceName: string,
    foreignKey: string,
    position: "parent" | "child",
    entity: string
  ): string {
    const serviceConfig =
      this.schemaObjectRepresentation_._serviceNameModuleConfigMap[serviceName]

    const linkedEntityName = serviceConfig?.linkableKeys?.[foreignKey]

    if (!linkedEntityName) {
      throw new Error(
        `IndexModule error, unable to handle attach event for ${entity}. The ${position} entity name could not be found using the linkable keys from the module ${serviceName}.`
      )
    }

    return linkedEntityName
  }

  private requireStringProperty_(
    entityData: IndexEntityData,
    property: string,
    entity: string
  ): string {
    const value = entityData[property]

    if (typeof value !== "string") {
      throw new Error(
        `IndexModule error, unable to handle attach event for ${entity}. The property ${property} must be a string.`
      )
    }

    return value
  }

  private async upsertIndexData_(rows: readonly IndexDataRow[]): Promise<void> {
    for (const row of rows) {
      await this.executor_.execute(
        `
          INSERT INTO index_data (id, name, data, staled_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id, name) DO UPDATE SET
            data = excluded.data,
            staled_at = excluded.staled_at
        `,
        [row.id, row.name, JSON.stringify(row.data), row.staled_at]
      )
    }
  }

  private async upsertIndexRelations_(
    rows: readonly IndexRelationRow[]
  ): Promise<void> {
    for (const row of rows) {
      await this.executor_.execute(
        `
          INSERT INTO index_relation (
            pivot,
            parent_name,
            parent_id,
            child_name,
            child_id,
            staled_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(pivot, parent_id, child_id, parent_name, child_name)
          DO UPDATE SET staled_at = excluded.staled_at
        `,
        [
          row.pivot,
          row.parent_name,
          row.parent_id,
          row.child_name,
          row.child_id,
          row.staled_at,
        ]
      )
    }
  }

  private async deleteByEntityIds_(
    entity: string,
    ids: readonly string[]
  ): Promise<void> {
    if (!ids.length) {
      return
    }

    const placeholders = ids.map(() => "?").join(", ")

    await this.executor_.execute(
      `DELETE FROM index_data WHERE name = ? AND id IN (${placeholders})`,
      [entity, ...ids]
    )

    await this.executor_.execute(
      `
        DELETE FROM index_relation
        WHERE (parent_name = ? AND parent_id IN (${placeholders}))
           OR (child_name = ? AND child_id IN (${placeholders}))
      `,
      [entity, ...ids, entity, ...ids]
    )
  }

  private relationKey_(row: IndexRelationRow): string {
    return [
      row.pivot,
      row.parent_id,
      row.child_id,
      row.parent_name,
      row.child_name,
    ].join(":")
  }

  private async hydrateRelations_(
    parentEntity: string,
    parents: JsonObject[],
    relationTree: readonly SqliteIndexRelationNode[],
    idsOnly: boolean
  ): Promise<void> {
    if (!parents.length || !relationTree.length) {
      return
    }

    for (const relationNode of relationTree) {
      const childrenByParentId = await this.loadDescendantRows_(
        parentEntity,
        parents,
        relationNode.entity,
        idsOnly
      )
      const allChildren: JsonObject[] = []

      for (const parent of parents) {
        const parentId = this.readObjectId_(parent)
        const children = childrenByParentId.get(parentId) ?? []

        parent[relationNode.property] = relationNode.isList
          ? children
          : children[0] ?? null
        allChildren.push(...children)
      }

      await this.hydrateRelations_(
        relationNode.entity,
        allChildren,
        relationNode.children,
        idsOnly
      )
    }
  }

  private async loadDescendantRows_(
    parentEntity: string,
    parents: readonly JsonObject[],
    targetEntity: string,
    idsOnly: boolean
  ): Promise<Map<string, JsonObject[]>> {
    const parentIds = parents.map((parent) => this.readObjectId_(parent))
    const foundTargetIdsByParentId = new Map<string, string[]>()
    let frontier = parentIds.map((id) => ({
      entity: parentEntity,
      id,
      originParentId: id,
    }))
    const visited = new Set<string>()

    for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
      const nextFrontier: typeof frontier = []
      const frontierByEntity = this.groupFrontierByEntity_(frontier)

      for (const [entity, entries] of frontierByEntity) {
        const relationRows = await this.selectRelations_(
          entity,
          entries.map((entry) => entry.id)
        )
        const originsById = new Map(
          entries.map((entry) => [entry.id, entry.originParentId])
        )

        for (const relationRow of relationRows) {
          const originParentId = originsById.get(relationRow.parent_id)

          if (!originParentId) {
            continue
          }

          if (relationRow.child_name === targetEntity) {
            const targetIds =
              foundTargetIdsByParentId.get(originParentId) ?? []
            targetIds.push(relationRow.child_id)
            foundTargetIdsByParentId.set(originParentId, targetIds)
            continue
          }

          const visitedKey = [
            originParentId,
            relationRow.child_name,
            relationRow.child_id,
          ].join(":")

          if (visited.has(visitedKey)) {
            continue
          }

          visited.add(visitedKey)
          nextFrontier.push({
            entity: relationRow.child_name,
            id: relationRow.child_id,
            originParentId,
          })
        }
      }

      frontier = nextFrontier
    }

    const targetIds = [
      ...new Set([...foundTargetIdsByParentId.values()].flat()),
    ]
    const targetRowsById = await this.selectIndexDataByIds_(
      targetEntity,
      targetIds,
      idsOnly
    )
    const result = new Map<string, JsonObject[]>()

    for (const [parentId, childIds] of foundTargetIdsByParentId) {
      result.set(
        parentId,
        childIds
          .map((childId) => targetRowsById.get(childId))
          .filter((row): row is JsonObject => row !== undefined)
      )
    }

    return result
  }

  private async selectRelations_(
    parentEntity: string,
    parentIds: readonly string[]
  ): Promise<RelationRow[]> {
    if (!parentIds.length) {
      return []
    }

    const placeholders = parentIds.map(() => "?").join(", ")
    const rows = await this.executor_.execute(
      `
        SELECT parent_id, child_id, child_name
        FROM index_relation
        WHERE parent_name = ? AND parent_id IN (${placeholders})
      `,
      [parentEntity, ...parentIds]
    )

    return rows.map((row) => ({
      parent_id: this.readStringColumn_(row, "parent_id"),
      child_id: this.readStringColumn_(row, "child_id"),
      child_name: this.readStringColumn_(row, "child_name"),
    }))
  }

  private async selectIndexDataByIds_(
    entity: string,
    ids: readonly string[],
    idsOnly: boolean
  ): Promise<Map<string, JsonObject>> {
    if (!ids.length) {
      return new Map()
    }

    const placeholders = ids.map(() => "?").join(", ")
    const rows = await this.executor_.execute(
      `
        SELECT id, data
        FROM index_data
        WHERE name = ? AND id IN (${placeholders})
      `,
      [entity, ...ids]
    )
    const result = new Map<string, JsonObject>()

    for (const row of rows) {
      const id = this.readStringColumn_(row, "id")

      result.set(id, idsOnly ? { id } : this.parseDataRow_(row, id))
    }

    return result
  }

  private groupFrontierByEntity_(
    frontier: readonly {
      entity: string
      id: string
      originParentId: string
    }[]
  ): Map<
    string,
    {
      entity: string
      id: string
      originParentId: string
    }[]
  > {
    const result = new Map<
      string,
      {
        entity: string
        id: string
        originParentId: string
      }[]
    >()

    for (const entry of frontier) {
      const entries = result.get(entry.entity) ?? []
      entries.push(entry)
      result.set(entry.entity, entries)
    }

    return result
  }

  private readObjectId_(value: JsonObject): string {
    const id = value.id

    if (typeof id !== "string") {
      throw new Error("SQLite Index relation hydration requires string ids")
    }

    return id
  }

  private parseDataRow_(
    row: Record<string, SqliteIndexValue>,
    fallbackId: string
  ): JsonObject {
    const data = row.data

    if (typeof data !== "string") {
      return { id: fallbackId }
    }

    const parsed = JSON.parse(data) as unknown

    if (!this.isJsonObject_(parsed)) {
      return { id: fallbackId }
    }

    return parsed
  }

  private readStringColumn_(
    row: Record<string, SqliteIndexValue>,
    column: string
  ): string {
    const value = row[column]

    if (typeof value !== "string") {
      throw new Error(`SQLite Index expected string column ${column}`)
    }

    return value
  }

  private isJsonObject_(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  private applyNestedFilters_(
    rows: JsonObject[],
    filters: unknown,
    rootKey: string
  ): JsonObject[] {
    const rootFilter = this.readObjectProperty_(filters, rootKey)

    if (!this.isJsonObject_(rootFilter)) {
      return rows
    }

    return rows.filter((row) => this.matchesObjectFilter_(row, rootFilter))
  }

  private applySearchFilter_(
    rows: JsonObject[],
    searchQuery: string | undefined
  ): JsonObject[] {
    if (!searchQuery) {
      return rows
    }

    const searchTerms = searchQuery
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean)

    if (!searchTerms.length) {
      return rows
    }

    return rows.filter((row) => {
      const searchableText = this.collectSearchableText_(row)
      return searchTerms.every((term) => searchableText.includes(term))
    })
  }

  private applyJoinFilters_(rows: JsonObject[], joinFilters: unknown): void {
    if (!this.isJsonObject_(joinFilters)) {
      return
    }

    for (const [path, filter] of Object.entries(joinFilters)) {
      const parts = path.split(".").filter(Boolean)

      if (parts.length < 3) {
        continue
      }

      this.prunePathByFilter_(rows, parts.slice(1), filter, false)
    }
  }

  private applyNestedOrder_(
    rows: JsonObject[],
    order: unknown,
    rootKey: string
  ): void {
    const rootOrder = this.readObjectProperty_(order, rootKey)

    if (!this.isJsonObject_(rootOrder)) {
      return
    }

    this.sortRowsByOrder_(rows, rootOrder)
  }

  private matchesObjectFilter_(row: JsonObject, filter: JsonObject): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (key === "q") {
        continue
      }

      if (key === "$and" && Array.isArray(value)) {
        if (
          !value.every(
            (entry) =>
              this.isJsonObject_(entry) && this.matchesObjectFilter_(row, entry)
          )
        ) {
          return false
        }
        continue
      }

      if (key === "$or" && Array.isArray(value)) {
        if (
          !value.some(
            (entry) =>
              this.isJsonObject_(entry) && this.matchesObjectFilter_(row, entry)
          )
        ) {
          return false
        }
        continue
      }

      if (key === "$not") {
        const entries = Array.isArray(value) ? value : [value]
        if (
          entries.some(
            (entry) =>
              this.isJsonObject_(entry) && this.matchesObjectFilter_(row, entry)
          )
        ) {
          return false
        }
        continue
      }

      if (this.isOperatorFilter_(value)) {
        if (!this.matchesScalarFilter_(row[key], value)) {
          return false
        }
        continue
      }

      if (this.isJsonObject_(value)) {
        const childValue = row[key]

        if (Array.isArray(childValue)) {
          const filteredChildren = childValue.filter(
            (entry): entry is JsonObject =>
              this.isJsonObject_(entry) &&
              this.matchesObjectFilter_(entry, value)
          )
          row[key] = filteredChildren

          if (
            !filteredChildren.length &&
            !this.isRelationAbsencePassingFilter_(value)
          ) {
            return false
          }
          continue
        }

        if (
          !this.isJsonObject_(childValue) ||
          !this.matchesObjectFilter_(childValue, value)
        ) {
          return false
        }
        continue
      }

      if (
        !this.matchesScalarFilter_(
          row[key],
          this.normalizeOperatorFilter_(value)
        )
      ) {
        return false
      }
    }

    return true
  }

  private prunePathByFilter_(
    rows: JsonObject[],
    pathParts: readonly string[],
    filter: unknown,
    removeEmptyParents: boolean
  ): void {
    const [property, ...remainingPath] = pathParts

    if (!property) {
      return
    }

    for (const row of rows) {
      const childValue = row[property]

      if (!Array.isArray(childValue)) {
        continue
      }

      if (!remainingPath.length) {
        row[property] = childValue.filter(
          (entry): entry is JsonObject =>
            this.isJsonObject_(entry) &&
            this.matchesScalarFilter_(entry, this.normalizeOperatorFilter_(filter))
        )
        continue
      }

      if (remainingPath.length === 1) {
        const field = remainingPath[0]
        const operatorFilter = this.normalizeOperatorFilter_(filter)
        row[property] = childValue.filter(
          (entry): entry is JsonObject =>
            this.isJsonObject_(entry) &&
            this.matchesScalarFilter_(entry[field], operatorFilter)
        )
      } else {
        const childRows = childValue.filter(this.isJsonObject_, this)
        this.prunePathByFilter_(
          childRows,
          remainingPath,
          filter,
          removeEmptyParents
        )
        row[property] = removeEmptyParents
          ? childRows.filter((child) =>
              Array.isArray(child[remainingPath[0]]) &&
              (child[remainingPath[0]] as unknown[]).length > 0
            )
          : childRows
      }
    }
  }

  private sortRowsByOrder_(
    rows: JsonObject[],
    order: JsonObject
  ): unknown | undefined {
    for (const [key, value] of Object.entries(order)) {
      if (value === "ASC" || value === "DESC" || value === 1 || value === -1) {
        const direction = value === "DESC" || value === -1 ? "DESC" : "ASC"
        rows.sort((left, right) =>
          this.compareValues_(left[key], right[key], direction)
        )
        return rows[0]?.[key]
      }

      if (!this.isJsonObject_(value)) {
        continue
      }

      const aggregateByRow = new Map<JsonObject, unknown>()

      for (const row of rows) {
        const childValue = row[key]

        if (!Array.isArray(childValue)) {
          aggregateByRow.set(row, undefined)
          continue
        }

        const childRows = childValue.filter(this.isJsonObject_, this)
        const aggregateValue = this.sortRowsByOrder_(childRows, value)
        row[key] = childRows
        aggregateByRow.set(row, aggregateValue)
      }

      const direction = this.findFirstDirection_(value) ?? "ASC"
      rows.sort((left, right) =>
        this.compareValues_(
          aggregateByRow.get(left),
          aggregateByRow.get(right),
          direction
        )
      )

      return aggregateByRow.get(rows[0]!)
    }

    return undefined
  }

  private findFirstDirection_(order: JsonObject): "ASC" | "DESC" | undefined {
    for (const value of Object.values(order)) {
      if (value === "ASC" || value === 1) {
        return "ASC"
      }

      if (value === "DESC" || value === -1) {
        return "DESC"
      }

      if (this.isJsonObject_(value)) {
        const nestedDirection = this.findFirstDirection_(value)

        if (nestedDirection) {
          return nestedDirection
        }
      }
    }

    return undefined
  }

  private compareValues_(
    left: unknown,
    right: unknown,
    direction: "ASC" | "DESC"
  ): number {
    if (left === undefined && right === undefined) {
      return 0
    }

    if (left === undefined) {
      return direction === "DESC" ? -1 : 1
    }

    if (right === undefined) {
      return direction === "DESC" ? 1 : -1
    }

    if (typeof left === "number" && typeof right === "number") {
      return direction === "DESC" ? right - left : left - right
    }

    const comparison = String(left).localeCompare(String(right))
    return direction === "DESC" ? -comparison : comparison
  }

  private normalizeOperatorFilter_(filter: unknown): JsonObject {
    if (this.isOperatorFilter_(filter)) {
      return filter
    }

    return Array.isArray(filter) ? { $in: filter } : { $eq: filter }
  }

  private isOperatorFilter_(value: unknown): value is JsonObject {
    if (!this.isJsonObject_(value)) {
      return false
    }

    return Object.keys(value).some((key) => key.startsWith("$"))
  }

  private isRelationAbsencePassingFilter_(value: unknown): boolean {
    if (!this.isJsonObject_(value)) {
      return false
    }

    const entries = Object.entries(value)

    if (!entries.length) {
      return false
    }

    return entries.every(([key, entry]) => {
      if (key === "$nin") {
        return true
      }

      if (key.startsWith("$")) {
        return false
      }

      return (
        this.isJsonObject_(entry) &&
        this.isRelationAbsencePassingFilter_(entry)
      )
    })
  }

  private matchesScalarFilter_(value: unknown, filter: JsonObject): boolean {
    for (const [operator, expected] of Object.entries(filter)) {
      if (!this.matchesScalarOperator_(value, operator, expected)) {
        return false
      }
    }

    return true
  }

  private matchesScalarOperator_(
    value: unknown,
    operator: string,
    expected: unknown
  ): boolean {
    switch (operator) {
      case "$eq":
        return value === expected
      case "$ne":
        return value !== expected
      case "$gt":
        return this.compareScalar_(value, expected) > 0
      case "$gte":
        return this.compareScalar_(value, expected) >= 0
      case "$lt":
        return this.compareScalar_(value, expected) < 0
      case "$lte":
        return this.compareScalar_(value, expected) <= 0
      case "$in":
        return Array.isArray(expected) && expected.includes(value)
      case "$nin":
        return Array.isArray(expected) && !expected.includes(value)
      case "$like":
        return this.matchesLike_(value, expected, false)
      case "$ilike":
        return this.matchesLike_(value, expected, true)
      case "$not":
        return (
          this.isJsonObject_(expected) &&
          !this.matchesScalarFilter_(value, expected)
        )
      default:
        throw new Error(`SQLite Index nested filter does not support ${operator}`)
    }
  }

  private compareScalar_(left: unknown, right: unknown): number {
    if (typeof left === "number" && typeof right === "number") {
      return left - right
    }

    return String(left).localeCompare(String(right))
  }

  private matchesLike_(
    value: unknown,
    expected: unknown,
    caseInsensitive: boolean
  ): boolean {
    if (typeof value !== "string" || typeof expected !== "string") {
      return false
    }

    const escaped = expected.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(
      `^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`,
      caseInsensitive ? "i" : undefined
    )

    return regex.test(value)
  }

  private collectSearchableText_(row: JsonObject): string {
    const values: string[] = []

    for (const value of Object.values(row)) {
      if (typeof value === "string") {
        values.push(value)
      }
    }

    return values.join(" ").toLocaleLowerCase()
  }

  private readObjectProperty_(value: unknown, property: string): unknown {
    if (!this.isJsonObject_(value)) {
      return undefined
    }

    return value[property]
  }

  private projectResultRows_(
    rows: readonly JsonObject[],
    relationTree: readonly SqliteIndexRelationNode[],
    idsOnly: boolean,
    scalarFields?: readonly string[]
  ): JsonObject[] {
    return rows.map((row) => {
      const projected: JsonObject = idsOnly
        ? { id: this.readObjectId_(row) }
        : this.copyScalarProperties_(row, scalarFields)

      for (const relationNode of relationTree) {
        const value = row[relationNode.property]

        if (relationNode.isList) {
          const children = Array.isArray(value)
            ? value.filter((child): child is JsonObject =>
                this.isJsonObject_(child)
              )
            : []

          projected[relationNode.property] = this.projectResultRows_(
            children,
            relationNode.children,
            idsOnly
          )
          continue
        }

        const child = this.isJsonObject_(value) ? value : undefined

        projected[relationNode.property] = child
          ? this.projectResultRows_(
              [child],
              relationNode.children,
              idsOnly
            )[0] ?? null
          : null
      }

      return projected
    })
  }

  private copyScalarProperties_(
    row: JsonObject,
    scalarFields?: readonly string[]
  ): JsonObject {
    const projected: JsonObject = {}
    const allowedFields = scalarFields ? new Set(scalarFields) : undefined

    for (const [key, value] of Object.entries(row)) {
      if (Array.isArray(value)) {
        continue
      }

      if (allowedFields && !allowedFields.has(key)) {
        continue
      }

      projected[key] = value
    }

    return projected
  }
}
