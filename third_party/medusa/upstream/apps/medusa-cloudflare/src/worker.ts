import { createCurrencyModuleRuntime } from "./currency-module"
import {
  CloudflareEventBus,
  isCloudflareEventBusQueuedMessage,
  type CloudflareEventBusQueuedMessage,
  type CloudflareQueueProducer,
} from "@medusajs/event-bus-cloudflare"
import {
  fetchMedusaHttpPartitionRoute,
  fetchTenantPartitionedDurableObject,
  MEDUSA_HTTP_PARTITION_ROUTE_PREFIX,
  tryFetchMedusaHttpPartitionCandidate,
  type DurableObjectFetchNamespace,
  type DurableObjectFetchStub,
} from "./cloudflare-http-partition-routing"
import { CartProofDO } from "./cart-proof-do"
import { CurrencyProofDO } from "./currency-proof-do"
import { EventConsumerProofDO } from "./event-consumer-proof-do"
import { IndexProofDO } from "./index-proof-do"
import { MedusaLockingDO } from "./locking-do"
import type { TenantRuntimeEnv } from "./platform/tenant-resolution"
import {
  getMedusaCloudflareHttpRuntimeStatus,
  tryHandleMedusaCloudflareHttp,
} from "./cloudflare-http-runtime"
import {
  isProductionHttpPartitionCandidateRoute,
  resolveUrlDerivedProductionHttpPartitionKey,
  rewriteCartProductionHttpTarget,
} from "./cloudflare-http-production-route-policy"

export {
  CartProofDO,
  CurrencyProofDO,
  EventConsumerProofDO,
  IndexProofDO,
  MedusaLockingDO,
}

const runtimes = new WeakMap<
  D1Database,
  ReturnType<typeof createCurrencyModuleRuntime>
>()

interface Env extends TenantRuntimeEnv {
  DB?: D1Database
  CART_PROOFS?: DurableObjectFetchNamespace
  CURRENCY_PROOFS?: DurableObjectFetchNamespace
  EVENT_CONSUMER_PROOFS?: DurableObjectProofNamespace
  INDEX_PROOFS?: DurableObjectFetchNamespace
  MEDUSA_LOCKING?: DurableObjectNamespace
  MEDUSA_EVENTS?: CloudflareQueueProducer
}

