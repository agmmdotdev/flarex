import {
  createPartitionAddress,
  createProjectionScope,
  TenantRuntimeContextError,
  type PartitionAddress,
  type ProjectionScope,
  type TenantRuntimeContext,
} from "@medusajs/cloudflare-runtime"
import { D1SqliteIndexExecutor } from "./index-cloudflare-sqlite-executor"
import {
  createSqliteIndexWorkerProductProofDependencies,
  SqliteIndexWorkerProductProofRuntime,
} from "@medusajs/index/worker-composition"
import { runIndexRelationQueryProof } from "@medusajs/index/relation-query-proof-runner"
import { IndexProofDO } from "./index-proof-do"
import { indexWorkerInput } from "./index-worker-input"
import {
  resolveTenantRuntimeContext,
  type TenantRuntimeEnv,
} from "./platform/tenant-resolution"
import {
  ProjectionDatabaseResolutionError,
  resolveIndexProjectionDatabase,
  type ProjectionDatabaseResolution,
} from "./platform/projection-database-resolution"

export { IndexProofDO }

interface Env {
  INDEX_DB?: D1Database
  INDEX_DB_TENANT_A?: D1Database
  INDEX_DB_TENANT_B?: D1Database
  INDEX_PROOFS?: DurableObjectNamespace
  MEDUSA_TENANT_ID?: string
  MEDUSA_DEPLOYMENT_ID?: string
  MEDUSA_ENVIRONMENT?: string
  MEDUSA_DEPLOYMENT_VERSION?: string
}

const d1IndexRuntimes = new WeakMap<
  D1Database,
  SqliteIndexWorkerProductProofRuntime
>()

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname === "/health") {
      return Response.json({
        status: "ok",
        runtime: "cloudflare-workers",
        proof: "index-sqlite",
      })
    }

    if (pathname === "/tenant-runtime/check" && request.method === "GET") {
      return createTenantRuntimeCheckResponse(request, env)
    }

    if (pathname === "/d1-index/query-proof" && request.method === "POST") {
      return await createD1IndexResponse(request, env, async (database) =>
        Response.json(
          await runIndexRelationQueryProof(
            new D1SqliteIndexExecutor(database)
          ),
          { status: 201 }
        )
      )
    }

    if (pathname === "/d1-index/composition-check" && request.method === "POST") {
      return await createD1IndexResponse(request, env, async (database) =>
        Response.json(
          await getD1IndexRuntime(database).runCompositionCheck(),
          { status: 201 }
        )
      )
    }

    if (
      pathname === "/d1-index/event-ingestion-check" &&
      request.method === "POST"
    ) {
      return await createD1IndexResponse(request, env, async (database) =>
        Response.json(
          await getD1IndexRuntime(database).runEventIngestionCheck(),
          {
            status: 201,
          }
        )
      )
    }

    if (
      pathname === "/d1-index/link-attach-detach-check" &&
      request.method === "POST"
    ) {
      return await createD1IndexResponse(request, env, async (database) =>
        Response.json(
          await getD1IndexRuntime(database).runLinkAttachDetachCheck(),
          {
            status: 201,
          }
        )
      )
    }

    if (pathname.startsWith("/do-index/")) {
      if (!env.INDEX_PROOFS) {
        return Response.json(
          { error: "Durable Object binding INDEX_PROOFS is not configured" },
          { status: 503 }
        )
      }
      const [, , aggregateId] = pathname.split("/")
      if (!aggregateId) {
        return Response.json({ error: "Aggregate ID is required" }, { status: 400 })
      }

      try {
        const context = resolveTenantRuntimeContext(request, env)
        const partitionAddress = createPartitionAddress(context, {
          family: "index",
          key: aggregateId,
        })
        const response = await env.INDEX_PROOFS.getByName(
          partitionAddress.name
        ).fetch(request)
        const headers = new Headers(response.headers)
        headers.set("x-medusa-partition-name", partitionAddress.name)

        return new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        })
      } catch (error) {
        return createTenantRuntimeErrorResponse(error)
      }
    }

    return new Response("Not found", { status: 404 })
  },
}

type TenantRuntimeCheck = Readonly<{
  context: TenantRuntimeContext
  cartPartition: PartitionAddress
  indexPartition: PartitionAddress
  catalogProjection: ProjectionScope
}>

function createTenantRuntimeCheckResponse(
  request: Request,
  env: TenantRuntimeEnv
): Response {
  try {
    const context = resolveTenantRuntimeContext(request, env)

    return Response.json({
      context,
      cartPartition: createPartitionAddress(context, {
        family: "cart",
        key: "cart_local",
      }),
      indexPartition: createPartitionAddress(context, {
        family: "index",
        key: "index_local",
      }),
      catalogProjection: createProjectionScope(context, {
        name: "catalog",
      }),
    } satisfies TenantRuntimeCheck)
  } catch (error) {
    return createTenantRuntimeErrorResponse(error)
  }
}

function createTenantRuntimeErrorResponse(error: unknown): Response {
  if (error instanceof TenantRuntimeContextError) {
    return Response.json(
      {
        error: error.message,
        field: error.field,
      },
      { status: 400 }
    )
  }

  throw error
}

async function createD1IndexResponse(
  request: Request,
  env: Env,
  operation: (database: D1Database) => Promise<Response>
): Promise<Response> {
  try {
    const context = resolveTenantRuntimeContext(request, env)
    const resolution = resolveIndexProjectionDatabase(context, env)
    const response = await operation(resolution.database)

    return withProjectionDatabaseHeaders(response, resolution)
  } catch (error) {
    if (error instanceof ProjectionDatabaseResolutionError) {
      return Response.json(
        {
          error: error.message,
          projectionDatabase: error.address.key,
        },
        { status: 503 }
      )
    }

    return createTenantRuntimeErrorResponse(error)
  }
}

function withProjectionDatabaseHeaders(
  response: Response,
  resolution: ProjectionDatabaseResolution
): Response {
  const headers = new Headers(response.headers)
  headers.set("x-medusa-projection-database", resolution.address.key)
  headers.set("x-medusa-d1-binding", resolution.bindingName)

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function getD1IndexRuntime(
  database: D1Database
): SqliteIndexWorkerProductProofRuntime {
  const existingRuntime = d1IndexRuntimes.get(database)

  if (existingRuntime) {
    return existingRuntime
  }

  const runtime = new SqliteIndexWorkerProductProofRuntime({
    executor: new D1SqliteIndexExecutor(database),
    input: indexWorkerInput,
    ...createSqliteIndexWorkerProductProofDependencies(),
  })
  d1IndexRuntimes.set(database, runtime)

  return runtime
}
