import {
  RemoteFetchDataCallback,
  RemoteJoiner,
  toRemoteJoinerQuery,
} from "@medusajs/orchestration"
import {
  JoinerRelationship,
  JoinerServiceConfig,
  LoadedModule,
  ModuleJoinerConfig,
  RemoteExpandProperty,
  RemoteJoinerOptions,
  RemoteJoinerQuery,
  RemoteNestedExpands,
} from "@medusajs/types"
import { isString } from "@medusajs/utils"
import { MedusaModule } from "../medusa-module"
import {
  executeRemoteFetchServiceRequest,
  getAllRemoteFetchFieldsAndRelations,
  type RemoteFetchOptions,
  type RemoteFetchTrace,
} from "./remote-fetch-data"

const BASE_PREFIX = ""
export class RemoteQuery {
  private remoteJoiner: RemoteJoiner
  private modulesMap: Map<string, LoadedModule> = new Map()
  private customRemoteFetchData?: RemoteFetchDataCallback
  private entitiesMap: Map<string, unknown> = new Map()

  static traceFetchRemoteData?: RemoteFetchTrace

  constructor({
    modulesLoaded,
    customRemoteFetchData,
    servicesConfig = [],
    entitiesMap,
  }: {
    modulesLoaded?: LoadedModule[]
    customRemoteFetchData?: RemoteFetchDataCallback
    servicesConfig?: ModuleJoinerConfig[]
    entitiesMap: Map<string, unknown>
  }) {
    const servicesConfig_ = [...servicesConfig]
    this.entitiesMap = entitiesMap

    if (!modulesLoaded?.length) {
      modulesLoaded = MedusaModule.getLoadedModules().map(
        (mod) => Object.values(mod)[0]
      )
    }

    for (const mod of modulesLoaded || []) {
      if (!mod.__definition.isQueryable) {
        continue
      }

      const serviceName = mod.__definition.key

      if (this.modulesMap.has(serviceName)) {
        throw new Error(
          `Duplicated instance of module ${serviceName} is not allowed.`
        )
      }

      this.modulesMap.set(serviceName, mod)
      servicesConfig_!.push(mod.__joinerConfig)
    }

    this.customRemoteFetchData = customRemoteFetchData

    this.remoteJoiner = new RemoteJoiner(
      servicesConfig_ as JoinerServiceConfig[],
      this.remoteFetchData.bind(this),
      {
        autoCreateServiceNameAlias: false,
        entitiesMap,
      }
    )
  }

  public getEntitiesMap() {
    return this.entitiesMap
  }

  public setFetchDataCallback(
    remoteFetchData: (
      expand: RemoteExpandProperty,
      keyField: string,
      ids?: (unknown | unknown[])[],
      relationship?: any
    ) => Promise<{
      data: unknown[] | { [path: string]: unknown[] }
      path?: string
    }>
  ): void {
    this.remoteJoiner.setFetchDataCallback(remoteFetchData)
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
    if (this.customRemoteFetchData) {
      const resp = await this.customRemoteFetchData(expand, keyField, ids)
      if (resp !== undefined) {
        return resp
      }
    }

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
    const service = this.modulesMap.get(serviceConfig.serviceName)!

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

    return await executeRemoteFetchServiceRequest({
      serviceName: serviceConfig.serviceName,
      service,
      keyField,
      ids,
      filters,
      options,
      methodSuffix: readMethodSuffix(
        relationship?.args?.methodSuffix ?? serviceConfig?.args?.methodSuffix
      ),
      traceFetchData: RemoteQuery.traceFetchRemoteData,
    })
  }

  public async query(
    query: string | RemoteJoinerQuery | object,
    variables?: Record<string, unknown>,
    options?: RemoteJoinerOptions
  ): Promise<any> {
    let finalQuery: RemoteJoinerQuery = query as RemoteJoinerQuery

    if (isString(query)) {
      finalQuery = RemoteJoiner.parseQuery(query, variables)
    } else if (!isString(finalQuery?.service) && !isString(finalQuery?.alias)) {
      finalQuery = toRemoteJoinerQuery(query, variables)
    }

    return await this.remoteJoiner.query(finalQuery, options)
  }
}

function readMethodSuffix(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