type DurableObjectProofNamespace = DurableObjectFetchNamespace
type DurableObjectProofStub = DurableObjectFetchStub

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname === "/health") {
      return Response.json({
        status: "ok",
        runtime: "cloudflare-workers",
      })
    }

    if (pathname === "/medusa-http-runtime/status") {
      return Response.json(getMedusaCloudflareHttpRuntimeStatus())
    }

    if (pathname.startsWith(MEDUSA_HTTP_PARTITION_ROUTE_PREFIX)) {
      return await fetchMedusaHttpPartition(request, env)
    }

    const productionPartitionResponse =
      await tryHandleMedusaProductionPartitionHttp(request, env)
    if (productionPartitionResponse) {
      return productionPartitionResponse
    }

    const medusaHttpResponse = await tryHandleMedusaCloudflareHttp(request)
    if (medusaHttpResponse) {
      return medusaHttpResponse
    }

    if (pathname.startsWith("/do-currency/")) {
      if (!env.CURRENCY_PROOFS) {
        return Response.json(
          { error: "Durable Object binding CURRENCY_PROOFS is not configured" },
          { status: 503 }
        )
      }
      const [, , aggregateId] = pathname.split("/")
      if (!aggregateId) {
        return Response.json({ error: "Aggregate ID is required" }, { status: 400 })
      }
      return await fetchTenantPartitionedDurableObject({
        request,
        env,
        namespace: env.CURRENCY_PROOFS,
        family: "currency",
        aggregateId,
      })
    }

    if (pathname.startsWith("/do-cart/")) {
      if (!env.CART_PROOFS) {
        return Response.json(
          { error: "Durable Object binding CART_PROOFS is not configured" },
          { status: 503 }
        )
      }
      const [, , aggregateId] = pathname.split("/")
      if (!aggregateId) {
        return Response.json({ error: "Aggregate ID is required" }, { status: 400 })
      }
      return await fetchTenantPartitionedDurableObject({
        request,
        env,
        namespace: env.CART_PROOFS,
        family: "cart",
        aggregateId,
      })
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
      return await env.INDEX_PROOFS.getByName(aggregateId).fetch(request)
    }

    if (pathname.startsWith("/queue-consumer-proof/")) {
      if (!env.MEDUSA_EVENTS || !env.EVENT_CONSUMER_PROOFS) {
        return Response.json(
          { error: "Queue consumer proof bindings are not configured" },
          { status: 503 }
        )
      }

      const [, , proofId] = pathname.split("/")
      if (!proofId) {
        return Response.json({ error: "Proof ID is required" }, { status: 400 })
      }

      const proofObject = env.EVENT_CONSUMER_PROOFS.getByName(proofId)
      await proofObject.fetch("https://proof.local/reset", { method: "POST" })
      await env.MEDUSA_EVENTS.send({
        name: "cloudflare.queue.proof",
        data: { id: proofId },
        metadata: { eventConsumerProofId: proofId },
      })

      const proof = await waitForQueueConsumerProof(proofObject)
      return Response.json(proof, { status: proof.dispatched ? 201 : 504 })
    }

    if (pathname === "/currencies") {
      if (!env.DB) {
        return Response.json(
          { error: "D1 binding DB is not configured" },
          { status: 503 }
        )
      }

      const runtime = await getCurrencyRuntime(env.DB)
      if (request.method === "POST") {
        const input: unknown = await request.json()
        if (!isCreateCurrencyInput(input)) {
          return Response.json(
            { error: "Invalid Currency input" },
            { status: 400 }
          )
        }
        return Response.json(await runtime.service.createCurrencies(input), {
          status: 201,
        })
      }
      return Response.json(await runtime.service.listCurrencies())
    }

    if (pathname.startsWith("/currencies/") && request.method === "PATCH") {
      if (!env.DB) {
        return Response.json(
          { error: "D1 binding DB is not configured" },
          { status: 503 }
        )
      }

      const runtime = await getCurrencyRuntime(env.DB)
      const code = decodeURIComponent(pathname.slice("/currencies/".length))
      const input: unknown = await request.json()
      if (!isUpdateCurrencyInput(input)) {
        return Response.json(
          { error: "Invalid Currency update" },
          { status: 400 }
        )
      }
      return Response.json(
        await runtime.service.updateCurrencies({
          ...input,
          code,
        })
      )
    }

    if (
      pathname.startsWith("/currencies/") &&
      pathname.endsWith("/soft-delete") &&
      request.method === "POST"
    ) {
      if (!env.DB) {
        return Response.json(
          { error: "D1 binding DB is not configured" },
          { status: 503 }
        )
      }

      const runtime = await getCurrencyRuntime(env.DB)
      const code = decodeCurrencyActionCode(pathname, "/soft-delete")
      return Response.json(await runtime.service.softDeleteCurrencies(code))
    }

    if (
      pathname.startsWith("/currencies/") &&
      pathname.endsWith("/restore") &&
      request.method === "POST"
    ) {
      if (!env.DB) {
        return Response.json(
          { error: "D1 binding DB is not configured" },
          { status: 503 }
        )
      }

      const runtime = await getCurrencyRuntime(env.DB)
      const code = decodeCurrencyActionCode(pathname, "/restore")
      return Response.json(await runtime.service.restoreCurrencies(code))
    }

    if (pathname.startsWith("/currencies/") && request.method === "DELETE") {
      if (!env.DB) {
        return Response.json(
          { error: "D1 binding DB is not configured" },
          { status: 503 }
        )
      }

      const runtime = await getCurrencyRuntime(env.DB)
      const code = decodeURIComponent(pathname.slice("/currencies/".length))
      await runtime.service.deleteCurrencies(code)
      return new Response(null, { status: 204 })
    }

    if (pathname === "/persistence-capabilities") {
      if (!env.DB) {
        return Response.json(
          { error: "D1 binding DB is not configured" },
          { status: 503 }
        )
      }

      const runtime = await getCurrencyRuntime(env.DB)
      return Response.json({ transactionMode: runtime.transactionMode })
    }

    return new Response("Not found", { status: 404 })
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: Env
  ): Promise<void> {
    if (!env.MEDUSA_EVENTS) {
      throw new Error("MEDUSA_EVENTS Queue binding is required")
    }

    const eventBus = createEventQueueConsumer(env, env.MEDUSA_EVENTS)

    for (const message of batch.messages) {
      if (!isCloudflareEventBusQueuedMessage(message.body)) {
        console.error("Skipping invalid Cloudflare Event Bus queue message")
        message.ack()
        continue
      }

      try {
        await eventBus.dispatchQueuedEvent(message.body)
        message.ack()
      } catch (error) {
        console.error(error)
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env>

type TenantPartitionedDurableObjectInput = Readonly<{
  request: Request
  env: Env
  namespace: DurableObjectNamespace
  family: string
  aggregateId: string
}>

async function fetchMedusaHttpPartition(
  request: Request,
  env: Env
): Promise<Response> {
  return await fetchMedusaHttpPartitionRoute({
    env,
    missingNamespaceMessage:
      "Durable Object binding CART_PROOFS is not configured",
    namespace: env.CART_PROOFS,
    partitionFamily: "cart",
    request,
    rewriteTargetPath: rewriteCartProductionHttpTarget,
  })
}

async function tryHandleMedusaProductionPartitionHttp(
  request: Request,
  env: Env
): Promise<Response | undefined> {
  return await tryFetchMedusaHttpPartitionCandidate({
    env,
    isCandidateRoute: isProductionHttpPartitionCandidateRoute,
    missingNamespaceMessage:
      "Durable Object binding CART_PROOFS is not configured",
    namespace: env.CART_PROOFS,
    partitionFamily: "cart",
    request,
    resolvePartitionKey: resolveUrlDerivedProductionHttpPartitionKey,
    rewriteTargetPath: rewriteCartProductionHttpTarget,
  })
}

interface QueueConsumerProofStatus {
  dispatched: boolean
  record: {
    id: string
    eventName: string
    receivedAt: string
  } | null
}

async function waitForQueueConsumerProof(
  proofObject: DurableObjectProofStub
): Promise<QueueConsumerProofStatus> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await proofObject.fetch("https://proof.local/status")
    const body: unknown = await response.json()
    if (isQueueConsumerProofStatus(body) && body.dispatched) {
      return body
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100))
  }

  return {
    dispatched: false,
    record: null,
  }
}

