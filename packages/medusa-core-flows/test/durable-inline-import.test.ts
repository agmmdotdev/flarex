import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { StepResponse } from "@medusajs/workflows-sdk/durable"
import { mergeNativeWorkflowCheckpointForSave, type IDistributedTransactionStorage } from "@medusajs/orchestration/transaction"
import { execution, Checkpoints } from "@medusajs/workflows-sdk/testing/native-runtime"
import { importProductsWorkflow, importProductsWorkflowId } from "../src/durable/product/workflows/import-products.js"
import { productImportAtomicBatchService } from "../src/durable/product/workflows/batch-products.js"
import { PRODUCT_IMPORT_MAX_CSV_BYTES, PRODUCT_IMPORT_MAX_CSV_RECORDS, productImportPlanAdmissionService } from "../src/durable/product/steps/normalize-products.js"
import { waitConfirmationProductImportStepId } from "../src/durable/product/steps/wait-confirmation-product-import.js"
import { normalizeProductsFromCsv, type NormalizedProductBatchRequest } from "../src/product/utils/normalize-products-from-csv.js"

const header = "Product Handle,Product Title,Variant Title,Variant Option 1 Name,Variant Option 1 Value\n"
const csv = header + "shirt,Shirt,Blue,Color,Blue\n"

/** Retain genuine native merge/race decisions and record scheduling requests;
 * tests drive each requested wake explicitly through the actual module. */
class NativeCheckpoints extends Checkpoints {
  readonly retries: Array<{ action: string | undefined; interval: number; state: string; attempts: number;
    invokeState: string; invokeStatus: string; compensateState: string; compensateStatus: string;
    hasScheduledRetry: boolean | undefined; retryRescheduledAt: number | null | undefined }> = []
  override async save(...[key, checkpoint, _ttl, options]: Parameters<IDistributedTransactionStorage["save"]>) {
    mergeNativeWorkflowCheckpointForSave(checkpoint, await this.get(key), options)
    return await super.save(key, checkpoint)
  }
  override async scheduleRetry(...args: Parameters<Checkpoints["scheduleRetry"]>) {
    const step = args[1]
    this.retries.push({ action: step.definition.action, interval: args[3], state: args[0].getFlow().state,
      attempts: step.attempts, invokeState: step.invoke.state, invokeStatus: step.invoke.status,
      compensateState: step.compensate.state, compensateStatus: step.compensate.status,
      hasScheduledRetry: step.hasScheduledRetry, retryRescheduledAt: step.retryRescheduledAt })
  }
  override async clearRetry() {}
}

function profile(storage?: Checkpoints) {
  const env = execution(storage)
  const admitted: NormalizedProductBatchRequest[] = []
  const batches: NormalizedProductBatchRequest[] = []
  const notifications: unknown[] = []
  env.container.values.set(productImportPlanAdmissionService, { async admit(input: NormalizedProductBatchRequest) { admitted.push(input) } })
  env.container.values.set(productImportAtomicBatchService, { async invoke(input: NormalizedProductBatchRequest) {
    batches.push(input)
    return { created: [], updated: [], deleted: [] }
  } })
  env.container.values.set("notification", { async createNotifications(input: unknown[]) {
    notifications.push(...input)
    return input.map((_, index) => ({ id: `notification_${index}` }))
  } })
  return { ...env, admitted, batches, notifications }
}

async function expectNormalizationFailure(env: ReturnType<typeof profile>, fileContent: string, message: string) {
  const transactionId = randomUUID()
  // Preserve the genuine composer's summary-resolution failure after its
  // normalization step fails; the checkpoint retains the original failure.
  await expect(env.module.run(importProductsWorkflow, { transactionId, input: { fileContent, filename: "rejected.csv" } }))
    .rejects.toThrow("Cannot read properties of undefined")
  await env.drain()
  const transaction = await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)
  expect(transaction.getFlow().state).toBe("reverted")
  expect(transaction.getErrors()).toEqual(expect.arrayContaining([
    expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining(message) }) }),
  ]))
}

/** Native composer/step + explicit finite-child profile characterization. The
 * ports below do not claim the adapter's full Product or Notification admission. */
