import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import type { MedusaRequest } from "../types"

type RefetchInput = {
  entity: string
  idOrFilter?: string | object
  scope: MedusaRequest["scope"]
  fields?: string[]
  pagination?: MedusaRequest["queryConfig"]["pagination"]
  withDeleted?: boolean
  options?: unknown
}
/** Native graph reads may contain no rows; metadata is present for list reads. */
export type RefetchGraphQuery<TEntity> = {
  graph(input: {
    entity: string
    fields: string[]
    filters: object | undefined
    pagination: RefetchInput["pagination"]
    withDeleted: boolean | undefined
    context: unknown
  }, options?: unknown): Promise<{ data: TEntity[]; metadata?: { count?: number; skip?: number; take?: number } }>
}

/** Selected pinned refetch helpers; the confined graph binding owns result validity. */
export async function refetchEntities<TEntity = unknown>({ entity, idOrFilter, scope, fields, pagination, withDeleted, options }: RefetchInput) {
  const query = scope.resolve<RefetchGraphQuery<TEntity>>(ContainerRegistrationKeys.QUERY)
  let filters = typeof idOrFilter === "string" ? { id: idOrFilter } : idOrFilter
  let context: unknown
  if (filters && "context" in filters) {
    const { context: context_, ...rest } = filters
    if (context_) context = context_
    filters = rest
  }
  const result = await query.graph({ entity, fields: fields ?? [], filters, pagination, withDeleted, context }, options)
  return { data: result.data, metadata: result.metadata ?? {} }
}

export async function refetchEntity<TEntity = unknown>(input: RefetchInput & { idOrFilter: string | object; fields: string[] }): Promise<TEntity | undefined> {
  const { data } = await refetchEntities<TEntity>(input)
  return Array.isArray(data) ? data[0] : data
}
