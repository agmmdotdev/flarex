import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { DistributedTransaction } from "@medusajs/orchestration/transaction"
import { parseStringifyIfNecessary } from "@medusajs/utils/common/parse-stringify-if-necessary"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "../src/durable/index.js"
import { createFiniteAtomicChildWorkflow } from "../src/durable/engine/index.js"

import { execution } from "./native-runtime-fixture.js"

describe("native durable execution profile", { concurrent: false }, () => {
  it("copies native plain records with shadowed own-property and prototype names", () => {
    const input = JSON.parse('{"hasOwnProperty":"value","__proto__":{"retained":true},"nested":{"id":"p_1"}}')
    const copy = parseStringifyIfNecessary(input)
    expect(copy).toEqual(input)
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(copy, "__proto__")).toBe(true)
    expect(copy.nested).not.toBe(input.nested)
    const prototypeName = JSON.parse('{"__proto__":{"retained":true}}')
    expect(Object.prototype.hasOwnProperty.call(parseStringifyIfNecessary(prototypeName), "__proto__")).toBe(true)
    expect(parseStringifyIfNecessary(Object.assign(Object.create(null), { id: "p_2" }))).toEqual({ id: "p_2" })
  })

  it("retains native removal and special-object normalization", () => {
    expect(parseStringifyIfNecessary({ date: new Date("2020-01-01T00:00:00Z"), absent: undefined, fn: () => 1, symbol: Symbol("x") }))
      .toEqual({ date: "2020-01-01T00:00:00.000Z" })
  })

  it("uses the genuine StepResponse JSON representation for checkpoints", () => {
    const response = new StepResponse({ absent: undefined, array: [undefined], date: new Date("2020-01-01T00:00:00Z") })
    expect(Object.keys(response)).toEqual([])
    const encoded = JSON.parse(JSON.stringify(response))
    expect(encoded.__type).toBe("Symbol(WorkflowStepResponse)")
    expect(encoded.output).toEqual({ array: [null], date: "2020-01-01T00:00:00.000Z" })
  })

  it("runs a genuine finite native child without checkpoint writes", async () => {
    const env = execution()
    const name = `finite-native-${randomUUID()}`
    let calls = 0
    env.container.values.set("atomicChild", { async invoke(input: { id: string }, context: object) {
      calls++
      expect("runtime" in context).toBe(false)
      return { id: input.id, created: true }
    } })
    const workflow = createFiniteAtomicChildWorkflow<{ id: string }, { id: string; created: boolean }>(name, "atomicChild")
    const result = await env.module.run(workflow, { transactionId: randomUUID(), input: { id: "p_1" } })
    await env.drain()
    expect(result.transaction).toBeInstanceOf(DistributedTransaction)
    expect(result.transaction.getFlow().state).toBe("done")
    expect(result.result).toEqual({ id: "p_1", created: true })
    expect(calls).toBe(1)
    expect(env.storage.saved).toEqual([])
  })

  it("requires an explicit runtime instead of ambient storage", async () => {
    const name = `no-runtime-${randomUUID()}`
    const step = createStep(`${name}-step`, async () => new StepResponse("ok"))
    const workflow = createWorkflow(name, () => new WorkflowResponse(step()))
    await expect(workflow().run({ input: {} })).rejects.toThrow("explicit native workflow execution runtime")
  })

  it.each([
    { offset: 0, timeoutFirst: false, timedOut: false },
    { offset: 1, timeoutFirst: false, timedOut: false },
    { offset: 3_600_000, timeoutFirst: false, timedOut: false },
    { offset: 0, timeoutFirst: true, timedOut: false },
    { offset: 1, timeoutFirst: true, timedOut: true },
  ])("preserves native confirmation/timeout winner $offset/$timeoutFirst", async ({ offset, timeoutFirst, timedOut }) => {
    const first = execution()
    const name = `native-wait-${randomUUID()}`
    const waitName = `${name}-confirm`
    const wait = createStep({ name: waitName, async: true, timeout: 5 }, async () => {})
    const completed = createStep(`${name}-completed`, async () => new StepResponse("confirmed"))
    const workflow = createWorkflow(name, () => { wait(); return new WorkflowResponse(completed()) })
    const transactionId = randomUUID()
    await first.module.run(workflow, { transactionId, input: {}, throwOnError: false })
    await first.drain()
    expect(first.storage.timeouts).toHaveLength(1)
    const scheduled = first.storage.timeouts[0]
    const deadline = scheduled.step.startedAt! + scheduled.interval * 1000

    // A new engine and resolver cold-load the genuine checkpoint; no live flow or
    // prior runtime capability is passed across the confirmation boundary.
    const resumed = execution(first.storage)
    resumed.setNow(deadline + offset)
    if (timeoutFirst) {
      await resumed.module.run(name, { transactionId, input: {}, throwOnError: false })
      await resumed.drain()
    }
    const confirm = resumed.module.setStepSuccess({
      idempotencyKey: { workflowId: name, transactionId, stepId: waitName, action: "invoke" },
      stepResponse: new StepResponse(true),
      options: { throwOnError: false },
    })
    if (timedOut) {
      await expect(confirm).rejects.toThrow()
      expect((await resumed.engine.getRunningTransaction(name, transactionId)).getFlow().state).toBe("reverted")
    }
    else expect((await confirm).transaction.getFlow().state).toBe("done")
    await resumed.drain()
    expect(first.storage.saved.length).toBeGreaterThan(0)
  })

  it("keeps identical workflow/transaction keys isolated by the explicit runtime", async () => {
    const name = `isolated-${randomUUID()}`
    const wait = createStep({ name: `${name}-wait`, async: true }, async () => {})
    const workflow = createWorkflow(name, () => { wait(); return new WorkflowResponse({ ok: true }) })
    const left = execution(), right = execution()
    const transactionId = randomUUID()
    await left.module.run(workflow, { transactionId, input: { owner: "left" } })
    await left.drain()
    expect(left.storage.records.size).toBe(1)
    expect(right.storage.records.size).toBe(0)
    await right.module.run(workflow, { transactionId, input: { owner: "right" } })
    await right.drain()
    const leftCheckpoint = await left.storage.get([...left.storage.records.keys()][0])
    const rightCheckpoint = await right.storage.get([...right.storage.records.keys()][0])
    expect(leftCheckpoint?.context.payload).not.toEqual(rightCheckpoint?.context.payload)
  })

  it("lets the genuine child completion trigger its waiting native parent", async () => {
    const env = execution()
    const suffix = randomUUID()
    const parentName = `native-parent-${suffix}`, waitName = `native-parent-confirm-${suffix}`
    env.container.values.set("atomicChild", { async invoke(input: { id: string }) { return { id: input.id } } })
    const child = createFiniteAtomicChildWorkflow<{ id: string }, { id: string }>(`native-child-${suffix}`, "atomicChild")
    const wait = createStep({ name: waitName, async: true }, async () => {})
    const parent = createWorkflow(parentName, (input: { id: string }) => {
      wait()
      return new WorkflowResponse(child.runAsStep({ input }))
    })
    const transactionId = randomUUID()
    await env.module.run(parent, { transactionId, input: { id: "p_native" } })
    await env.drain()
    await env.module.setStepSuccess({ idempotencyKey: { workflowId: parentName, transactionId, stepId: waitName, action: "invoke" }, stepResponse: new StepResponse(true) })
    await env.drain()
    const restored = await env.engine.getRunningTransaction(parentName, transactionId)
    expect(restored.getFlow().state).toBe("done")
    expect(env.storage.saved.every(key => key.includes(parentName))).toBe(true)
  })
})
