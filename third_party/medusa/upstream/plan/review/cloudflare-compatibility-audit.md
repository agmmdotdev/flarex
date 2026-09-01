# Review: Cloudflare Workers Compatibility Audit

## Executive Summary

This document outlines the remaining runtime systems and architecture patterns in Medusa that block Cloudflare Workers (`workerd` runtime) compatibility. 

The core philosophy of making the framework **static, explicit, and pluggable** is the correct path forward. While database adapters and shared barrel imports are the immediate blockers, several other systems require refactoring.

---

## 1. Validated Refactor Targets (On Track)

The following systems have been correctly identified for refactoring and align with the planned architecture:

- **Database & Barrel Imports**: Static imports of MikroORM/Postgres and Node-only dependencies in shared infrastructure must be isolated to allow bundlers to tree-shake them.
- **Event Bus Module**: The event bus is already interface-driven (`IEventBusModule`). A Cloudflare-native implementation (e.g., using Cloudflare Queues or background Fetch events) can cleanly replace the default local/Redis modules.
- **Workflow Engine (Queue)**: Background jobs and workflows are handled by a pluggable engine. A Cloudflare-compatible engine will need to be swapped in for the default in-memory/Redis implementations.
- **Module Discovery (Filesystem)**: The framework currently relies heavily on `fs.readdir`, `fs.stat`, and dynamic `import()` to automatically discover modules, loaders, services, and models at startup. For Cloudflare, this runtime filesystem scanning must be replaced by a build-time step (AOT compilation) that generates a static map of explicit imports.
- **HTTP Layer (Express.js)**: `express-loader.ts` couples the framework to Express, `express-session`, and Node's core `http` module. Cloudflare Workers use the Web Standard `Fetch` API (`Request`/`Response`). The routing layer needs to be adapted to standard Web APIs or a lightweight router like Hono.

---

## 2. Hidden Blockers (Newly Identified)

The following areas also require refactoring to achieve full Cloudflare compatibility:

### 2.1 File-Based API Routing
Similar to module discovery, Medusa uses `fs` to scan the `api/` directories at startup to dynamically build the Express router tree. This runtime scanning is incompatible with Cloudflare. A compiler (similar to Next.js or Remix) will be needed to AOT-compile the directory structure into a static route manifest.

### 2.2 Session & Cookie Management
The current HTTP layer relies on `express-session` and `cookie-parser`. Once Express is removed, the framework needs a platform-agnostic session handler that parses and serializes `Headers` directly to manage Admin/Store authentication cookies using standard Web APIs.

### 2.3 Global Environment Variables (`process.env`)
Medusa relies on reading `process.env` globally for configuration. In Cloudflare Workers, environment variables are securely passed per-request via the `env` binding in the `fetch(request, env, ctx)` handler. The framework's configuration manager must be refactored to accept injected environment variables rather than assuming global access.

### 2.4 Caching Module
The default `@medusajs/cache-inmemory` is ineffective in a serverless environment because each Cloudflare Worker isolate has its own memory space and instances are ephemeral. A caching module backed by **Cloudflare KV** or Durable Objects is required.

### 2.5 File Storage Provider
The default local file service uses Node's `fs` to write uploaded assets to disk. This must be swapped with a Cloudflare-native storage provider, such as a module backed by **Cloudflare R2**.

### 2.6 Node Built-in Polyfills
Even with Cloudflare's `nodejs_compat` flag, there are deep usages of Node-specific APIs like `crypto` (for hashing/passwords), `Buffer`, and `path`. These will either require explicit bundler polyfills or need to be rewritten to use Web Crypto (`crypto.subtle`) and standard `Uint8Array`.
