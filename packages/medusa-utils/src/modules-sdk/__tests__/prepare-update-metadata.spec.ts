import { describe, expect, it } from "vitest"
import { prepareUpdateMetadata } from "../prepare-update-metadata"

describe("native update metadata preparation", () => {
  it("retains shallow metadata merge, removal and the shared entity/update result identity", () => {
    const original = { keep: 1, remove: "old", nested: { previous: true } }
    const nested = { next: true }
    const entity = { metadata: original }
    const update = { metadata: { remove: "", nested, added: 2 } }
    const pairs = [{ entity, update }]
    expect(prepareUpdateMetadata(pairs)).toBeUndefined()
    expect(entity.metadata).toEqual({ keep: 1, nested, added: 2 })
    expect(entity.metadata).toBe(update.metadata)
    expect(entity.metadata).not.toBe(original)
    expect(entity.metadata.nested).toBe(nested)
    expect(original).toEqual({ keep: 1, remove: "old", nested: { previous: true } })
    expect(pairs[0]?.entity).toBe(entity)
    expect(pairs[0]?.update).toBe(update)
  })

  it("retains original sequential shared-update mutation across heterogeneous entities", () => {
    const first: { metadata: Record<string, unknown> } = { metadata: { onlyFirst: 1, shared: "first" } }
    const second: { metadata: Record<string, unknown> } = { metadata: { onlySecond: 2, shared: "second" } }
    const update = { metadata: { patch: 3 } }
    const pairs = [{ entity: first, update }, { entity: second, update }]
    prepareUpdateMetadata(pairs)
    expect(first.metadata).toEqual({ onlyFirst: 1, shared: "first", patch: 3 })
    expect(second.metadata).toEqual({ onlySecond: 2, shared: "first", onlyFirst: 1, patch: 3 })
    expect(second.metadata).toBe(update.metadata)
    expect(first.metadata).not.toBe(update.metadata)
    expect(pairs[0]?.update).toBe(pairs[1]?.update)
  })

  it("preserves removal consumed by the first shared-update merge", () => {
    const first: { metadata: Record<string, unknown> } = { metadata: { onlyFirst: 1, remove: "first" } }
    const second: { metadata: Record<string, unknown> } = { metadata: { onlySecond: 2, remove: "second" } }
    const update = { metadata: { remove: "" } }
    prepareUpdateMetadata([{ entity: first, update }, { entity: second, update }])
    expect(first.metadata).toEqual({ onlyFirst: 1 })
    expect(second.metadata).toEqual({ onlySecond: 2, remove: "second", onlyFirst: 1 })
    expect(second.metadata).toBe(update.metadata)
  })

  it.each([undefined, null, "", {}, [], new Map(), new Set()])("preserves nonpresent metadata: %s", value => {
    const previous = { stable: true }
    const entity = { metadata: previous }
    const update = { metadata: value }
    prepareUpdateMetadata([{ entity, update }])
    expect(entity.metadata).toBe(previous)
    expect(update.metadata).toBe(value)
  })

  it("does not add an omitted metadata property or mutate an empty cohort", () => {
    const entity = { metadata: { stable: true } }
    const previous = entity.metadata
    const update = {}
    prepareUpdateMetadata([{ entity, update }])
    expect(entity.metadata).toBe(previous)
    expect(Object.hasOwn(update, "metadata")).toBe(false)
    expect(prepareUpdateMetadata([])).toBeUndefined()
  })
})
