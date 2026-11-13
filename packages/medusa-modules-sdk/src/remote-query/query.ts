import type { GraphResultSet, RemoteJoinerOptions, RemoteJoinerQuery, RemoteQueryInput, RemoteQueryObjectConfig, RemoteQueryObjectFromStringResult, RemoteQueryFunctionReturnPagination } from "@medusajs/types"
import { MedusaError } from "@medusajs/utils/common/errors"
import { isObject } from "@medusajs/utils/common/is-object"
import { normalizeQueryConfig } from "./normalize-query-config"
import { RemoteQuery } from "./remote-query"
import { toRemoteQuery } from "./to-remote-query"

export class Query {
  #remoteQuery: RemoteQuery
  constructor({ remoteQuery }: { remoteQuery: RemoteQuery }) { this.#remoteQuery = remoteQuery }

#unwrapQueryConfig(
    config:
      | RemoteQueryObjectFromStringResult<any>
      | RemoteQueryObjectConfig<any>
      | RemoteJoinerQuery
  ): object {
    return normalizeQueryConfig({
      config,
      entitiesMap: this.#remoteQuery.getEntitiesMap(),
      joinerConfigs: this.#remoteQuery.getJoinerConfigs(),
    })
  }

#unwrapRemoteQueryResponse(
    response:
      | any[]
      | { rows: any[]; metadata: RemoteQueryFunctionReturnPagination }
  ): GraphResultSet<any> {
    if (Array.isArray(response)) {
      return { data: response, metadata: undefined }
    }

    return {
      data: response.rows,
      metadata: response.metadata,
    }
  }

async query(
    queryOptions:
      | RemoteQueryInput<any>
      | RemoteQueryObjectConfig<any>
      | RemoteQueryObjectFromStringResult<any>
      | RemoteJoinerQuery,
    options?: RemoteJoinerOptions
  ) {
    if (!isObject(queryOptions)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid query, expected object and received something else."
      )
    }

    const config = this.#unwrapQueryConfig(queryOptions)
    return await this.#remoteQuery.query(config, undefined, options)
  }

async graph<const TEntry extends string>(
    queryOptions: RemoteQueryInput<TEntry>,
    options?: RemoteJoinerOptions
  ): Promise<GraphResultSet<TEntry>> {
    if (options?.locale) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Locale is outside the admitted native Query profile")
    const normalizedQuery = toRemoteQuery(
      queryOptions,
      this.#remoteQuery.getEntitiesMap(),
      this.#remoteQuery.getJoinerConfigs()
    )

    let response:
      | any[]
      | { rows: any[]; metadata: RemoteQueryFunctionReturnPagination }

    /**
     * When traceGraphQuery method is defined, we will wrap the implementation
     * inside a callback and provide the method to the traceGraphQuery
     */
    response = await this.#remoteQuery.query(normalizedQuery, undefined, options)

    const result = this.#unwrapRemoteQueryResponse(response)

    return result
  }
}

export function createQuery({ remoteQuery }: { remoteQuery: RemoteQuery }) {
  const query = new Query({ remoteQuery })
  function backwardCompatibleQuery(...args: Parameters<Query["query"]>) { return query.query.apply(query, args) }
  backwardCompatibleQuery.graph = query.graph.bind(query)
  return backwardCompatibleQuery
}
