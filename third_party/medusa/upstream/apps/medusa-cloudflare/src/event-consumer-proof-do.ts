interface EventConsumerProofRecord {
  id: string
  eventName: string
  receivedAt: string
}

export class EventConsumerProofDO {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname.endsWith("/reset") && request.method === "POST") {
      await this.ctx.storage.delete("record")
      return Response.json({ reset: true })
    }

    if (pathname.endsWith("/record") && request.method === "POST") {
      const input: unknown = await request.json()
      if (!isRecordInput(input)) {
        return Response.json({ error: "Invalid proof record" }, { status: 400 })
      }

      const record: EventConsumerProofRecord = {
        id: input.id,
        eventName: input.eventName,
        receivedAt: new Date().toISOString(),
      }
      await this.ctx.storage.put("record", record)

      return Response.json(record, { status: 201 })
    }

    if (pathname.endsWith("/status")) {
      const record =
        await this.ctx.storage.get<EventConsumerProofRecord>("record")
      return Response.json({
        dispatched: Boolean(record),
        record: record ?? null,
      })
    }

    return new Response("Not found", { status: 404 })
  }
}

interface RecordInput {
  id: string
  eventName: string
}

function isRecordInput(value: unknown): value is RecordInput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.eventName === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
