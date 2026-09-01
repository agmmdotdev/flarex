import { model } from "@medusajs/dml"
import { describe, expect, it } from "vitest"
import { createInternalService } from "./internal-service"
import { createMemoryRepository } from "./memory-repository"

describe("portable internal service", () => {
  it("runs CRUD behavior without an ORM manager", async () => {
    const Currency = model.define("currency", {
      code: model.text().primaryKey(),
      name: model.text(),
    })
    const repository = createMemoryRepository<{ code: string; name: string }>(
      Currency
    )
    const transaction = repository.session.transaction
    let transactionCount = 0
    repository.session.transaction = async (operation) => {
      transactionCount++
      return await transaction(operation)
    }
    const service = createInternalService(Currency, repository)

    await service.create({ code: "usd", name: "US Dollar" })
    await service.update({ code: "usd", name: "Dollar" })

    expect(await service.retrieve("usd")).toMatchObject({
      code: "usd",
      name: "Dollar",
    })
    expect(transactionCount).toBe(2)
  })
})