function createEventQueueConsumer(
  env: Env,
  queue: CloudflareQueueProducer
): CloudflareEventBus {
  const eventBus = new CloudflareEventBus(
    { logger: console },
    {
      queue,
      dispatchLocalSubscribers: false,
    },
    { scope: "internal", worker_mode: "worker" }
  )

  eventBus.subscribe(
    "cloudflare.queue.proof",
    async (event) => {
      const proofId = event.metadata?.eventConsumerProofId
      if (
        typeof proofId !== "string" ||
        !env.EVENT_CONSUMER_PROOFS
      ) {
        return
      }

      await env.EVENT_CONSUMER_PROOFS.getByName(proofId).fetch(
        "https://proof.local/record",
        {
          method: "POST",
          body: JSON.stringify({
            id: proofId,
            eventName: event.name,
          }),
        }
      )
    },
    { subscriberId: "cloudflare-queue-proof-recorder" }
  )

  return eventBus
}

function isQueueConsumerProofStatus(
  value: unknown
): value is QueueConsumerProofStatus {
  return (
    isRecord(value) &&
    typeof value.dispatched === "boolean" &&
    (value.record === null ||
      (isRecord(value.record) &&
        typeof value.record.id === "string" &&
        typeof value.record.eventName === "string" &&
        typeof value.record.receivedAt === "string"))
  )
}

function getCurrencyRuntime(database: D1Database) {
  let runtime = runtimes.get(database)
  if (!runtime) {
    runtime = createCurrencyModuleRuntime(database)
    runtimes.set(database, runtime)
  }
  return runtime
}

function decodeCurrencyActionCode(pathname: string, action: string): string {
  return decodeURIComponent(
    pathname.slice("/currencies/".length, -action.length)
  )
}

interface CreateCurrencyInput {
  code: string
  symbol: string
  symbol_native: string
  name: string
}

interface UpdateCurrencyInput {
  symbol?: string
  symbol_native?: string
  name?: string
}

function isCreateCurrencyInput(value: unknown): value is CreateCurrencyInput {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.symbol === "string" &&
    typeof value.symbol_native === "string" &&
    typeof value.name === "string"
  )
}

function isUpdateCurrencyInput(value: unknown): value is UpdateCurrencyInput {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) =>
        (key === "symbol" || key === "symbol_native" || key === "name") &&
        typeof value[key] === "string"
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
