import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";

export async function discardH05BoundedResponseBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<void> {
  try {
    await readH05BoundedResponseBody(
      response,
      maximumResponseBytes,
      () => new Error("Discarded H05 response exceeded its size limit."),
    );
  } catch {
    // The status is the only retained evidence. Never surface body details.
  }
}

export async function readH05BoundedResponseBody(
  response: Response,
  maximumResponseBytes: number,
  createSizeError: () => Error,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!isNonNegativeSafeInteger(parsed) || parsed > maximumResponseBytes) {
      if (response.body !== null) {
        try {
          await response.body.cancel();
        } catch {
          // Preserve the declared-size failure and never surface body details.
        }
      }
      throw createSizeError();
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded-size failure and never surface stream details.
        }
        throw createSizeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
