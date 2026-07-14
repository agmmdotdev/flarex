export type BoundedJsonRead =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly reason: "invalid_body" | "body_too_large";
    };

export async function readBoundedJson(
  request: Pick<Request, "body" | "headers">,
  maximumBytes: number,
): Promise<BoundedJsonRead> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) {
      return { ok: false, reason: "invalid_body" };
    }
    if (Number(contentLength) > maximumBytes) {
      return { ok: false, reason: "body_too_large" };
    }
  }
  if (request.body === null) {
    return { ok: false, reason: "invalid_body" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "body_too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, reason: "invalid_body" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "invalid_body" };
  }
}

export async function hasExactBearerCapability(
  request: Request,
  token: string,
): Promise<boolean> {
  const presented = request.headers.get("authorization");
  if (presented === null) return false;
  const encoder = new TextEncoder();
  const [presentedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${token}`)),
  ]);
  const presentedBytes = new Uint8Array(presentedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  if (presentedBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    const presentedByte = presentedBytes[index];
    const expectedByte = expectedBytes[index];
    if (presentedByte === undefined || expectedByte === undefined) return false;
    difference |= presentedByte ^ expectedByte;
  }
  return difference === 0;
}

export function noStoreJson(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export function isConfiguredSecret(value: string | undefined): value is string {
  return value !== undefined &&
    value.length > 0 &&
    value === value.trim();
}
