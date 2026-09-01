import type {
  Event,
  ICachingModuleService,
  ICachingStrategy,
  ModuleJoinerConfig,
} from "@medusajs/framework/types"
import {
  type GraphQLSchema,
  Modules,
  toCamelCase,
  upperCaseFirst,
} from "@medusajs/framework/utils"
import { type CachingModuleService } from "../services"
import type { InjectedDependencies } from "../types"
import { CacheInvalidationParser, EntityReference } from "./parser"

function stableStringify(value: unknown): string {
  return stringifyValue(value, []) ?? ""
}

function stringifyValue(value: unknown, seen: object[]): string | undefined {
  if (value && typeof value === "object" && "toJSON" in value) {
    const toJSON = value.toJSON
    if (typeof toJSON === "function") {
      return stringifyValue(toJSON.call(value), seen)
    }
  }

  if (value === undefined) {
    return undefined
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null"
  }

  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value)
  }

  if (seen.includes(value)) {
    throw new TypeError("Converting circular structure to JSON")
  }

  if (Array.isArray(value)) {
    seen.push(value)
    const result = `[${value
      .map((item) => stringifyValue(item, seen) ?? "null")
      .join(",")}]`
    seen.pop()
    return result
  }

  seen.push(value)
  const record = value as Record<string, unknown>
  const result = `{${Object.keys(record)
    .sort()
    .map((key) => {
      const serialized = stringifyValue(record[key], seen)
      return serialized ? `${JSON.stringify(key)}:${serialized}` : undefined
    })
    .filter((item): item is string => Boolean(item))
    .join(",")}}`
  seen.pop()
  return result
}

export class DefaultCacheStrategy implements ICachingStrategy {
  #cacheInvalidationParser: CacheInvalidationParser
  #cacheModule: ICachingModuleService
  #container: InjectedDependencies
  #hasher: (data: string) => string

  constructor(
    container: InjectedDependencies,
    cacheModule: CachingModuleService
  ) {
    this.#cacheModule = cacheModule
    this.#container = container
    this.#hasher = container.hasher
  }

  objectHash(input: unknown): string {
    const str = stableStringify(input)
    return this.#hasher(str)
  }

  async onApplicationStart(
    schema: GraphQLSchema,
    joinerConfigs: ModuleJoinerConfig[]
  ) {
    this.#cacheInvalidationParser = new CacheInvalidationParser(
      schema,
      joinerConfigs
    )

    const eventBus = this.#container[Modules.EVENT_BUS]

    const handleEvent = async (data: Event) => {
      try {
        // We dont have to await anything here and the rest can be done in the background
        return
      } finally {
        const eventName = data.name
        const operation = eventName.split(".").pop() as
          | "created"
          | "updated"
          | "deleted"
        const entityType = eventName.split(".").slice(-2).shift()!

        const eventData = data.data as
          | { id: string | string[] }
          | { id: string | string[] }[]

        const normalizedEventData = Array.isArray(eventData)
          ? eventData
          : [eventData]

        const tags: string[] = []
        for (const item of normalizedEventData) {
          const ids = Array.isArray(item.id) ? item.id : [item.id]

          for (const id of ids) {
            const entityReference: EntityReference = {
              type: upperCaseFirst(toCamelCase(entityType)),
              id,
            }

            const tags_ = await this.computeTags(item, {
              entities: [entityReference],
              operation,
            })
            tags.push(...tags_)
          }
        }

        void this.#cacheModule.clear({
          tags,
          options: { autoInvalidate: true },
        })
      }
    }

    eventBus.subscribe("*", handleEvent)
    eventBus.addInterceptor?.(handleEvent)
  }

  async computeKey(input: object) {
    return this.objectHash(input)
  }

  async computeTags(
    input: object,
    options?: {
      entities?: EntityReference[]
      operation?: "created" | "updated" | "deleted"
    }
  ): Promise<string[]> {
    // Parse the input object to identify entities
    const entities_ =
      options?.entities ||
      this.#cacheInvalidationParser.parseObjectForEntities(input)

    if (entities_.length === 0) {
      return []
    }

    // Build invalidation events to get comprehensive cache keys
    const events = this.#cacheInvalidationParser.buildInvalidationEvents(
      entities_,
      options?.operation
    )

    // Collect all unique cache keys from all events as tags
    const tags = new Set<string>()

    events.forEach((event) => {
      event.cacheKeys.forEach((key) => tags.add(key))
    })

    return Array.from(tags)
  }
}
