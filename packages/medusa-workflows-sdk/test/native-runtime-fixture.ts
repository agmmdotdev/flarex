import { DistributedTransaction, DistributedTransactionStorage, TransactionCheckpoint, type TransactionStep } from "@medusajs/orchestration/transaction"
import type { NativeWorkflowRuntime, WorkflowContainer } from "@medusajs/orchestration/runtime"
import { WorkflowOrchestratorService, WorkflowsModuleService } from "@medusajs/workflows-sdk/durable/engine"

/** A native storage-protocol fixture, not a database or Redis conformance claim.
 * The JSON roundtrip deliberately exercises the native checkpoint wire semantics. */
export class Checkpoints extends DistributedTransactionStorage {
  readonly records = new Map<string, string>()
  readonly saved: string[] = []
  readonly timeouts: { transaction: DistributedTransaction; step: TransactionStep; timestamp: number; interval: number }[] = []
  override async get(key: string) {
    const bytes = this.records.get(key)
    if (bytes === undefined) return undefined
    const value = JSON.parse(bytes)
    return new TransactionCheckpoint(value.flow, value.context, value.errors)
  }
  override async save(key: string, value: TransactionCheckpoint) {
    const bytes = JSON.stringify(value)
    this.records.set(key, bytes)
    this.saved.push(key)
    const snapshot = JSON.parse(bytes)
    return new TransactionCheckpoint(snapshot.flow, snapshot.context, snapshot.errors)
  }
  override async scheduleStepTimeout(transaction: DistributedTransaction, step: TransactionStep, timestamp: number, interval: number) {
    this.timeouts.push({ transaction, step, timestamp, interval })
  }
  override async clearStepTimeout() {}
  override async clearTransactionTimeout() {}
  override async clearExpiredExecutions() {}
}

class Resolver implements WorkflowContainer {
  readonly values = new Map<string, unknown>()
  resolve<Value>(name: string, options?: { allowUnregistered?: boolean }): Value {
    if (!this.values.has(name) && !options?.allowUnregistered) throw new Error(`Missing test service ${name}`)
    // This is the native container's generic resolver boundary, not a decoder.
    return this.values.get(name) as Value
  }
}

export function execution(storage = new Checkpoints()) {
  const pending: Promise<unknown>[] = []
  const failures: unknown[] = []
  let now = 1_000_000
  const runtime: NativeWorkflowRuntime = {
    storage,
    clock: { now: () => now },
    background: { execute: work => { pending.push(work().catch(error => { failures.push(error) })) } },
  }
  const container = new Resolver()
  container.values.set("event_bus", { async releaseGroupedEvents() {}, async clearGroupedEvents() {} })
  const engine = new WorkflowOrchestratorService(runtime, container)
  const module = new WorkflowsModuleService(engine)
  container.values.set("workflows", module)
  return {
    runtime, container, engine, module, storage,
    setNow(value: number) { now = value },
    async drain() {
      let index = 0
      while (index < pending.length) await pending[index++]
      if (failures.length) throw new AggregateError(failures, "Owned native background work failed")
    },
  }
}
