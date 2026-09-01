import { runIndexRelationQueryProof } from "@medusajs/index/relation-query-proof-runner"
import {
  createSqliteIndexWorkerProductProofDependencies,
  SqliteIndexWorkerProductProofRuntime,
} from "@medusajs/index/worker-composition"
import { DurableObjectSqliteIndexExecutor } from "./index-cloudflare-sqlite-executor"
import { indexWorkerInput } from "./index-worker-input"

export class IndexProofDO {
  private readonly executor: DurableObjectSqliteIndexExecutor
  private readonly indexRuntime: SqliteIndexWorkerProductProofRuntime

  constructor(ctx: DurableObjectState, _env: object) {
    this.executor = new DurableObjectSqliteIndexExecutor(ctx.storage)
    this.indexRuntime = new SqliteIndexWorkerProductProofRuntime({
      executor: this.executor,
      input: indexWorkerInput,
      ...createSqliteIndexWorkerProductProofDependencies(),
    })
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.split("/").slice(3).join("/")

    if (path === "query-proof" && request.method === "POST") {
      return Response.json(await runIndexRelationQueryProof(this.executor), {
        status: 201,
      })
    }

    if (path === "composition-check" && request.method === "POST") {
      return Response.json(await this.indexRuntime.runCompositionCheck(), {
        status: 201,
      })
    }

    if (path === "event-ingestion-check" && request.method === "POST") {
      return Response.json(await this.indexRuntime.runEventIngestionCheck(), {
        status: 201,
      })
    }

    if (path === "link-attach-detach-check" && request.method === "POST") {
      return Response.json(await this.indexRuntime.runLinkAttachDetachCheck(), {
        status: 201,
      })
    }

    return new Response("Not found", { status: 404 })
  }
}
