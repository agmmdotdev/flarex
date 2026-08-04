/**
 * The durable-task package intentionally compiles against ES2022 without the
 * browser DOM library. Both admitted hosts (Cloudflare Workers and the Node
 * test runtime) provide the HTML structured-clone operation.
 */
declare function structuredClone<T>(value: T): T;
