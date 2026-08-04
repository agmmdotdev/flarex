/**
 * The durable-task package intentionally compiles against ES2022 without the
 * browser DOM library. Both admitted hosts (Cloudflare Workers and the Node
 * test runtime) provide the HTML structured-clone and UTF-8 encoder
 * operations.
 */
declare function structuredClone<T>(value: T): T;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
