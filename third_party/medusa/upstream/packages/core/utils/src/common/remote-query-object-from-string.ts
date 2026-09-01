import {
  RemoteQueryObjectConfig,
  RemoteQueryObjectFromStringResult,
} from "@medusajs/types"
import { isObject } from "./is-object"

type RemoteJoinerNode = {
  fields?: unknown[]
  __args?: unknown
  isServiceAccess?: boolean
  [key: string]: RemoteJoinerNode | unknown[] | boolean | unknown | undefined
}

/**
 * Convert a string fields array to a remote query object
 * @param config - The configuration object
 *
 * @example
 * const fields = [
 *   "id",
 *   "created_at",
 *   "updated_at",
 *   "deleted_at",
 *   "url",
 *   "metadata",
 *   "tags.id",
 *   "tags.created_at",
 *   "tags.updated_at",
 *   "tags.deleted_at",
 *   "tags.value",
 *   "options.id",
 *   "options.created_at",
 *   "options.updated_at",
 *   "options.deleted_at",
 *   "options.title",
 *   "options.product_id",
 *   "options.metadata",
 *   "options.values.id",
 *   "options.values.created_at",
 *   "options.values.updated_at",
 *   "options.values.deleted_at",
 *   "options.values.value",
 *   "options.values.option_id",
 *   "options.values.variant_id",
 *   "options.values.metadata",
 * ]
 *
 * const remoteQueryObject = remoteQueryObjectFromString({
 *   entryPoint: "product",
 *   variables: {},
 *   fields,
 * })
 *
 * console.log(remoteQueryObject)
 * // {
 * //   product: {
 * //     __args: {},
 * //     fields: [
 * //       "id",
 * //       "created_at",
 * //       "updated_at",
 * //       "deleted_at",
 * //       "url",
 * //       "metadata",
 * //     ],
 * //
 * //     tags: {
 * //       fields: ["id", "created_at", "updated_at", "deleted_at", "value"],
 * //     },
 * //
 * //     options: {
 * //       fields: [
 * //         "id",
 * //         "created_at",
 * //         "updated_at",
 * //         "deleted_at",
 * //         "title",
 * //         "product_id",
 * //         "metadata",
 * //       ],
 * //       values: {
 * //         fields: [
 * //           "id",
 * //           "created_at",
 * //           "updated_at",
 * //           "deleted_at",
 * //           "value",
 * //           "option_id",
 * //           "variant_id",
 * //           "metadata",
 * //         ],
 * //       },
 * //     },
 * //   },
 * // }
 */
export function remoteQueryObjectFromString<
  const TEntry extends string,
  const TConfig extends RemoteQueryObjectConfig<TEntry>
>(
  config: TConfig | RemoteQueryObjectConfig<TEntry>
): RemoteQueryObjectFromStringResult<TConfig> {
  const {
    entryPoint,
    service,
    variables = {},
    fields = [],
  } = {
    ...config,
    entryPoint: "entryPoint" in config ? config.entryPoint : undefined,
    service: "service" in config ? config.service : undefined,
  }

  const entryKey = (entryPoint ?? service) as string

  const remoteJoinerConfig: Record<string, RemoteJoinerNode> = {
    [entryKey]: {
      fields: [],
      isServiceAccess: !!service, // specifies if the entry point is a service
    },
  }

  const usedVariables = new Set<string>()
  const variableMap = toStringRecord(variables)

  for (const field of fields) {
    const fieldAsString = String(field)
    if (!fieldAsString.includes(".")) {
      appendField(remoteJoinerConfig[entryKey], field)
      continue
    }

    const fieldSegments = fieldAsString.split(".")
    const fieldProperty = fieldSegments.pop()

    let combinedPath = ""

    const deepConfigRef = fieldSegments.reduce((acc, curr) => {
      combinedPath = combinedPath ? combinedPath + "." + curr : curr

      const nextNode = getOrCreateNode(acc, curr)

      if (combinedPath in variableMap) {
        nextNode.__args = variableMap[combinedPath]
        usedVariables.add(combinedPath)
      }

      return nextNode
    }, remoteJoinerConfig[entryKey])

    appendField(deepConfigRef, fieldProperty)
  }

  const topLevelArgs: Record<string, unknown> = {}
  for (const key of Object.keys(variableMap)) {
    if (!usedVariables.has(key)) {
      topLevelArgs[key] = variableMap[key]
    }
  }

  remoteJoinerConfig[entryKey].__args = topLevelArgs

  return {
    __value: remoteJoinerConfig,
  } as RemoteQueryObjectFromStringResult<TConfig>
}

function appendField(node: RemoteJoinerNode, field: unknown): void {
  node.fields ??= []
  node.fields.push(field)
}

function getOrCreateNode(
  parent: RemoteJoinerNode,
  key: string
): RemoteJoinerNode {
  const current = parent[key]

  if (isRemoteJoinerNode(current)) {
    return current
  }

  const next: RemoteJoinerNode = {}
  parent[key] = next

  return next
}

function isRemoteJoinerNode(value: unknown): value is RemoteJoinerNode {
  return isObject(value)
}

function toStringRecord(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value))
}
