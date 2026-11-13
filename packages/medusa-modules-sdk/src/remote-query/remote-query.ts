import {
  captureJoinerServiceConfigs,
  RemoteJoiner,
  toRemoteJoinerQuery,
} from "@medusajs/orchestration/joiner"
import {
  JoinerRelationship,
  ModuleJoinerConfig,
  RemoteExpandProperty,
  RemoteJoinerOptions,
  RemoteJoinerQuery,
  RemoteNestedExpands,
} from "@medusajs/types"
import { isString } from "@medusajs/utils/common/is-string"
import {
  getAllRemoteFetchFieldsAndRelations,
  type RemoteFetchOptions,
  type RemoteFetchServiceRequest,
  type RemoteFetchServiceResult,
} from "./remote-fetch-data"

const BASE_PREFIX = ""
export interface RemoteQueryFetchRequest extends Omit<RemoteFetchServiceRequest, "service" | "traceFetchData"> {
  readonly expand: RemoteExpandProperty
  readonly relationship?: JoinerRelationship
  readonly groupedParentContexts?: ReturnType<RemoteJoiner["getGroupedParentContexts"]>
}
export type RemoteQueryFetchData = (request: RemoteQueryFetchRequest) => Promise<RemoteFetchServiceResult>

export class RemoteQuery {
  private remoteJoiner: RemoteJoiner
  private entitiesMap: Map<string, unknown>
  private servicesConfig: ModuleJoinerConfig[]
  private fetchData: RemoteQueryFetchData

  constructor({ servicesConfig, entitiesMap, entityRelations, remoteFetchData }: {
    servicesConfig: readonly ModuleJoinerConfig[]
    entitiesMap: Map<string, unknown>
    entityRelations: ReadonlyMap<string, ReadonlyMap<string, string>>
    remoteFetchData: RemoteQueryFetchData
  }) {
    if (typeof remoteFetchData !== "function") throw new Error("Native Remote Query requires an authenticated fetch callback")
    this.servicesConfig = captureJoinerServiceConfigs(servicesConfig)
    this.entitiesMap = new Map(entitiesMap)
    this.fetchData = remoteFetchData
    this.remoteJoiner = new RemoteJoiner(this.servicesConfig, this.remoteFetchData.bind(this), { autoCreateServiceNameAlias: false, entityRelations })
  }

  public getJoinerConfigs() { return captureJoinerServiceConfigs(this.servicesConfig) }

  public getEntitiesMap() {
    return this.entitiesMap
  }

  

  public static getAllFieldsAndRelations(
    expand: RemoteExpandProperty | RemoteNestedExpands[number],
    prefix = BASE_PREFIX,
    args: Record<string, unknown> = {}
  ): {
    select?: string[]
    relations: string[]
    args: Record<string, unknown>
    take?: number | null
  } {
    const result = getAllRemoteFetchFieldsAndRelations(expand, prefix, args)
    const fieldsAndRelations = {
      select: result.select,
      relations: result.relations,
      args: result.args,
    }

    return result.take === undefined
      ? fieldsAndRelations
      : {
          ...fieldsAndRelations,
          take: result.take,
        }
  }

  public async remoteFetchData(
    expand: RemoteExpandProperty,
    keyField: string,
    ids?: (unknown | unknown[])[],
    relationship?: JoinerRelationship
  ): Promise<{
    data: unknown[] | { [path: string]: unknown }
    path?: string
  }> {
    return this.executeFetchRequest({
      expand,
      keyField,
      ids,
      relationship,
    })
  }

  private async executeFetchRequest(params: {
    expand: RemoteExpandProperty
    keyField: string
    ids?: (unknown | unknown[])[] | object
    relationship?: JoinerRelationship
  }): Promise<{
    data: unknown[] | { [path: string]: unknown }
    path?: string
  }> {
    const { expand, keyField, ids, relationship } = params
    const serviceConfig = expand.serviceConfig

    let filters: Record<string, unknown> = {}
    const options: RemoteFetchOptions = {
      ...RemoteQuery.getAllFieldsAndRelations(expand),
    }

    const availableOptions = [
      "skip",
      "take",
      "limit",
      "offset",
      "cursor",
      "sort",
      "order",
      "withDeleted",
      "options",
    ]
    const availableOptionsAlias = new Map([
      ["limit", "take"],
      ["offset", "skip"],
    ])

    for (const arg of expand.args || []) {
      if (arg.name === "filters" && arg.value) {
        filters = { ...filters, ...arg.value }
      } else if (arg.name === "context" && arg.value) {
        filters["context"] = arg.value
      } else if (availableOptions.includes(arg.name)) {
        const argName = availableOptionsAlias.has(arg.name)
          ? availableOptionsAlias.get(arg.name)!
          : arg.name
        options[argName] = arg.value
      }
    }

    delete options.args?.[BASE_PREFIX]
    if (Object.keys(options.args ?? {}).length) {
      filters = {
        ...filters,
        ...options?.args,
      }
      options.args = {}
    }

    return await this.fetchData({
      serviceName: serviceConfig.serviceName,
      expand,
      relationship,
      groupedParentContexts: this.remoteJoiner.getGroupedParentContexts(expand),
      keyField,
      ids,
      filters,
      options,
      methodSuffix: readMethodSuffix(
        relationship?.args?.methodSuffix ?? serviceConfig?.args?.methodSuffix
      ),
    })
  }

  public async query(
    query: string | RemoteJoinerQuery | object,
    variables?: Record<string, unknown>,
    options?: RemoteJoinerOptions
  ): Promise<any> {
    let finalQuery: RemoteJoinerQuery = query as RemoteJoinerQuery

    if (isString(query)) {
      throw new Error("GraphQL is outside the admitted native Remote Query profile")
    } else if (!isString(finalQuery?.service) && !isString(finalQuery?.alias)) {
      finalQuery = toRemoteJoinerQuery(query, variables)
    }

    return await this.remoteJoiner.query(finalQuery, options)
  }
}

function readMethodSuffix(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
