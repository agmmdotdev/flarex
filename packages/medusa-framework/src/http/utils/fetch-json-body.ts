const MAX_JSON_BODY_BYTES = 1024 * 1024

/** Bounded replacement for pinned FetchHttpAdapter.#applyJsonBodyParser. */
export function resolveJsonBodyLimit(limit = MAX_JSON_BODY_BYTES): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_JSON_BODY_BYTES) {
    throw new Error("The private JSON body limit must be between 1 and 1048576 bytes")
  }
  return limit
}

class JsonBodyTooLargeError extends Error {
  readonly type = "payload_too_large"
  constructor() {
    super("Request body exceeds the private HTTP limit")
    this.name = "JsonBodyTooLargeError"
  }
}

export async function parseFetchJsonBody(request: Request, limit: number): Promise<unknown> {
  if (request.body === null || !(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return undefined
  const lengthHeader = request.headers.get("content-length")
  if (lengthHeader !== null && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > limit) {
    await request.body.cancel()
    throw new JsonBodyTooLargeError()
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new JsonBodyTooLargeError()
      }
      chunks.push(chunk.value.slice())
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    // Keep native Fetch's unknown-error 500 projection without logging raw JSON.
    if (error instanceof SyntaxError) throw new SyntaxError("Invalid JSON request body")
    throw error
  }
}
