/** Storage-independent planning extracted from the pinned native MikroORM
 * repository. Duplicate IDs keep the first scalar write, the last original
 * relation source, and every raw reconstructed response position. */
export function prepareUpsertWithReplaceEntries<
  Source extends Record<string, unknown>,
  Entity extends Record<string, unknown> & { id: string },
>(
  sources: readonly Source[],
  prepare: (source: Source) => { entity: Entity; relations: Record<string, unknown> },
) {
  const reconstructedResponse: Record<string, unknown>[] = []
  const originalDataMap = new Map<string, Source>()
  const toUpsert = sources.map((entry) => {
    const { entity: mainEntity, relations: reconstructedEntry } = prepare(entry)
    reconstructedResponse.push({ ...mainEntity, ...reconstructedEntry })
    originalDataMap.set(mainEntity.id, entry)
    return mainEntity
  })
  return { toUpsert, reconstructedResponse, originalDataMap }
}

export function uniqueUpsertEntries<Entry extends { id: string }>(entries: readonly Entry[]) {
  const uniqueEntriesMap = new Map<string, Entry>()
  const orderedUniqueEntries: Entry[] = []
  entries.forEach((entry) => {
    if (!uniqueEntriesMap.has(entry.id)) {
      uniqueEntriesMap.set(entry.id, entry)
      orderedUniqueEntries.push(entry)
    }
  })
  return orderedUniqueEntries
}

export function planUpsertManyEntries<Entry extends { id: string }>(
  orderedUniqueEntries: readonly Entry[],
  existingEntitiesMap: ReadonlyMap<string, unknown>,
  skipUpdate = false,
) {
  const orderedEntities: Entry[] = []
  const toInsert: Entry[] = []
  const toUpdate: Entry[] = []
  const insertOrderMap = new Map<string, number>()
  const updateOrderMap = new Map<string, number>()
  orderedUniqueEntries.forEach((data, index) => {
    const existingEntity = existingEntitiesMap.get(data.id)
    orderedEntities.push(data)
    if (existingEntity) {
      if (!skipUpdate) {
        toUpdate.push(data)
        updateOrderMap.set(data.id, index)
      }
    } else {
      toInsert.push(data)
      insertOrderMap.set(data.id, index)
    }
  })
  return { orderedEntities, toInsert, toUpdate, insertOrderMap, updateOrderMap }
}

export function planUpsertRelationEntries<Source extends Record<string, unknown>>(
  orderedEntities: readonly { id: string }[],
  originalDataMap: ReadonlyMap<string, Source>,
  reconstructedResponse: readonly Record<string, unknown>[],
  relationName: string,
) {
  return orderedEntities
    .map((entityEntry, i) => {
      const originalEntry = originalDataMap.get(entityEntry.id)!
      return {
        entity: { ...originalEntry, id: entityEntry.id },
        reconstructedEntry: reconstructedResponse[i],
        index: i,
      }
    })
    .filter((item) => item.entity[relationName] !== undefined)
}

export function applyUpsertRelationResults(
  reconstructedResponse: Record<string, unknown>[],
  relationName: string,
  entitiesResults: readonly { entities: unknown; index: number }[],
) {
  entitiesResults.forEach(({ entities: relationEntities, index }) => {
    reconstructedResponse[index]![relationName] = relationEntities
  })
}
