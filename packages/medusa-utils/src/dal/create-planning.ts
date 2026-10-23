/** The native create seam must normalize every raw position before persisting.
 * Identity belongs to that normalizer: this planner only records returned
 * object references and their original response positions. */
export function planCreateBatch<Source, Entity extends object>(
  sources: readonly Source[],
  create: (source: Source, index: number) => Entity,
) {
  const entities: Entity[] = []
  const positions: number[] = []
  const indexes = new Map<Entity, number>()
  const created = sources.map((source, index) => {
    const entity = create(source, index)
    let position = indexes.get(entity)
    if (position === undefined) {
      position = entities.length
      indexes.set(entity, position)
      entities.push(entity)
    }
    positions.push(position)
    return entity
  })
  return { entities, positions, created }
}

/** Characterized new flat scalar create subset of MikroORM EntityFactory's
 * nullish hydration. IDs must already be generated and inputs captured by the
 * caller. The first non-null scalar/FK/whole JSON value wins; omitted/null fields
 * can fill from later aliases before storage applies defaults and timestamps.
 * This is not MikroORM graph normalization or a cross-call identity map. */
export function planScalarCreateBatch<Entity extends Record<string, unknown> & { id: string }>(
  sources: readonly Entity[],
) {
  const identities = new Map<string, Entity>()
  return planCreateBatch(sources, source => {
    const canonical = identities.get(source.id)
    if (canonical === undefined) {
      const entity = { ...source }
      identities.set(source.id, entity)
      return entity
    }
    Object.assign(canonical, Object.fromEntries(Object.entries(source).filter(
      ([name, value]) => canonical[name] == null && value != null,
    )))
    return canonical
  })
}
