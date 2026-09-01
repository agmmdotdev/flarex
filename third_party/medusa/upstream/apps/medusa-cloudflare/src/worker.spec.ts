import { describe, expect, it, vi } from "vitest"
import worker from "./worker"
import { createHs256Jwt } from "@medusajs/framework/http/fetch"
import type {
  DurableObjectFetchNamespace,
  DurableObjectFetchStub,
} from "./cloudflare-http-partition-routing"
import { MEDUSA_HTTP_PARTITION_KEY_HEADER } from "./cloudflare-http-partition-routing"
import { MEDUSA_CLOUDFLARE_WORKER_PROOF_JWT_SECRET } from "./cloudflare-http-request-scope"

describe("medusa-cloudflare worker", () => {
  it("reports the Cloudflare Worker runtime", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(isWorkerHealthResponse(body)).toBe(true)
    expect(body).toEqual({
      status: "ok",
      runtime: "cloudflare-workers",
    })
  })

  it("reports why the default HTTP handler has not switched to production module runtime", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/medusa-http-runtime/status"),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(isMedusaHttpRuntimeStatus(body)).toBe(true)
    if (!isMedusaHttpRuntimeStatus(body)) {
      throw new Error("Medusa HTTP runtime status response did not match shape")
    }
    expect(body.defaultRuntime).toBe("static-proof")
    expect(body.productionCandidate).toEqual({
      status: "blocked",
      provenBoundary: "cart-proof-durable-object",
      boundedDefaultRouteOptIn: {
        header: "x-medusa-partition-key",
        routeGroups: [
          {
            id: "auth-session",
            partitionFamily: "cart",
            routePatterns: ["/auth/session"],
          },
          {
            id: "store-currencies",
            partitionFamily: "cart",
            routePatterns: ["/store/currencies"],
          },
          {
            id: "store-product-types",
            partitionFamily: "cart",
            routePatterns: ["/store/product-types"],
          },
          {
            id: "store-collections",
            partitionFamily: "cart",
            routePatterns: ["/store/collections", "/store/collections/:id"],
          },
          {
            id: "store-product-tags",
            partitionFamily: "cart",
            routePatterns: ["/store/product-tags", "/store/product-tags/:id"],
          },
        ],
      },
      urlDerivedRouteSelection: {
        routeGroups: [
          {
            id: "store-cart-retrieve",
            partitionFamily: "cart",
            routePatterns: ["/store/carts/:id"],
          },
        ],
      },
      provenProductionBindings: [
        "Durable Object SQLite manager for commerce persistence",
        "Durable Object-backed HTTP auth session store",
        "Cloudflare HTTP configModule and proof bearer auth-context preparation hooks",
        "Remote Query and QUERY.graph bindings",
        "Workflow execution, schedule, delayed-action, and alarm recovery stores",
        "Cloudflare locking namespace and queue bindings wired into module options",
        "Explicit tenant-scoped partition routing for bounded Store read routes",
        "URL-derived Cart partition routing for Store cart retrieve",
      ],
      remainingDefaultWorkerBoundary: [
        "Most default Worker requests without x-medusa-partition-key still need production partition-selection policies before proof HTTP options can be removed globally",
      ],
    })
  })

  it("requires a partition key and target path for the non-default production HTTP route", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/medusa-http-runtime/partitions/cart_1"),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(400)
    expect(isErrorResponse(body)).toBe(true)
    if (!isErrorResponse(body)) {
      throw new Error("Partition route error response did not match shape")
    }
    expect(body.error).toBe(
      "Medusa HTTP partition route must include a partition key and target path"
    )
  })

  it("requires the Cart DO binding before forwarding the non-default production HTTP route", async () => {
    const response = await worker.fetch(
      new Request(
        "https://example.com/medusa-http-runtime/partitions/cart_1/store/currencies"
      ),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(503)
    expect(isErrorResponse(body)).toBe(true)
    if (!isErrorResponse(body)) {
      throw new Error("Partition route binding error response did not match shape")
    }
    expect(body.error).toBe(
      "Durable Object binding CART_PROOFS is not configured"
    )
  })

  it("forwards the non-default production HTTP route to a tenant partition", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request(
        "https://example.com/medusa-http-runtime/partitions/cart_1/store/currencies?limit=1",
        {
          headers: {
            "x-medusa-tenant-id": "tenant_a",
            "x-medusa-deployment-id": "storefront",
            "x-medusa-environment": "prod",
            "x-medusa-deployment-version": "v1",
          },
        }
      ),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe(
      "/do-cart/cart_1/http/store/currencies"
    )
    expect(cartProofs.requestSearch).toBe("?limit=1")
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error("Forwarded partition response did not match shape")
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("forwards a bounded default route to production HTTP when a partition key header is present", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request(
        "https://example.com/store/currencies?fields=code&limit=1",
        {
          headers: {
            [MEDUSA_HTTP_PARTITION_KEY_HEADER]: "cart_1",
            "x-medusa-tenant-id": "tenant_a",
            "x-medusa-deployment-id": "storefront",
            "x-medusa-environment": "prod",
            "x-medusa-deployment-version": "v1",
          },
        }
      ),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe(
      "/do-cart/cart_1/http/store/currencies"
    )
    expect(cartProofs.requestSearch).toBe("?fields=code&limit=1")
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error("Forwarded default route response did not match shape")
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("forwards bounded auth session routes to production HTTP when a partition key header is present", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request("https://example.com/auth/session", {
        method: "POST",
        headers: {
          [MEDUSA_HTTP_PARTITION_KEY_HEADER]: "cart_1",
          authorization: `Bearer ${await createStaticAuthContextToken({
            actorId: "user_worker_http_proof",
            actorType: "user",
            authIdentityId: "auth_user_worker_http_proof",
          })}`,
          "x-medusa-tenant-id": "tenant_a",
          "x-medusa-deployment-id": "storefront",
          "x-medusa-environment": "prod",
          "x-medusa-deployment-version": "v1",
        },
      }),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe("/do-cart/cart_1/http/auth/session")
    expect(cartProofs.requestSearch).toBe("")
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error(
        "Forwarded auth session route response did not match shape"
      )
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("derives the Cart production partition from GET store cart routes", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request(
        "https://example.com/store/carts/cart_1?fields=id,email,currency_code",
        {
          headers: {
            "x-medusa-tenant-id": "tenant_a",
            "x-medusa-deployment-id": "storefront",
            "x-medusa-environment": "prod",
            "x-medusa-deployment-version": "v1",
          },
        }
      ),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe(
      "/do-cart/cart_1/http/store/carts/cart_1"
    )
    expect(cartProofs.requestSearch).toBe("?fields=id,email,currency_code")
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error(
        "Forwarded headerless cart retrieve response did not match shape"
      )
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("forwards bounded product type routes to production HTTP when a partition key header is present", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request(
        "https://example.com/store/product-types?fields=id,value&limit=1",
        {
          headers: {
            [MEDUSA_HTTP_PARTITION_KEY_HEADER]: "cart_1",
            "x-medusa-tenant-id": "tenant_a",
            "x-medusa-deployment-id": "storefront",
            "x-medusa-environment": "prod",
            "x-medusa-deployment-version": "v1",
          },
        }
      ),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe(
      "/do-cart/cart_1/http/store/product-types"
    )
    expect(cartProofs.requestSearch).toBe("?fields=id,value&limit=1")
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error(
        "Forwarded product type route response did not match shape"
      )
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("forwards bounded collection routes to production HTTP when a partition key header is present", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request(
        "https://example.com/store/collections/pcol_1?fields=id,title,products.id&limit=1",
        {
          headers: {
            [MEDUSA_HTTP_PARTITION_KEY_HEADER]: "cart_1",
            "x-medusa-tenant-id": "tenant_a",
            "x-medusa-deployment-id": "storefront",
            "x-medusa-environment": "prod",
            "x-medusa-deployment-version": "v1",
          },
        }
      ),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe(
      "/do-cart/cart_1/http/store/collections/pcol_1"
    )
    expect(cartProofs.requestSearch).toBe(
      "?fields=id,title,products.id&limit=1"
    )
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error(
        "Forwarded collection route response did not match shape"
      )
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("forwards bounded product tag routes to production HTTP when a partition key header is present", async () => {
    const cartProofs = new RecordingDurableObjectNamespace()
    const response = await worker.fetch(
      new Request(
        "https://example.com/store/product-tags/ptag_1?fields=id,value&limit=1",
        {
          headers: {
            [MEDUSA_HTTP_PARTITION_KEY_HEADER]: "cart_1",
            "x-medusa-tenant-id": "tenant_a",
            "x-medusa-deployment-id": "storefront",
            "x-medusa-environment": "prod",
            "x-medusa-deployment-version": "v1",
          },
        }
      ),
      {
        CART_PROOFS: cartProofs,
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-partition-name")).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
    expect(cartProofs.requestPathname).toBe(
      "/do-cart/cart_1/http/store/product-tags/ptag_1"
    )
    expect(cartProofs.requestSearch).toBe("?fields=id,value&limit=1")
    expect(isForwardedPartitionResponse(body)).toBe(true)
    if (!isForwardedPartitionResponse(body)) {
      throw new Error(
        "Forwarded product tag route response did not match shape"
      )
    }
    expect(body.partitionName).toBe(
      "partition:tenant_a:storefront:prod:v1:cart:cart_1"
    )
  })

  it("rejects an empty partition key header on bounded default production routes", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/store/currencies", {
        headers: {
          [MEDUSA_HTTP_PARTITION_KEY_HEADER]: " ",
        },
      }),
      {
        CART_PROOFS: new RecordingDurableObjectNamespace(),
      }
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(400)
    expect(isErrorResponse(body)).toBe(true)
    if (!isErrorResponse(body)) {
      throw new Error("Empty partition header response did not match shape")
    }
    expect(body.error).toBe(
      `${MEDUSA_HTTP_PARTITION_KEY_HEADER} header cannot be empty`
    )
  })

  it("requires D1 before composing the actual Currency module", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/currencies"),
      {}
    )

    expect(response.status).toBe(503)
  })

  it("executes static HTTP resources through the Fetch HTTP adapter", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/http-proof/worker?source=vitest"),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("x-medusa-http-proof")).toBe("static-fetch")
    expect(isStaticHttpProofResponse(body)).toBe(true)
    expect(body).toEqual({
      id: "worker",
      middlewareApplied: true,
      source: "vitest",
    })
  })

  it("executes a real Medusa route module through the Fetch HTTP adapter", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/admin/plugins"),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(isAdminPluginsResponse(body)).toBe(true)
    expect(body).toEqual({
      plugins: [
        { name: "worker-static-plugin" },
        { name: "worker-object-plugin" },
      ],
    })
  })

  it("streams workflow subscription routes through the Fetch HTTP adapter", async () => {
    const workflowId = "workflow_worker_http_subscription_vitest"
    const controller = new AbortController()
    const response = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${workflowId}/subscribe?workflow_id=${workflowId}`,
        {
          signal: controller.signal,
        }
      ),
      {}
    )

    if (response.status !== 200) {
      throw new Error(
        `Workflow subscription route failed: ${response.status} ${await response.text()}`
      )
    }

    expect(response.headers.get("content-type")).toBe("text/event-stream")
    const responseBody = response.body
    if (!responseBody) {
      throw new Error("Workflow subscription response did not include a body")
    }

    const reader = responseBody.getReader()
    const { value } = await reader.read()
    controller.abort()
    await reader.cancel()
    reader.releaseLock()

    const event = new TextDecoder().decode(value)
    expect(event).toContain("event: workflow.proof")
    expect(event).toContain(`"workflow_id":"${workflowId}"`)
    expect(event).toContain(
      '"transaction_id":"trx_worker_http_subscription_proof"'
    )
  })

  it("executes workflow execution read routes through the Fetch HTTP adapter", async () => {
    await worker.fetch(
      new Request("https://example.com/http-proof/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
      {}
    )

    const workflowId = "workflow_worker_http_read_vitest"
    const transactionId = "trx_worker_http_read_vitest"
    const runResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${workflowId}/run`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            transaction_id: transactionId,
            input: {
              source: "worker-read-proof",
            },
          }),
        }
      ),
      {}
    )

    expect(runResponse.status).toBe(200)
    expect(runResponse.headers.get("x-medusa-http-proof")).toBe(null)
    const runBody: unknown = await runResponse.json()
    expect(isAdminWorkflowRunResponse(runBody)).toBe(true)
    if (!isAdminWorkflowRunResponse(runBody)) {
      throw new Error("Workflow execution run response did not match shape")
    }
    expect(runBody.acknowledgement).toEqual({
      transactionId,
      workflowId,
      hasFailed: false,
      hasFinished: false,
    })

    const listResponse = await worker.fetch(
      new Request(
        "https://example.com/admin/workflows-executions?q=read_vitest&limit=10&offset=0",
        {
          headers: {
            "x-medusa-access-token": "user_worker_http_proof",
          },
        }
      ),
      {}
    )
    const listBody: unknown = await listResponse.json()

    expect(listResponse.status).toBe(200)
    expect(listResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminWorkflowExecutionsResponse(listBody)).toBe(true)
    if (!isAdminWorkflowExecutionsResponse(listBody)) {
      throw new Error("Workflow execution list response did not match shape")
    }

    const listedExecution = listBody.workflow_executions.find(
      (execution) =>
        execution.workflow_id === workflowId &&
        execution.transaction_id === transactionId
    )
    expect(listedExecution).toBeDefined()
    if (!listedExecution) {
      throw new Error("Seeded workflow execution was not listed")
    }
    expect(listBody.count).toBeGreaterThanOrEqual(1)

    const byIdResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${listedExecution.id}`,
        {
          headers: {
            "x-medusa-access-token": "user_worker_http_proof",
          },
        }
      ),
      {}
    )
    const byIdBody: unknown = await byIdResponse.json()

    expect(byIdResponse.status).toBe(200)
    expect(byIdResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminWorkflowExecutionResponse(byIdBody)).toBe(true)
    if (!isAdminWorkflowExecutionResponse(byIdBody)) {
      throw new Error("Workflow execution by-id response did not match shape")
    }
    expect(byIdBody.workflow_execution.id).toBe(listedExecution.id)
    expect(byIdBody.workflow_execution.workflow_id).toBe(workflowId)
    expect(byIdBody.workflow_execution.transaction_id).toBe(transactionId)
    expect(byIdBody.workflow_execution.state).toBe("invoking")

    const stepId = "step_worker_http_read_vitest"
    const stepResponse = { result: "worker-step-success" }
    const compensateInput = { revert: "worker-step-success" }
    const successResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${workflowId}/steps/success`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-medusa-access-token": "user_worker_http_proof",
          },
          body: JSON.stringify({
            transaction_id: transactionId,
            step_id: stepId,
            response: stepResponse,
            compensate_input: compensateInput,
          }),
        }
      ),
      {}
    )
    const successBody: unknown = await successResponse.json()

    expect(successResponse.status).toBe(200)
    expect(successResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(successBody).toEqual({ success: true })

    const byWorkflowTransactionResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${workflowId}/${transactionId}`,
        {
          headers: {
            "x-medusa-access-token": "user_worker_http_proof",
          },
        }
      ),
      {}
    )
    const byWorkflowTransactionBody: unknown =
      await byWorkflowTransactionResponse.json()

    expect(byWorkflowTransactionResponse.status).toBe(200)
    expect(byWorkflowTransactionResponse.headers.get("x-medusa-http-proof")).toBe(
      null
    )
    expect(isAdminWorkflowExecutionResponse(byWorkflowTransactionBody)).toBe(
      true
    )
    if (!isAdminWorkflowExecutionResponse(byWorkflowTransactionBody)) {
      throw new Error(
        "Workflow execution by workflow/transaction response did not match shape"
      )
    }
    expect(byWorkflowTransactionBody.workflow_execution.id).toBe(
      listedExecution.id
    )
    expect(byWorkflowTransactionBody.workflow_execution.workflow_id).toBe(
      workflowId
    )
    expect(byWorkflowTransactionBody.workflow_execution.transaction_id).toBe(
      transactionId
    )
    expect(byWorkflowTransactionBody.workflow_execution.state).toBe("done")
    expect(byWorkflowTransactionBody.workflow_execution.execution).toEqual(
      expect.objectContaining({
        hasWaitingSteps: false,
      })
    )
    expect(
      getWorkflowExecutionInvokeStep(
        byWorkflowTransactionBody.workflow_execution,
        stepId
      )
    ).toEqual({
      __type: "Symbol(WorkflowStepResponse)",
      output: stepResponse,
      compensateInput,
    })

    const failureWorkflowId = "workflow_worker_http_failure_vitest"
    const failureTransactionId = "trx_worker_http_failure_vitest"
    const failureStepId = "step_worker_http_failure_vitest"
    const failureResponse = { error: "worker-step-failure" }
    const failureCompensateInput = { revert: "worker-step-failure" }

    const failureRunResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${failureWorkflowId}/run`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            transaction_id: failureTransactionId,
            input: {
              source: "worker-failure-proof",
            },
          }),
        }
      ),
      {}
    )

    expect(failureRunResponse.status).toBe(200)
    expect(failureRunResponse.headers.get("x-medusa-http-proof")).toBe(null)

    const failureStepResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${failureWorkflowId}/steps/failure`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-medusa-access-token": "user_worker_http_proof",
          },
          body: JSON.stringify({
            transaction_id: failureTransactionId,
            step_id: failureStepId,
            response: failureResponse,
            compensate_input: failureCompensateInput,
          }),
        }
      ),
      {}
    )
    const failureStepBody: unknown = await failureStepResponse.json()

    expect(failureStepResponse.status).toBe(200)
    expect(failureStepResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(failureStepBody).toEqual({ success: true })

    const failedExecutionResponse = await worker.fetch(
      new Request(
        `https://example.com/admin/workflows-executions/${failureWorkflowId}/${failureTransactionId}`,
        {
          headers: {
            "x-medusa-access-token": "user_worker_http_proof",
          },
        }
      ),
      {}
    )
    const failedExecutionBody: unknown = await failedExecutionResponse.json()

    expect(failedExecutionResponse.status).toBe(200)
    expect(failedExecutionResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminWorkflowExecutionResponse(failedExecutionBody)).toBe(true)
    if (!isAdminWorkflowExecutionResponse(failedExecutionBody)) {
      throw new Error("Failed workflow execution response did not match shape")
    }
    expect(failedExecutionBody.workflow_execution.state).toBe("reverted")
    expect(failedExecutionBody.workflow_execution.execution).toEqual(
      expect.objectContaining({
        hasFailedSteps: true,
        hasWaitingSteps: false,
        hasRevertedSteps: true,
      })
    )
    expect(
      getWorkflowExecutionInvokeStep(
        failedExecutionBody.workflow_execution,
        failureStepId
      )
    ).toEqual({
      __type: "Symbol(WorkflowStepResponse)",
      output: failureResponse,
      compensateInput: failureCompensateInput,
    })
  })

  it("executes Admin Index routes through the Fetch HTTP adapter", async () => {
    const authHeaders = {
      "x-medusa-access-token": "user_worker_http_proof",
    }
    const detailsResponse = await worker.fetch(
      new Request("https://example.com/admin/index/details", {
        headers: authHeaders,
      }),
      {}
    )
    const detailsBody: unknown = await detailsResponse.json()

    expect(detailsResponse.status).toBe(200)
    expect(isAdminIndexDetailsResponse(detailsBody)).toBe(true)
    if (!isAdminIndexDetailsResponse(detailsBody)) {
      throw new Error("Admin Index details response did not match proof shape")
    }
    expect(detailsBody.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          fields: ["id", "title", "handle", "status"],
          status: "pending",
        }),
      ])
    )

    const syncResponse = await worker.fetch(
      new Request("https://example.com/admin/index/sync", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ strategy: "full" }),
      }),
      {}
    )

    expect(syncResponse.status).toBe(200)
    expect(await syncResponse.text()).toBe("OK")
  })

  it("executes Admin Users read routes through the Fetch HTTP adapter", async () => {
    await worker.fetch(
      new Request("https://example.com/http-proof/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
      {}
    )

    const authHeaders = {
      "x-medusa-access-token": "user_worker_http_proof",
    }
    const meResponse = await worker.fetch(
      new Request("https://example.com/admin/users/me", {
        headers: authHeaders,
      }),
      {}
    )
    const meBody: unknown = await meResponse.json()

    expect(meResponse.status).toBe(200)
    expect(meResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserResponse(meBody)).toBe(true)
    if (!isAdminUserResponse(meBody)) {
      throw new Error("Admin Users me response did not match shape")
    }
    expect(meBody.user).toEqual(
      expect.objectContaining({
        id: "user_worker_http_proof",
        email: "user_worker_http_proof@worker-http-proof.local",
      })
    )

    const listResponse = await worker.fetch(
      new Request(
        "https://example.com/admin/users?q=worker_http_proof&limit=10&offset=0",
        {
          headers: authHeaders,
        }
      ),
      {}
    )
    const listBody: unknown = await listResponse.json()

    expect(listResponse.status).toBe(200)
    expect(listResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUsersResponse(listBody)).toBe(true)
    if (!isAdminUsersResponse(listBody)) {
      throw new Error("Admin Users list response did not match shape")
    }
    expect(listBody.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "user_worker_http_proof",
          email: "user_worker_http_proof@worker-http-proof.local",
        }),
      ])
    )
    expect(listBody.count).toBeGreaterThanOrEqual(1)
    expect(listBody.offset).toBe(0)
    expect(listBody.limit).toBe(10)

    const retrieveResponse = await worker.fetch(
      new Request("https://example.com/admin/users/user_worker_http_proof", {
        headers: authHeaders,
      }),
      {}
    )
    const retrieveBody: unknown = await retrieveResponse.json()

    expect(retrieveResponse.status).toBe(200)
    expect(retrieveResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserResponse(retrieveBody)).toBe(true)
    if (!isAdminUserResponse(retrieveBody)) {
      throw new Error("Admin Users retrieve response did not match shape")
    }
    expect(retrieveBody.user).toEqual(
      expect.objectContaining({
        id: "user_worker_http_proof",
        email: "user_worker_http_proof@worker-http-proof.local",
      })
    )

    const updateResponse = await worker.fetch(
      new Request("https://example.com/admin/users/user_worker_http_proof", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          first_name: "Updated",
          last_name: "Worker",
          metadata: {
            source: "fetch-static-proof",
          },
        }),
      }),
      {}
    )
    const updateBody: unknown = await updateResponse.json()

    expect(updateResponse.status).toBe(200)
    expect(updateResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserResponse(updateBody)).toBe(true)
    if (!isAdminUserResponse(updateBody)) {
      throw new Error("Admin Users update response did not match shape")
    }
    expect(updateBody.user).toEqual(
      expect.objectContaining({
        id: "user_worker_http_proof",
        email: "user_worker_http_proof@worker-http-proof.local",
        first_name: "Updated",
        last_name: "Worker",
      })
    )

    const rolesResponse = await worker.fetch(
      new Request(
        "https://example.com/admin/users/user_worker_http_proof/roles?limit=10&offset=0",
        {
          headers: authHeaders,
        }
      ),
      {}
    )
    const rolesBody: unknown = await rolesResponse.json()

    expect(rolesResponse.status).toBe(200)
    expect(rolesResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserRolesResponse(rolesBody)).toBe(true)
    if (!isAdminUserRolesResponse(rolesBody)) {
      throw new Error("Admin Users roles response did not match shape")
    }
    expect(rolesBody.roles).toEqual(expect.any(Array))
    expect(rolesBody.offset).toBe(0)
    expect(rolesBody.limit).toBe(10)

    const assignRolesResponse = await worker.fetch(
      new Request("https://example.com/admin/users/user_worker_http_proof/roles", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ roles: ["role_super_admin"] }),
      }),
      {}
    )
    const assignRolesBody: unknown = await assignRolesResponse.json()

    expect(assignRolesResponse.status).toBe(200)
    expect(assignRolesResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserRoleMutationResponse(assignRolesBody)).toBe(true)
    if (!isAdminUserRoleMutationResponse(assignRolesBody)) {
      throw new Error("Admin Users role assignment response did not match shape")
    }
    expect(assignRolesBody.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "role_super_admin",
        }),
      ])
    )

    const removeRolesResponse = await worker.fetch(
      new Request("https://example.com/admin/users/user_worker_http_proof/roles", {
        method: "DELETE",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ roles: ["role_super_admin"] }),
      }),
      {}
    )
    const removeRolesBody: unknown = await removeRolesResponse.json()

    expect(removeRolesResponse.status).toBe(200)
    expect(removeRolesResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserRolesDeleteResponse(removeRolesBody)).toBe(true)
    if (!isAdminUserRolesDeleteResponse(removeRolesBody)) {
      throw new Error("Admin Users roles delete response did not match shape")
    }
    expect(removeRolesBody.ids).toEqual(["role_super_admin"])
    expect(removeRolesBody.object).toBe("user_role")
    expect(removeRolesBody.deleted).toBe(true)

    const reassignRolesResponse = await worker.fetch(
      new Request("https://example.com/admin/users/user_worker_http_proof/roles", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ roles: ["role_super_admin"] }),
      }),
      {}
    )

    expect(reassignRolesResponse.status).toBe(200)
    expect(reassignRolesResponse.headers.get("x-medusa-http-proof")).toBe(null)

    const removeRoleResponse = await worker.fetch(
      new Request(
        "https://example.com/admin/users/user_worker_http_proof/roles/role_super_admin",
        {
          method: "DELETE",
          headers: authHeaders,
        }
      ),
      {}
    )
    const removeRoleBody: unknown = await removeRoleResponse.json()

    expect(removeRoleResponse.status).toBe(200)
    expect(removeRoleResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserRoleDeleteResponse(removeRoleBody)).toBe(true)
    if (!isAdminUserRoleDeleteResponse(removeRoleBody)) {
      throw new Error("Admin Users role delete response did not match shape")
    }
    expect(removeRoleBody.id).toBe("role_super_admin")
    expect(removeRoleBody.object).toBe("user_role")
    expect(removeRoleBody.deleted).toBe(true)

    await worker.fetch(
      new Request("https://example.com/http-proof/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          users: [
            {
              id: "user_worker_http_delete_proof",
              email: "user_worker_http_delete_proof@worker-http-proof.local",
            },
          ],
        }),
      }),
      {}
    )
    await worker.fetch(
      new Request("https://example.com/http-proof/auth-identities", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          auth_identities: [
            {
              id: "auth_identity_worker_http_delete_proof",
              app_metadata: {
                user_id: "user_worker_http_delete_proof",
              },
              provider_identities: [
                {
                  provider: "emailpass",
                  entity_id:
                    "user_worker_http_delete_proof@worker-http-proof.local",
                },
              ],
            },
          ],
        }),
      }),
      {}
    )

    const deleteUserResponse = await worker.fetch(
      new Request(
        "https://example.com/admin/users/user_worker_http_delete_proof",
        {
          method: "DELETE",
          headers: authHeaders,
        }
      ),
      {}
    )
    const deleteUserBody: unknown = await deleteUserResponse.json()

    expect(deleteUserResponse.status).toBe(200)
    expect(deleteUserResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAdminUserDeleteResponse(deleteUserBody)).toBe(true)
    if (!isAdminUserDeleteResponse(deleteUserBody)) {
      throw new Error("Admin Users delete response did not match shape")
    }
    expect(deleteUserBody.id).toBe("user_worker_http_delete_proof")
    expect(deleteUserBody.object).toBe("user")
    expect(deleteUserBody.deleted).toBe(true)
  })

  it("executes the real payment webhook route with preserved raw body", async () => {
    await worker.fetch(
      new Request("https://example.com/http-proof/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
      {}
    )

    const rawWebhookBody = JSON.stringify({
      id: "evt_worker_http_proof",
      type: "payment_intent.succeeded",
    })
    const webhookResponse = await worker.fetch(
      new Request("https://example.com/hooks/payment/pp_system_default", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-proof": "raw-body",
        },
        body: rawWebhookBody,
      }),
      {}
    )

    const webhookResponseBody = await webhookResponse.text()
    if (webhookResponse.status !== 200 || webhookResponseBody !== "OK") {
      throw new Error(
        `Webhook route failed: ${webhookResponse.status} ${webhookResponseBody}`
      )
    }

    const eventsResponse = await worker.fetch(
      new Request("https://example.com/http-proof/webhook-events"),
      {}
    )
    const body: unknown = await eventsResponse.json()

    expect(eventsResponse.status).toBe(200)
    expect(isWebhookEventsResponse(body)).toBe(true)
    if (!isWebhookEventsResponse(body)) {
      throw new Error("Webhook event proof response did not match shape")
    }

    expect(body.events).toEqual([
      {
        message: {
          name: "payment.webhook_received",
          data: {
            provider: "pp_system_default",
            payload: {
              data: {
                id: "evt_worker_http_proof",
                type: "payment_intent.succeeded",
              },
              rawData: {
                type: "Uint8Array",
                length: rawWebhookBody.length,
                text: rawWebhookBody,
              },
              headers: expect.objectContaining({
                "content-type": "application/json",
                "x-webhook-proof": "raw-body",
              }),
            },
          },
        },
        options: {
          delay: 5000,
          attempts: 1,
        },
      },
    ])
  })

  it("executes real Auth login, register, token refresh, and update routes through the Fetch HTTP adapter", async () => {
    await worker.fetch(
      new Request("https://example.com/http-proof/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
      {}
    )

    const credentials = {
      email: "auth-route-worker@example.com",
      password: "auth-route-worker-password",
    }
    const registerResponse = await worker.fetch(
      new Request("https://example.com/auth/user/emailpass/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(credentials),
      }),
      {}
    )
    const registerBody: unknown = await registerResponse.json()

    expect(registerResponse.status).toBe(200)
    expect(registerResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAuthTokenResponse(registerBody)).toBe(true)
    if (!isAuthTokenResponse(registerBody)) {
      throw new Error("Auth register response did not include a token")
    }

    const registerPayload = decodeStaticJwtPayload(registerBody.token)
    expect(registerPayload).toEqual(
      expect.objectContaining({
        actor_type: "user",
        auth_identity_id: "authid_worker_http_proof_1",
      })
    )
    expect(registerPayload.user_metadata).toEqual({
      email: credentials.email,
    })

    const resetPasswordResponse = await worker.fetch(
      new Request("https://example.com/auth/user/emailpass/reset-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          identifier: credentials.email,
          metadata: {
            source: "auth-route-worker",
          },
        }),
      }),
      {}
    )
    const resetPasswordBody = await resetPasswordResponse.text()

    expect(resetPasswordResponse.status).toBe(201)
    expect(resetPasswordResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(resetPasswordBody).toBe("Created")

    const authEventsResponse = await worker.fetch(
      new Request("https://example.com/http-proof/webhook-events"),
      {}
    )
    const authEventsBody: unknown = await authEventsResponse.json()

    expect(authEventsResponse.status).toBe(200)
    expect(isWebhookEventsResponse(authEventsBody)).toBe(true)
    if (!isWebhookEventsResponse(authEventsBody)) {
      throw new Error("Auth event proof response did not match shape")
    }

    const resetPasswordEvent = authEventsBody.events.find((event) =>
      isNamedWebhookEvent(event, "auth.password_reset")
    )
    expect(isNamedWebhookEvent(resetPasswordEvent, "auth.password_reset")).toBe(
      true
    )
    if (!isNamedWebhookEvent(resetPasswordEvent, "auth.password_reset")) {
      throw new Error("Reset password event was not released")
    }

    expect(resetPasswordEvent.message.data).toEqual(
      expect.objectContaining({
        entity_id: credentials.email,
        actor_type: "user",
        metadata: {
          source: "auth-route-worker",
        },
      })
    )
    expect(resetPasswordEvent.options).toBeUndefined()

    const resetPasswordToken = getStringRecordValue(
      resetPasswordEvent.message.data,
      "token"
    )
    if (!resetPasswordToken) {
      throw new Error("Reset password event did not include a token")
    }

    const resetPasswordPayload = decodeStaticJwtPayload(resetPasswordToken)
    expect(resetPasswordPayload).toEqual(
      expect.objectContaining({
        entity_id: credentials.email,
        provider: "emailpass",
        actor_type: "user",
      })
    )

    const loginResponse = await worker.fetch(
      new Request("https://example.com/auth/user/emailpass", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(credentials),
      }),
      {}
    )
    const loginBody: unknown = await loginResponse.json()

    expect(loginResponse.status).toBe(200)
    expect(loginResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAuthTokenResponse(loginBody)).toBe(true)
    if (!isAuthTokenResponse(loginBody)) {
      throw new Error("Auth login response did not include a token")
    }

    const loginPayload = decodeStaticJwtPayload(loginBody.token)
    expect(loginPayload).toEqual(
      expect.objectContaining({
        actor_type: "user",
        auth_identity_id: "authid_worker_http_proof_1",
      })
    )
    expect(loginPayload.user_metadata).toEqual({
      email: credentials.email,
    })

    const refreshResponse = await worker.fetch(
      new Request("https://example.com/auth/token/refresh", {
        method: "POST",
        headers: {
          authorization: `Bearer ${loginBody.token}`,
          "x-medusa-access-token": "user_worker_http_proof",
        },
      }),
      {}
    )
    const refreshBody: unknown = await refreshResponse.json()

    expect(refreshResponse.status).toBe(200)
    expect(refreshResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAuthTokenResponse(refreshBody)).toBe(true)
    if (!isAuthTokenResponse(refreshBody)) {
      throw new Error("Auth token refresh response did not include a token")
    }

    const refreshPayload = decodeStaticJwtPayload(refreshBody.token)
    expect(refreshPayload).toEqual(
      expect.objectContaining({
        actor_type: "user",
        auth_identity_id: "authid_worker_http_proof_1",
      })
    )
    expect(refreshPayload.user_metadata).toEqual({})

    const updatedPassword = "auth-route-worker-updated-password"
    const updateToken = createStaticUpdateProviderToken({
      actorType: "user",
      provider: "emailpass",
      entityId: credentials.email,
    })
    const updateResponse = await worker.fetch(
      new Request("https://example.com/auth/user/emailpass/update", {
        method: "POST",
        headers: {
          authorization: `Bearer ${updateToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          password: updatedPassword,
        }),
      }),
      {}
    )
    const updateBody: unknown = await updateResponse.json()

    expect(updateResponse.status).toBe(200)
    expect(updateResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(updateBody).toEqual({ success: true })

    const updatedLoginResponse = await worker.fetch(
      new Request("https://example.com/auth/user/emailpass", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: credentials.email,
          password: updatedPassword,
        }),
      }),
      {}
    )
    const updatedLoginBody: unknown = await updatedLoginResponse.json()

    expect(updatedLoginResponse.status).toBe(200)
    expect(updatedLoginResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAuthTokenResponse(updatedLoginBody)).toBe(true)
  })

  it("executes the real Auth session route through Fetch session hooks", async () => {
    await worker.fetch(
      new Request("https://example.com/http-proof/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }),
      {}
    )

    const sessionResponse = await worker.fetch(
      new Request("https://example.com/auth/session", {
        method: "POST",
        headers: {
          "x-medusa-access-token": "user_worker_http_proof",
        },
      }),
      {}
    )
    const sessionBody: unknown = await sessionResponse.json()
    const sessionCookie = sessionResponse.headers.get("set-cookie")

    expect(sessionResponse.status).toBe(200)
    expect(sessionResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(isAuthSessionResponse(sessionBody)).toBe(true)
    if (!isAuthSessionResponse(sessionBody)) {
      throw new Error("Auth session response did not include a user context")
    }
    expect(sessionBody.user.actor_id).toBe("user_worker_http_proof")
    expect(sessionBody.user.actor_type).toBe("user")
    expect(sessionCookie).toBe(
      "connect.sid=session_worker_http_proof_1; Path=/; HttpOnly"
    )

    const deleteResponse = await worker.fetch(
      new Request("https://example.com/auth/session", {
        method: "DELETE",
        headers: {
          cookie: sessionCookie ?? "",
        },
      }),
      {}
    )
    const deleteBody: unknown = await deleteResponse.json()

    expect(deleteResponse.status).toBe(200)
    expect(deleteResponse.headers.get("x-medusa-http-proof")).toBe(null)
    expect(deleteResponse.headers.get("set-cookie")).toBe(
      "connect.sid=; Path=/; HttpOnly; Max-Age=0"
    )
    expect(deleteBody).toEqual({ success: true })
  })

  it("prepares request metadata for a real Medusa remote-query route", async () => {
    const response = await worker.fetch(
      new Request(
        "https://example.com/store/currencies?fields=code,symbol,name&code=usd&limit=5&offset=1",
        {
          headers: {
            "x-publishable-api-key": "pk_worker_http_proof_default",
          },
        }
      ),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(isStoreCurrenciesResponse(body)).toBe(true)
    expect(body).toEqual({
      currencies: [
        {
          code: "usd",
          decimal_digits: 2,
          fields: ["code", "symbol", "name", "id"],
          filter: "usd",
          name: "US Dollar",
          name_plural: "US dollars",
          rounding: 0,
          symbol: "$",
          symbol_native: "$",
        },
      ],
      count: 1,
      offset: 1,
      limit: 5,
    })
  })

  it("executes the real Admin currency route through the Fetch HTTP adapter", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/admin/currencies?order=code"),
      {}
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    if (!isAdminCurrenciesResponse(body)) {
      throw new Error("Admin currencies response did not match proof shape")
    }
    expect(body.currencies).toHaveLength(123)
    expect(body.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "usd",
          name: "US Dollar",
        }),
      ])
    )

    const filteredResponse = await worker.fetch(
      new Request("https://example.com/admin/currencies?q=us&order=code"),
      {}
    )
    const filteredBody: unknown = await filteredResponse.json()

    expect(filteredResponse.status).toBe(200)
    if (!isAdminCurrenciesResponse(filteredBody)) {
      throw new Error("Filtered admin currencies response did not match proof shape")
    }
    expect(filteredBody.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "aud",
          name: "Australian Dollar",
        }),
        expect.objectContaining({
          code: "byn",
          name: "Belarusian Ruble",
        }),
        expect.objectContaining({
          code: "rub",
          name: "Russian Ruble",
        }),
        expect.objectContaining({
          code: "usd",
          name: "US Dollar",
        }),
      ])
    )
  })

  it("acks invalid Cloudflare Event Bus queue messages", async () => {
    const message = createQueueMessage({ name: 123 })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      await worker.queue(createMessageBatch([message.message]), {
        MEDUSA_EVENTS: createRecordingQueue(),
      })
    } finally {
      consoleError.mockRestore()
    }

    expect(message.state.ackCount).toBe(1)
    expect(message.state.retryCount).toBe(0)
  })

  it("dispatches valid Cloudflare Event Bus queue messages and acks them", async () => {
    const proofs = new RecordingEventConsumerProofNamespace()
    const message = createQueueMessage({
      name: "cloudflare.queue.proof",
      data: { id: "proof_123" },
      metadata: { eventConsumerProofId: "proof_123" },
    })

    await worker.queue(createMessageBatch([message.message]), {
      MEDUSA_EVENTS: createRecordingQueue(),
      EVENT_CONSUMER_PROOFS: proofs,
    })

    expect(message.state.ackCount).toBe(1)
    expect(message.state.retryCount).toBe(0)
    expect(proofs.records).toEqual([
      {
        id: "proof_123",
        eventName: "cloudflare.queue.proof",
      },
    ])
  })

  it("retries Cloudflare Event Bus queue messages when dispatch fails", async () => {
    const proofs = new RecordingEventConsumerProofNamespace({
      failRecord: true,
    })
    const message = createQueueMessage({
      name: "cloudflare.queue.proof",
      data: { id: "proof_123" },
      metadata: { eventConsumerProofId: "proof_123" },
    })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      await worker.queue(createMessageBatch([message.message]), {
        MEDUSA_EVENTS: createRecordingQueue(),
        EVENT_CONSUMER_PROOFS: proofs,
      })
    } finally {
      consoleError.mockRestore()
    }

    expect(message.state.ackCount).toBe(0)
    expect(message.state.retryCount).toBe(1)
    expect(proofs.records).toEqual([])
  })
})

interface QueueMessageState {
  ackCount: number
  retryCount: number
}

function createQueueMessage(body: unknown): {
  message: Message<unknown>
  state: QueueMessageState
} {
  const state: QueueMessageState = {
    ackCount: 0,
    retryCount: 0,
  }

  return {
    state,
    message: {
      id: "message_1",
      timestamp: new Date(0),
      body,
      attempts: 1,
      ack: () => {
        state.ackCount++
      },
      retry: () => {
        state.retryCount++
      },
    },
  }
}

function createMessageBatch(
  messages: readonly Message<unknown>[]
): MessageBatch<unknown> {
  return {
    messages,
    queue: "MEDUSA_EVENTS",
    metadata: {
      metrics: {
        backlogBytes: 0,
        backlogCount: messages.length,
      },
    },
    ackAll: () => void 0,
    retryAll: () => void 0,
  }
}

function createRecordingQueue() {
  return {
    send: async () => void 0,
  }
}

class RecordingEventConsumerProofNamespace {
  readonly records: Array<{ id: string; eventName: string }> = []
  readonly #failRecord: boolean

  constructor({ failRecord = false }: { failRecord?: boolean } = {}) {
    this.#failRecord = failRecord
  }

  getByName(_name: string): {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  } {
    return {
      fetch: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init)
        const pathname = new URL(request.url).pathname

        if (pathname === "/record") {
          if (this.#failRecord) {
            throw new Error("proof record failed")
          }

          const body: unknown = await request.json()
          if (isProofRecord(body)) {
            this.records.push(body)
          }
        }

        return Response.json({ ok: true })
      },
    }
  }
}

function isProofRecord(value: unknown): value is {
  id: string
  eventName: string
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.eventName === "string"
  )
}

function isWorkerHealthResponse(value: unknown): value is {
  status: string
  runtime: string
} {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    typeof value.runtime === "string"
  )
}

function isStaticHttpProofResponse(value: unknown): value is {
  id: string
  middlewareApplied: boolean
  source: string
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.middlewareApplied === "boolean" &&
    typeof value.source === "string"
  )
}

function isAdminPluginsResponse(value: unknown): value is {
  plugins: Array<{ name: string }>
} {
  return (
    isRecord(value) &&
    Array.isArray(value.plugins) &&
    value.plugins.every(
      (plugin) => isRecord(plugin) && typeof plugin.name === "string"
    )
  )
}

function isStoreCurrenciesResponse(value: unknown): value is {
  currencies: Array<Record<string, unknown>>
  count: number
  offset: number
  limit: number
} {
  return (
    isRecord(value) &&
    Array.isArray(value.currencies) &&
    typeof value.count === "number" &&
    typeof value.offset === "number" &&
    typeof value.limit === "number"
  )
}

function isAdminCurrenciesResponse(value: unknown): value is {
  currencies: Array<Record<string, unknown>>
  count: number
  offset: number
  limit: number
} {
  return isStoreCurrenciesResponse(value)
}

function isAdminIndexDetailsResponse(value: unknown): value is {
  metadata: Array<{
    entity: string
    fields: string[]
    status: string
  }>
} {
  return (
    isRecord(value) &&
    Array.isArray(value.metadata) &&
    value.metadata.every(
      (metadata) =>
        isRecord(metadata) &&
        typeof metadata.entity === "string" &&
        Array.isArray(metadata.fields) &&
        metadata.fields.every((field) => typeof field === "string") &&
        typeof metadata.status === "string"
    )
  )
}

function isAdminUserResponse(value: unknown): value is {
  user: {
    id: string
    email: string
  }
} {
  return isRecord(value) && isUserRecord(value.user)
}

function isAdminUsersResponse(value: unknown): value is {
  users: Array<{
    id: string
    email: string
  }>
  count: number
  offset: number
  limit: number
} {
  return (
    isRecord(value) &&
    Array.isArray(value.users) &&
    value.users.every(isUserRecord) &&
    typeof value.count === "number" &&
    typeof value.offset === "number" &&
    typeof value.limit === "number"
  )
}

function isAdminUserRolesResponse(value: unknown): value is {
  roles: unknown[]
  count: number
  offset: number
  limit: number
} {
  return (
    isRecord(value) &&
    Array.isArray(value.roles) &&
    typeof value.count === "number" &&
    typeof value.offset === "number" &&
    typeof value.limit === "number"
  )
}

function isAdminUserRoleMutationResponse(value: unknown): value is {
  roles: Array<{
    id: string
  }>
} {
  return (
    isRecord(value) &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => isRecord(role) && typeof role.id === "string")
  )
}

function isAdminUserRolesDeleteResponse(value: unknown): value is {
  ids: string[]
  object: string
  deleted: boolean
} {
  return (
    isRecord(value) &&
    Array.isArray(value.ids) &&
    value.ids.every((id) => typeof id === "string") &&
    typeof value.object === "string" &&
    typeof value.deleted === "boolean"
  )
}

function isAdminUserRoleDeleteResponse(value: unknown): value is {
  id: string
  object: string
  deleted: boolean
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.object === "string" &&
    typeof value.deleted === "boolean"
  )
}

function isAdminUserDeleteResponse(value: unknown): value is {
  id: string
  object: string
  deleted: boolean
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.object === "string" &&
    typeof value.deleted === "boolean"
  )
}

function isUserRecord(value: unknown): value is {
  id: string
  email: string
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string"
  )
}

function isAdminWorkflowExecutionsResponse(value: unknown): value is {
  workflow_executions: Array<{
    id: string
    workflow_id: string
    transaction_id: string
  }>
  count: number
  offset: number
  limit: number
} {
  return (
    isRecord(value) &&
    Array.isArray(value.workflow_executions) &&
    value.workflow_executions.every(isWorkflowExecutionRecord) &&
    typeof value.count === "number" &&
    typeof value.offset === "number" &&
    typeof value.limit === "number"
  )
}

function isAdminWorkflowExecutionResponse(value: unknown): value is {
  workflow_execution: {
    id: string
    workflow_id: string
    transaction_id: string
    state: string
    execution: Record<string, unknown>
    context: Record<string, unknown>
  }
} {
  if (!isRecord(value) || !isRecord(value.workflow_execution)) {
    return false
  }

  const workflowExecution = value.workflow_execution
  return (
    typeof workflowExecution.id === "string" &&
    typeof workflowExecution.workflow_id === "string" &&
    typeof workflowExecution.transaction_id === "string" &&
    typeof workflowExecution.state === "string" &&
    isRecord(workflowExecution.execution) &&
    isRecord(workflowExecution.context)
  )
}

function isErrorResponse(value: unknown): value is {
  error: string
} {
  return isRecord(value) && typeof value.error === "string"
}

function isForwardedPartitionResponse(value: unknown): value is {
  partitionName: string
} {
  return isRecord(value) && typeof value.partitionName === "string"
}

class RecordingDurableObjectNamespace implements DurableObjectFetchNamespace {
  requestPathname = ""
  requestSearch = ""
  #partitionName = ""

  getByName(name: string): DurableObjectFetchStub {
    this.#partitionName = name

    return {
      fetch: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init)
        const url = new URL(request.url)
        this.requestPathname = url.pathname
        this.requestSearch = url.search

        return Response.json({ partitionName: this.#partitionName })
      },
    }
  }
}

function isAdminWorkflowRunResponse(value: unknown): value is {
  acknowledgement: {
    transactionId: string
    workflowId: string
    hasFailed: boolean
    hasFinished: boolean
  }
} {
  return (
    isRecord(value) &&
    isRecord(value.acknowledgement) &&
    typeof value.acknowledgement.transactionId === "string" &&
    typeof value.acknowledgement.workflowId === "string" &&
    typeof value.acknowledgement.hasFailed === "boolean" &&
    typeof value.acknowledgement.hasFinished === "boolean"
  )
}

function isWorkflowExecutionRecord(value: unknown): value is {
  id: string
  workflow_id: string
  transaction_id: string
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.workflow_id === "string" &&
    typeof value.transaction_id === "string"
  )
}

function getWorkflowExecutionInvokeStep(
  execution: {
    context: Record<string, unknown>
  },
  stepId: string
): unknown {
  const data = getRecordValue(execution.context, "data")
  const invoke = getRecordValue(data, "invoke")
  return invoke?.[stepId]
}

function isWebhookEventsResponse(value: unknown): value is {
  events: unknown[]
} {
  return isRecord(value) && Array.isArray(value.events)
}

function isNamedWebhookEvent(
  value: unknown,
  name: string
): value is {
  message: {
    name: string
    data: Record<string, unknown>
  }
  options: unknown
} {
  return (
    isRecord(value) &&
    isRecord(value.message) &&
    value.message.name === name &&
    isRecord(value.message.data)
  )
}

function isAuthTokenResponse(value: unknown): value is {
  token: string
} {
  return isRecord(value) && typeof value.token === "string"
}

function isAuthSessionResponse(value: unknown): value is {
  user: {
    actor_id: string
    actor_type: string
    auth_identity_id: string
  }
} {
  return (
    isRecord(value) &&
    isRecord(value.user) &&
    typeof value.user.actor_id === "string" &&
    typeof value.user.actor_type === "string" &&
    typeof value.user.auth_identity_id === "string"
  )
}

function isMedusaHttpRuntimeStatus(value: unknown): value is {
  defaultRuntime: "static-proof"
  productionCandidate: {
    status: "blocked"
    provenBoundary: "cart-proof-durable-object"
    boundedDefaultRouteOptIn: {
      header: string
      routeGroups: Array<{
        id: string
        partitionFamily: string
        routePatterns: string[]
      }>
    }
    urlDerivedRouteSelection: {
      routeGroups: Array<{
        id: string
        partitionFamily: string
        routePatterns: string[]
      }>
    }
    provenProductionBindings: string[]
    remainingDefaultWorkerBoundary: string[]
  }
} {
  if (!isRecord(value) || value.defaultRuntime !== "static-proof") {
    return false
  }

  const productionCandidate = value.productionCandidate

  return (
    isRecord(productionCandidate) &&
    productionCandidate.status === "blocked" &&
    productionCandidate.provenBoundary === "cart-proof-durable-object" &&
    isRecord(productionCandidate.boundedDefaultRouteOptIn) &&
    typeof productionCandidate.boundedDefaultRouteOptIn.header === "string" &&
    Array.isArray(productionCandidate.boundedDefaultRouteOptIn.routeGroups) &&
    productionCandidate.boundedDefaultRouteOptIn.routeGroups.every(
      isMedusaHttpRuntimeRouteGroup
    ) &&
    isRecord(productionCandidate.urlDerivedRouteSelection) &&
    Array.isArray(productionCandidate.urlDerivedRouteSelection.routeGroups) &&
    productionCandidate.urlDerivedRouteSelection.routeGroups.every(
      isMedusaHttpRuntimeRouteGroup
    ) &&
    Array.isArray(productionCandidate.provenProductionBindings) &&
    productionCandidate.provenProductionBindings.every(
      (entry) => typeof entry === "string"
    ) &&
    Array.isArray(productionCandidate.remainingDefaultWorkerBoundary) &&
    productionCandidate.remainingDefaultWorkerBoundary.every(
      (entry) => typeof entry === "string"
    )
  )
}

function isMedusaHttpRuntimeRouteGroup(value: unknown): value is {
  id: string
  partitionFamily: string
  routePatterns: string[]
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.partitionFamily === "string" &&
    Array.isArray(value.routePatterns) &&
    value.routePatterns.every((pattern) => typeof pattern === "string")
  )
}

function decodeStaticJwtPayload(token: string): Record<string, unknown> {
  const payloadSegment = token.split(".")[1]
  if (!payloadSegment) {
    throw new Error("JWT did not include a payload segment")
  }

  const decoded: unknown = JSON.parse(decodeStaticBase64Url(payloadSegment))
  if (!isRecord(decoded)) {
    throw new Error("JWT payload was not an object")
  }

  return decoded
}

function createStaticUpdateProviderToken(input: {
  actorType: string
  provider: string
  entityId: string
}): string {
  const now = Math.floor(Date.now() / 1000)
  const header = encodeStaticBase64Url(
    JSON.stringify({ alg: "none", typ: "JWT" })
  )
  const payload = encodeStaticBase64Url(
    JSON.stringify({
      actor_type: input.actorType,
      provider: input.provider,
      entity_id: input.entityId,
      iat: now,
      exp: now + 60 * 60,
    })
  )

  return `${header}.${payload}.worker-http-proof`
}

async function createStaticAuthContextToken(input: {
  actorId: string
  actorType: string
  authIdentityId: string
}): Promise<string> {
  return await createHs256Jwt({
    secret: MEDUSA_CLOUDFLARE_WORKER_PROOF_JWT_SECRET,
    payload: {
      actor_id: input.actorId,
      actor_type: input.actorType,
      auth_identity_id: input.authIdentityId,
      app_metadata: {},
      user_metadata: {},
    },
  })
}

function getStringRecordValue(
  value: Record<string, unknown>,
  key: string
): string | null {
  const entry = value[key]
  return typeof entry === "string" ? entry : null
}

function getRecordValue(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const entry = value?.[key]
  return isRecord(entry) ? entry : undefined
}

function encodeStaticBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decodeStaticBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    Math.ceil(normalized.length / 4) * 4,
    "="
  )
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new TextDecoder().decode(bytes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
