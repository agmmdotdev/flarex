import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "../types"

type MaybeApplyLinkFilterOptions = {
  entryPoint: string
  resourceId: string
  filterableField: string
  filterByField?: string
}

export function maybeApplyLinkFilter({
  entryPoint,
  resourceId,
  filterableField,
  filterByField = "id",
}: MaybeApplyLinkFilterOptions) {
  return async function linkFilter(
    req: MedusaRequest,
    _: MedusaResponse,
    next: MedusaNextFunction
  ) {
    const filterableFields = req.filterableFields

    if (!filterableFields?.[filterableField]) {
      return next()
    }

    const filterFields = filterableFields[filterableField]

    const idsToFilterBy = Array.isArray(filterFields)
      ? filterFields
      : [filterFields]

    delete filterableFields[filterableField]

    let existingFilters = filterableFields[filterByField] as
      | string[]
      | string
      | undefined

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const filters: Record<string, unknown> = {
      [filterableField]: idsToFilterBy,
    }

    if (existingFilters) {
      filters[resourceId] = existingFilters
    }

    const { data: resources } = await query.graph({
      entity: entryPoint,
      fields: [resourceId],
      filters,
    })

    filterableFields[filterByField] = resources.map(
      (resource: Record<string, unknown>) => resource[resourceId]
    )

    req.filterableFields = transformFilterableFields(filterableFields)

    return next()
  }
}
/*
  Transforms an object key string into nested objects
  before = {
    "test.something.another": []
  }

  after = {
    test: {
      something: {
        another: []
      }
    }
  }
*/
function transformFilterableFields(filterableFields: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(filterableFields)) {
    const value = filterableFields[key]
    const keys = key.split(".")
    let current: Record<string, unknown> = result

    // Iterate over the keys, creating nested objects as needed
    for (let i = 0; i < keys.length; i++) {
      const part = keys[i]
      const existing = current[part]
      if (!isRecord(existing)) {
        current[part] = {}
      }

      if (i === keys.length - 1) {
        // If its the last key, assign the value
        current[part] = value
        break
      }

      current = current[part] as Record<string, unknown>
    }
  }

  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
