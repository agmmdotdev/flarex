import { isString } from "@medusajs/utils/common/is-string"

/** Pure metadata seam from the pinned RemoteJoiner. Singleton aliases retain
 * native service-wide meaning; only multiple aliases select by entity. */
export interface JoinerFieldAlias {
  readonly path: string
  readonly isList?: boolean
  readonly entity?: string
}
export interface JoinerFieldAliases {
  fieldAlias: Record<string, JoinerFieldAlias | JoinerFieldAlias[]>
}
export interface JoinerFieldAliasExtension {
  readonly serviceName: string
  readonly entity?: string
  readonly fieldAlias?: Readonly<Record<string, string | JoinerFieldAlias>>
}

export function mergeFieldAlias(service_: JoinerFieldAliases, extend: JoinerFieldAliasExtension) {
  for (const [alias, fieldAlias] of Object.entries(extend.fieldAlias ?? {})) {
    const objAlias = isString(fieldAlias)
      ? { path: fieldAlias }
      : fieldAlias

    if (service_.fieldAlias[alias]) {
      if (!Array.isArray(service_.fieldAlias[alias])) {
        service_.fieldAlias[alias] = [service_.fieldAlias[alias]]
      }

      if (
        service_.fieldAlias[alias].some((f) => f.entity === extend.entity)
      ) {
        throw new Error(
          `Cannot add alias "${alias}" for "${extend.serviceName}". It is already defined for Entity "${extend.entity}".`
        )
      }

      service_.fieldAlias[alias].push({
        ...objAlias,
        entity: extend.entity,
      })
    } else {
      service_.fieldAlias[alias] = {
        ...objAlias,
        entity: extend.entity,
      }
    }
  }
}

export function selectFieldAlias(value: JoinerFieldAlias | JoinerFieldAlias[], currentPathEntity: string | undefined,
  currentPath: readonly string[]): JoinerFieldAlias {
  let alias: JoinerFieldAlias | JoinerFieldAlias[] | undefined = value
  if (Array.isArray(alias)) {
    alias = alias.find((a) => a.entity == currentPathEntity)
    if (!alias) {
      throw new Error(
        `Cannot resolve alias path "${currentPath.join(
          "."
        )}" that matches entity ${currentPathEntity}.`
      )
    }
  }
  return alias
}
