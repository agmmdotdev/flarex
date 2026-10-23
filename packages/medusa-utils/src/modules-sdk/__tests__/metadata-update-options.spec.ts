import { describe, expect, it, vi } from "vitest"
import type { Context, DAL } from "@medusajs/types"
import { model } from "@medusajs/utils/dml/model"
import { MedusaError } from "@medusajs/utils/common/errors"
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service"

const MetadataOptionFixture = model.define("MetadataOptionFixture", {
  id: model.id().primaryKey(),
  metadata: model.json().nullable(),
  payload: model.json().nullable(),
})

type Row = {
  id: string
  metadata: Record<string, unknown> | null
  payload: Record<string, unknown>
}

function fixture(entity?: Row) {
  const repository = {
    find: vi.fn(async () => entity === undefined ? [] : [entity]),
    update: vi.fn(async () => [entity]),
    create: vi.fn(),
    getFreshManager: vi.fn(() => { throw new Error("Unexpected manager acquisition") }),
  }
  const Service = MedusaInternalService(MetadataOptionFixture)
  const service = new Service({ metadataOptionFixtureRepository: repository })
  // This unit test borrows an existing context. It does not emulate transaction
  // acquisition or settlement; real native drivers cover those in both lanes.
  const borrowedManager = {}
  const context: Context = { manager: borrowedManager, transactionManager: borrowedManager }
  return { service, repository, context }
}

describe("native internal service metadata update options", () => {
  it("preserves default native merge/removal and leaves the other JSON field for the DAL", async () => {
    const original = { keep: 1, remove: "old", literal: "" }
    const payload = { old: true }
    const entity = { id: "metadata-default", metadata: original, payload }
    const update = { id: entity.id, metadata: { added: 2, remove: "" }, payload: { next: true } }
    const { service, repository, context } = fixture(entity)

    await service.update(update, context)

    expect(entity.metadata).toEqual({ keep: 1, literal: "", added: 2 })
    expect(update.metadata).toBe(entity.metadata)
    expect(original).toEqual({ keep: 1, remove: "old", literal: "" })
    expect(entity.payload).toBe(payload)
    expect(repository.update).toHaveBeenCalledExactlyOnceWith([{ entity, update }], context, undefined)
    expect(repository.create).not.toHaveBeenCalled()
    expect(repository.getFreshManager).not.toHaveBeenCalled()
  })

  it.each([null, {}, { literal: "", only: 3 }, { nested: { value: null } }])(
    "forwards exact metadata %j without native merge or mutation of other JSON",
    async metadata => {
      const previous = { unwanted: true, old: "value" }
      const payload = { old: true }
      const entity = { id: "metadata-exact", metadata: previous, payload }
      const update = { id: entity.id, metadata, payload: { next: true } }
      const retained = structuredClone(update)
      const options: DAL.UpdateOptions = { metadata: "replace" }
      const { service, repository, context } = fixture(entity)

      await service.update(update, context, options)

      expect(update).toEqual(retained)
      expect(update.metadata).toBe(metadata)
      expect(entity.metadata).toBe(previous)
      expect(entity.payload).toBe(payload)
      expect(repository.update).toHaveBeenCalledExactlyOnceWith([{ entity, update }], context, options)
      expect(repository.create).not.toHaveBeenCalled()
      expect(repository.getFreshManager).not.toHaveBeenCalled()
    }
  )

  it("does not introduce metadata when it is omitted in exact mode", async () => {
    const entity = { id: "metadata-omitted", metadata: { unchanged: true }, payload: {} }
    const update = { id: entity.id, payload: { next: true } }
    const options: DAL.UpdateOptions = { metadata: "replace" }
    const { service, repository, context } = fixture(entity)

    await service.update(update, context, options)

    expect(Object.hasOwn(update, "metadata")).toBe(false)
    expect(entity.metadata).toEqual({ unchanged: true })
    expect(repository.update).toHaveBeenCalledExactlyOnceWith([{ entity, update }], context, options)
    expect(repository.getFreshManager).not.toHaveBeenCalled()
  })

  it.each([undefined, { metadata: "replace" } satisfies DAL.UpdateOptions])(
    "refuses a missing keyed entity without update or creation in mode %j",
    async options => {
      const { service, repository, context } = fixture()

      await expect(service.update({ id: "metadata-missing", metadata: { literal: "" } }, context, options))
        .rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

      expect(repository.update).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
      expect(repository.getFreshManager).not.toHaveBeenCalled()
    }
  )
})
