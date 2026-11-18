import { describe, expect, it } from "vitest"
import type { Context, DAL } from "@medusajs/framework/types"
import { LinkOperationStore } from "../src/operations/store"

const unused = async (): Promise<never> => { throw new Error("Unexpected repository operation") }
const records: Pick<DAL.RepositoryService, "find" | "create" | "update" | "serialize"> = {
  find: unused, create: unused, update: unused, serialize: unused,
}

function fixture(commitFailure?: Error) {
  const trace: string[] = [], manager = Object.freeze({ nativeTransaction: true })
  const transactionRepository: Pick<DAL.RepositoryService, "transaction"> = {
    transaction: async (work, options) => {
      expect(options).toEqual({ isolationLevel: "serializable", enableNestedTransactions: false })
      // SAFETY: DAL's generic manager is opaque at this fixture boundary. The
      // owner supplies one token and no test interprets a caller-selected type.
      const result = await work(manager as Parameters<typeof work>[0])
      trace.push("commit")
      if (commitFailure !== undefined) throw commitFailure
      return result
    },
  }
  const store = new LinkOperationStore({ serviceName: "api_key_sales_channel", primaryKey: "publishable_key_id",
    foreignKey: "sales_channel_id", operations: records, revisions: records, transactionRepository })
  return { store, trace }
}

describe("native Link transaction publication boundary", () => {
  it("publishes regular-writer events only after the owner commits", async () => {
    const { store, trace } = fixture()
    let completedContext: Context = {}
    expect(await store.withTransaction({}, async context => {
      completedContext = context
      trace.push("work")
      expect(store.deferPublication(context, async () => { trace.push("publish") })).toBe(true)
      return "done"
    })).toBe("done")
    expect(trace).toEqual(["work", "commit", "publish"])
    expect(store.deferPublication(completedContext, unused)).toBe(false)
  })

  it("discards publication when the transaction fails at commit", async () => {
    const failure = new Error("serialization failed at commit"), { store, trace } = fixture(failure)
    await expect(store.withTransaction({}, async context => {
      trace.push("work")
      store.deferPublication(context, async () => { trace.push("publish") })
    })).rejects.toBe(failure)
    expect(trace).toEqual(["work", "commit"])
  })

  it("refuses a supplied transaction even when its context claims SERIALIZABLE", async () => {
    const { store, trace } = fixture()
    await expect(store.withTransaction({ transactionManager: {}, isolationLevel: "serializable" }, async () => {
      trace.push("work")
    })).rejects.toThrow("refuse externally supplied transactions")
    expect(trace).toEqual([])
  })

  it("shares the owner's pending publication queue for nested native calls", async () => {
    const { store, trace } = fixture()
    await store.withTransaction({}, context => store.withTransaction(context, async nested => {
      store.deferPublication(nested, async () => { trace.push("publish") })
      trace.push("nested")
    }))
    expect(trace).toEqual(["nested", "commit", "publish"])
  })
})
