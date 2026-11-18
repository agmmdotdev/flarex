import { describe, expect, it } from "vitest"
import { decodeLinkOperationHandle, decodeLinkOperationRecord, linkOperationRequestKey } from "../src/operations/contracts"

const pair = { primary: "apk_example", foreign: "sc_example" }
const request = { operationId: "lop_example", add: [pair], remove: [] }
const record = { id: request.operationId, service_name: "api_key_sales_channel", request, state: "applied",
  changes: [{ ...pair, beforeActive: false, afterActive: true, afterRevision: "lrv_example" }],
  events: [{ event_id: "lev_example", id: "pksc_example", action: "attached" }], compensation_events: [] }

describe("native durable Link protocol contracts", () => {
  it("requires every undo authority pair and final presence to match its retained request", () => {
    expect(decodeLinkOperationRecord(record).changes).toHaveLength(1)
    expect(() => decodeLinkOperationRecord({ ...record, changes: [{ ...record.changes[0], foreign: "sc_unrequested" }] }))
      .toThrow("Invalid durable Link operation state")
    expect(() => decodeLinkOperationRecord({ ...record, request: { ...request, remove: [pair] } }))
      .toThrow("Invalid durable Link operation state")
    expect(() => decodeLinkOperationRecord({ ...record, changes: [...record.changes, ...record.changes] }))
      .toThrow("Invalid durable Link operation state")
  })

  it("retains the exact request even for cancellation and binds the compensation handle", () => {
    const cancelled = { ...record, state: "cancelled", changes: [], events: [] }
    expect(decodeLinkOperationRecord(cancelled).request).toEqual(request)
    expect(() => decodeLinkOperationRecord({ ...cancelled, request: null })).toThrow("Invalid durable Link operation state")
    expect(() => decodeLinkOperationHandle({ operationId: "lop_other", serviceName: record.service_name, request }))
      .toThrow("Invalid Link operation input")
  })

  it("retains native scalar and multi-row event payloads and refuses empty or singleton arrays", () => {
    const bulk = { ...record, events: [{ ...record.events[0], id: ["pksc_a", "pksc_b"] }] }
    expect(decodeLinkOperationRecord(record).events[0]?.id).toBe("pksc_example")
    expect(decodeLinkOperationRecord(bulk).events[0]?.id).toEqual(["pksc_a", "pksc_b"])
    for (const id of [[], ["pksc_a"]]) {
      expect(() => decodeLinkOperationRecord({ ...bulk, events: [{ ...record.events[0], id }] }))
        .toThrow("Invalid durable Link operation state")
    }
  })

  it("preserves duplicate and ordered requests while ignoring incidental property order", () => {
    const reversedFields = { foreign: pair.foreign, primary: pair.primary }
    expect(linkOperationRequestKey({ ...request, add: [reversedFields] })).toBe(linkOperationRequestKey(request))
    expect(linkOperationRequestKey({ ...request, add: [pair, pair] })).not.toBe(linkOperationRequestKey(request))
    const other = { ...pair, foreign: "sc_other" }
    expect(linkOperationRequestKey({ ...request, add: [pair, other] }))
      .not.toBe(linkOperationRequestKey({ ...request, add: [other, pair] }))
  })
})
