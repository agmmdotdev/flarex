import { isPresent } from "../common/is-present"
import { mergeMetadata } from "../common/merge-metadata"

export function prepareUpdateMetadata<TEntity, TUpdate>(
  toUpdateData: readonly { entity: TEntity; update: TUpdate }[]
): void {
  toUpdateData.forEach(({ entity, update }) => {
    const update_ = update as (typeof toUpdateData)[number]["update"] & {
      metadata: Record<string, unknown>
    }
    const entity_ = entity as TEntity & {
      metadata?: Record<string, unknown>
    }

    if (isPresent(update_.metadata)) {
      entity_.metadata = update_.metadata = mergeMetadata(
        entity_.metadata ?? {},
        update_.metadata
      )
    }
  })
}