describe("genuine inline Product import composer", { concurrent: false }, () => {
  it("admits the complete native plan before confirmation and cold-resumes through the real child", async () => {
    const first = profile()
    const transactionId = randomUUID()
    const start = await first.module.run(importProductsWorkflow, {
      transactionId, input: { fileContent: csv, filename: "products.csv" },
    })
    await first.drain()
    expect(start.result).toEqual({ toCreate: 1, toUpdate: 0 })
    expect(first.admitted).toEqual([normalizeProductsFromCsv(csv).batchRequest])
    expect(first.batches).toEqual([])
    expect(first.notifications).toEqual([])
    expect(first.storage.timeouts).toHaveLength(1)
    expect(first.storage.timeouts[0].interval).toBe(3600)

    const second = profile(first.storage)
    const wait = first.storage.timeouts[0]
    second.setNow(wait.step.startedAt! + wait.interval * 1000 + 1)
    await second.module.setStepSuccess({
      idempotencyKey: { workflowId: importProductsWorkflowId, transactionId, stepId: waitConfirmationProductImportStepId, action: "invoke" },
      stepResponse: new StepResponse(true),
    })
    await second.drain()
    expect(second.admitted).toEqual([])
    expect(second.batches).toEqual(first.admitted)
    expect(second.notifications).toEqual([{ to: "", channel: "feed", template: "admin-ui", data: {
      title: "Product import", description: "Product import of file products.csv completed successfully!",
    } }])
    expect((await second.engine.getRunningTransaction(importProductsWorkflowId, transactionId)).getFlow().state).toBe("done")
    expect(second.storage.saved.some(key => key.includes("dtrx:batch-products:"))).toBe(false)
  })

  it("keeps the native empty import branch and summary", async () => {
    const env = profile()
    const transactionId = randomUUID()
    const started = await env.module.run(importProductsWorkflow, { transactionId, input: { fileContent: header, filename: "empty.csv" } })
    await env.drain()
    expect(started.result).toEqual({ toCreate: 0, toUpdate: 0 })
    await env.module.setStepSuccess({
      idempotencyKey: { workflowId: importProductsWorkflowId, transactionId, stepId: waitConfirmationProductImportStepId, action: "invoke" },
      stepResponse: new StepResponse(true),
    })
    await env.drain()
    expect(env.batches).toEqual([{ create: [], update: [] }])
    expect(env.notifications).toHaveLength(1)
  })

  it("passes unsupported normalized fields intact to the admission owner before the wait", async () => {
    const env = profile()
    let plan: NormalizedProductBatchRequest | undefined
    env.container.values.set(productImportPlanAdmissionService, { async admit(input: NormalizedProductBatchRequest) {
      plan = input
      throw new Error("Complete Product batch profile refused")
    } })
    const fileContent = header.replace("\n", ",Product Weight\n") + "shirt,Shirt,Blue,Color,Blue,42\n"
    await expectNormalizationFailure(env, fileContent, "Complete Product batch profile refused")
    expect(plan?.create[0]?.weight).toBe(42)
    expect(env.storage.timeouts).toEqual([])
    expect(env.batches).toEqual([])
    expect(env.notifications).toEqual([])
  })

  it("refuses an oversized raw CSV before native parsing", async () => {
    const env = profile()
    await expectNormalizationFailure(env, "x".repeat(PRODUCT_IMPORT_MAX_CSV_BYTES + 1), "admitted byte limit")
    expect(env.admitted).toEqual([])
    expect(env.storage.timeouts).toEqual([])
  })

  it("counts native parsed records without reparsing or admitting a shortened plan", async () => {
    const env = profile()
    const fileContent = header + "shirt,Shirt,Blue,Color,Blue\n".repeat(PRODUCT_IMPORT_MAX_CSV_RECORDS + 1)
    expect(normalizeProductsFromCsv(fileContent).parsedRecords).toBe(65)
    await expectNormalizationFailure(env, fileContent, "admitted record limit")
    expect(env.admitted).toEqual([])
    expect(env.storage.timeouts).toEqual([])
  })

  it("preserves native CSV validator failure before plan admission", async () => {
    const env = profile()
    await expectNormalizationFailure(env, "Unknown One,Product Handle\nx,shirt\n", 'Invalid column name(s) "Unknown One"')
    expect(env.admitted).toEqual([])
    expect(env.storage.timeouts).toEqual([])
  })

  it.each([false, true])("preserves native failure after a completed finite child (failure notification rejects: %s)", async failureNotificationRejects => {
    const storage = new NativeCheckpoints()
    const env = profile(storage)
    const transactionId = randomUUID()
    const calls: string[] = []
    const groups: string[] = []
    env.container.values.set("event_bus", {
      async releaseGroupedEvents() { groups.push("released") },
      async clearGroupedEvents() { groups.push("cleared") },
    })
    env.container.values.set("notification", { async createNotifications(input: Array<{ data: { description: string } }>) {
      const role = input[0].data.description.startsWith("Failed") ? "failure" : "success"
      calls.push(role)
      if (role === "success" || failureNotificationRejects) throw new Error(`${role} provider failure`)
      return [{ id: "failure-notification" }]
    } })
    await env.module.run(importProductsWorkflow, { transactionId, input: { fileContent: csv, filename: "failure.csv" } })
    await env.drain()
    await env.module.setStepSuccess({
      idempotencyKey: { workflowId: importProductsWorkflowId, transactionId, stepId: waitConfirmationProductImportStepId, action: "invoke" },
      stepResponse: new StepResponse(true), options: { throwOnError: false },
    })
    await env.drain()
    const transaction = await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)
    expect(env.batches).toHaveLength(1)
    expect(env.storage.saved.some(key => key.includes("dtrx:batch-products:"))).toBe(false)
    await env.module.run(importProductsWorkflowId, { transactionId, input: { fileContent: csv, filename: "failure.csv" }, throwOnError: false })
    await env.drain()
    const pumped = await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)
    expect(transaction.getFlow().state).toBe("failed")
    expect(transaction.hasFinished()).toBe(true)
    expect(pumped.getFlow().state).toBe("failed")
    expect(env.batches).toHaveLength(1)
    expect(calls).toEqual(["success", "failure"])
    expect(groups).toEqual(["cleared"])
    expect(storage.retries).toEqual([{ action: "batch-products-as-step", interval: 0,
      state: "waiting_to_compensate", attempts: 1, invokeState: "failed", invokeStatus: "permanent_failure",
      compensateState: "dormant", compensateStatus: "idle", hasScheduledRetry: undefined, retryRescheduledAt: undefined }])
    expect(transaction.getErrors()).toHaveLength(failureNotificationRejects ? 3 : 2)
    expect(transaction.getErrors()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "send-notifications", handlerType: "invoke",
        error: expect.objectContaining({ message: "success provider failure" }) }),
      expect.objectContaining({ action: "batch-products-as-step", handlerType: "compensate",
        error: expect.objectContaining({ type: "not_found", message: `Transaction batch-products-as-step-${transactionId} could not be found.` }) }),
      ...(failureNotificationRejects ? [expect.objectContaining({ action: "notify-on-failure", handlerType: "compensate",
        error: expect.objectContaining({ message: "failure provider failure" }) })] : []),
    ]))
  })

  it("keeps cancellation pending until the original native confirmation timeout", async () => {
    const storage = new NativeCheckpoints()
    const env = profile(storage)
    const transactionId = randomUUID()
    const input = { fileContent: csv, filename: "cancelled.csv" }
    await env.module.run(importProductsWorkflow, { transactionId, input })
    await env.drain()
    await env.module.cancel(importProductsWorkflowId, { transactionId, throwOnError: false })
    await env.drain()
    const waiting = await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)
    expect(waiting.getFlow().state).toBe("waiting_to_compensate")
    expect(waiting.hasFinished()).toBe(false)
    expect(storage.retries).toEqual([])
    await env.module.run(importProductsWorkflowId, { transactionId, input, throwOnError: false })
    await env.drain()
    expect((await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)).getFlow().state).toBe("waiting_to_compensate")
    const wait = storage.timeouts[0]
    env.setNow(wait.step.startedAt! + wait.interval * 1000)
    await env.module.run(importProductsWorkflowId, { transactionId, input, throwOnError: false })
    await env.drain()
    expect((await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)).hasFinished()).toBe(false)
    env.setNow(wait.step.startedAt! + wait.interval * 1000 + 1)
    await env.module.run(importProductsWorkflowId, { transactionId, input, throwOnError: false })
    await env.drain()
    const terminal = await env.engine.getRunningTransaction(importProductsWorkflowId, transactionId)
    expect(terminal.getFlow().state).toBe("reverted")
    expect(terminal.hasFinished()).toBe(true)
    expect(terminal.getErrors()).toEqual([{ action: waitConfirmationProductImportStepId, handlerType: "invoke",
      error: { name: "TransactionStepTimeoutError" } }])
    expect(env.batches).toEqual([])
    expect(env.notifications).toEqual([])
    expect(storage.retries).toEqual([])
  })

  it.each(["done", "reverted", "failed"] as const)("cold terminal recovery reuses the native %s event policy", async state => {
    const storage = new NativeCheckpoints()
    const first = profile(storage)
    const transactionId = randomUUID()
    const input = { fileContent: csv, filename: "terminal.csv" }
    await first.module.run(importProductsWorkflow, { transactionId, input })
    await first.drain()
    if (state === "reverted") {
      await first.module.cancel(importProductsWorkflowId, { transactionId, throwOnError: false })
      await first.drain()
      const wait = storage.timeouts[0]
      first.setNow(wait.step.startedAt! + wait.interval * 1000 + 1)
      await first.module.run(importProductsWorkflowId, { transactionId, input, throwOnError: false })
    } else {
      if (state === "failed") first.container.values.set("notification", { async createNotifications() { throw new Error("Provider refused") } })
      await first.module.setStepSuccess({
        idempotencyKey: { workflowId: importProductsWorkflowId, transactionId, stepId: waitConfirmationProductImportStepId, action: "invoke" },
        stepResponse: new StepResponse(true), options: { throwOnError: false },
      })
    }
    await first.drain()
    const cold = profile(storage)
    const decisions: string[] = []
    cold.container.values.set("event_bus", {
      async releaseGroupedEvents() { decisions.push("released") },
      async clearGroupedEvents() { decisions.push("cleared") },
    })
    const transaction = await cold.engine.getRunningTransaction(importProductsWorkflowId, transactionId)
    expect(transaction.getFlow().state).toBe(state)
    const owner = importProductsWorkflow(cold.container)
    await owner.recoverTerminalEvents(transaction, { runtime: cold.runtime })
    await owner.recoverTerminalEvents(transaction, { runtime: cold.runtime })
    await cold.drain()
    expect(decisions).toEqual(state === "done" ? ["released", "released"] : ["cleared", "cleared"])
    expect(cold.batches).toEqual([])
    expect(cold.notifications).toEqual([])
    await expect(owner.recoverTerminalEvents(transaction, { runtime: first.runtime })).rejects.toThrow("matching native transaction and runtime")
  })
})
