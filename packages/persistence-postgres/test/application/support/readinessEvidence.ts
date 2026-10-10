import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { TestPersistence } from "./readinessFixture";

export async function scalarCount(
  persistence: TestPersistence,
  tableName: string,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(
    `select count(*)::text as count from ${tableName}`,
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error(`Missing count for ${tableName}.`);
  return Number(count);
}

export function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(bytes);
  return encodeBytesToLowercaseHex(digest);
}

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
}

export function canonicalJsonByteLength(value: unknown): bigint {
  return BigInt(new TextEncoder().encode(JSON.stringify(value)).byteLength);
}
