import { buildOrder } from "@medusajs/utils/common/build-query"
import { isDefined } from "@medusajs/utils/common/is-defined"
import { isPresent } from "@medusajs/utils/common/is-present"
import { MedusaError } from "@medusajs/utils/common/errors"
import { stringToSelectRelationObject } from "@medusajs/utils/common/string-to-select-relation-object"
import type { DecodedQueryFields, MedusaRequest, QueryConfig } from "../types"
import { FieldParser } from "./field-parser"

export async function prepareListQuery<T extends DecodedQueryFields>(
  validated: T,
  queryConfig: QueryConfig & { restricted?: string[] } = {},
  req?: MedusaRequest
) {
  let {
    allowed = [],
    restricted = [],
    defaults = [],
    defaultLimit = 50,
    isList,
    entity,
  } = queryConfig
  const {
    order,
    fields,
    limit = defaultLimit,
    offset = 0,
    with_deleted,
  } = validated

  const parsedFields = FieldParser.parse(fields, defaults as string[])
  const { fields: allFields, starFields } = parsedFields

  // RBAC is not part of the selected private Currency HTTP profile.
  if (req?.policies?.length || restricted.length) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "RBAC and restricted-field composition are not supported by the private Currency HTTP profile")
  }

  // TODO: maintain backward compatibility, remove in the future
  const { select, relations } = stringToSelectRelationObject(
    Array.from(allFields)
  )

  let allRelations = new Set([...relations, ...Array.from(starFields)])

  // End of expand compatibility

  let orderBy: Record<string, "DESC" | "ASC"> = {}
  if (isDefined(order)) {
    let orderField = order
    if (order.startsWith("-")) {
      orderField = order.slice(1)
      orderBy = { [orderField]: "DESC" }
    } else {
      orderBy = { [order]: "ASC" }
    }

    if (allowed.length && !allowed.includes(orderField)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Order field ${orderField} is not valid`
      )
    }
  }

  const finalOrder = isPresent(orderBy) ? buildOrder(orderBy) : undefined
  return {
    listConfig: {
      select: select.length ? select : undefined,
      relations: Array.from(allRelations),
      skip: offset,
      take: limit,
      order: finalOrder,
      withDeleted: with_deleted,
    },
    remoteQueryConfig: {
      ...(!!entity ? { entity } : {}),
      // Add starFields that are relations only on which we want all properties with a dedicated format to the remote query
      fields: [
        ...Array.from(allFields),
        ...Array.from(starFields).map((f) => `${f}.*`),
      ],
      pagination: isList
        ? {
            skip: offset,
            take: limit,
            order: finalOrder,
          }
        : {},
      withDeleted: with_deleted,
    },
  }
}

export async function prepareRetrieveQuery<T extends DecodedQueryFields>(
  validated: T,
  queryConfig?: QueryConfig & { restricted?: string[] },
  req?: MedusaRequest
) {
  const { listConfig, remoteQueryConfig } = await prepareListQuery(
    validated,
    queryConfig,
    req
  )

  return {
    retrieveConfig: {
      select: listConfig.select,
      relations: listConfig.relations,
    },
    remoteQueryConfig: {
      fields: remoteQueryConfig.fields,
      pagination: {},
      withDeleted: remoteQueryConfig.withDeleted,
    },
  }
}
