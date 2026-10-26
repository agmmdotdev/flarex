import type { JoinerRelationship, ModuleJoinerConfig, RemoteQueryFunction } from "@medusajs/types"
import { isDefined } from "@medusajs/utils/common/is-defined"
import { MedusaError } from "@medusajs/utils/common/errors"

type KeyService = Required<Pick<ModuleJoinerConfig, "serviceName" | "primaryKeys">> & Pick<ModuleJoinerConfig, "args"> & { readonly entity?: string }
type KeyOptions = Pick<NonNullable<Parameters<RemoteQueryFunction["graph"]>[1]>, "throwIfKeyNotFound" | "throwIfRelationNotFound">

/** Pinned RemoteJoiner primary-key validation. The caller owns selection and
 * complete reads; this pure seam preserves the native NOT_FOUND errors. */
export function validateNativeQueryPrimaryKey(
  serviceConfig: KeyService,
  primaryKeyArg: { readonly name: string; readonly value: unknown } | undefined,
  options?: KeyOptions
) {
    if (options?.throwIfKeyNotFound) {
      if (primaryKeyArg?.value == undefined) {
        if (!primaryKeyArg) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `${
              serviceConfig.entity ?? serviceConfig.serviceName
            }: Primary key(s) [${serviceConfig.primaryKeys.join(
              ", "
            )}] not found in filters`
          )
        }

        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `${
            serviceConfig.entity ?? serviceConfig.serviceName
          }: Value for primary key ${primaryKeyArg.name} not found in filters`
        )
      }
    }
}

/** Pinned RemoteJoiner result validation, before hydration-only keys are
 * projected away. It grants no reads or relationship capability. */
export function validateNativeQueryKeys(params: {
  readonly uniqueIds: readonly unknown[] | undefined
  readonly resData: readonly Record<string, unknown>[]
  readonly expand: { readonly serviceConfig: KeyService }
  readonly pkField: string
  readonly relationship?: Pick<JoinerRelationship, "serviceName">
  readonly options?: KeyOptions
}) {
    const { uniqueIds, resData, expand, pkField, relationship, options } =
      params

    if (
      !(
        isDefined(uniqueIds) &&
        ((options?.throwIfKeyNotFound && !isDefined(relationship)) ||
          (options?.throwIfRelationNotFound && isDefined(relationship)))
      )
    ) {
      return
    }

    if (isDefined(relationship)) {
      if (
        Array.isArray(options?.throwIfRelationNotFound) &&
        !options?.throwIfRelationNotFound.includes(relationship.serviceName)
      ) {
        return
      }
    }

    const notFound = new Set(uniqueIds)
    resData.forEach((data) => {
      notFound.delete(data[pkField])
    })

    if (notFound.size > 0) {
      const entityName =
        expand.serviceConfig.entity ??
        expand.serviceConfig.args?.methodSuffix ??
        expand.serviceConfig.serviceName

      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `${entityName} ${pkField} not found: ` + Array.from(notFound).join(", ")
      )
    }
  }
