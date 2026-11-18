# Managed Application query transport across Worker RPC

Design status: **Accepted runtime adaptation within the existing private Worker
profile**. Implementation status: **Implemented for the selected fresh mutation
path; wider host and production activation gates remain**. Measurement status: **Required
gates unmet**; no capacity or latency conclusion follows from batching.

## Ownership and decision

[Slice 06b](../slices/06b-application-sdk-queries.md) owns the connected SDK query
replacement under the [goal](../GOAL.md). User code remains isolated from trusted
core state and PostgreSQL. Root coordinates the protocol, core, Worker and host
owners. Existing named raw/native targets retain their migration gates.

## Pinned source

At db914cf06e2b06ee985646611b9e12ed7a770318, Convex query_impl.ts iterates a backend
query stream; async_syscall.rs and database/query/index_range.rs own the stream,
consumed positions, dependencies and finite pagination. SDK collect reaches End,
take uses a Limit operator and pagination performs no extra lookahead. Public
cursors remain instance-bound, authenticated and deterministic. Source identities
belong in [REFERENCES](../../REFERENCES.md).

## Challenge and necessity

Independent current-owner, accepted-direction and source inspection plus peer
exchange found no SDK query bridge in the current Worker context. The existing
raw RPC exposes an array and computes exact completion with one extra row; it
cannot stand in for source stream semantics. A single unbounded collection RPC
would also confuse transport and operation/final-result limits.

The private Cloudflare Worker crosses a real RPC boundary. It must carry finite
messages and preserve isolation. Adapt transport granularity into bounded chunks
using the existing 128-document/8 MiB profile, while preserving one transaction
query stream and the complete terminal lifetime. A new physical compiler in the
Worker or a second SQL session is unnecessary. A protected cursor is not replaced
by an invocation-local token because public pagination spans invocations.

## Mechanism and guarantees

The SDK records logical query intent. A trusted terminal wrapper admits its full
Promise, including internal chunk continuations and final terminal checks. The
host retains invocation-owned query handles, serializes admitted RPC work with
its existing owner and revalidates the real grant using the captured Clock.

The core captures the query once, resolves its snapshot index, records metadata,
checks the source unioned-interval budget and exposes its consumed cursor through
the shared scan/pending
merge. Pages obey the requested remaining count and byte budget. They never
clamp logical collect/take semantics or infer exhaustion from a short byte-limited
chunk. Consumed intervals and shared read budgets advance together; prefetch and
transport do not manufacture an observed extra row.

Each frame fits both encoded bytes and the Worker semantic-size ceiling, with
its envelope and cursor included. The shared scanner owns chunk selection and
uses its established document measurements plus a trusted size projection for
the transport envelope. Compact numeric values require this separate semantic
measurement; JSON size alone is insufficient.

Closure prevents new developer terminal starts and drains admitted chains. Host
cleanup closes every retained query before finalization or abort. No database
transaction, raw target, scope clock or finalizer is lent across user execution.

The difference is RPC transport granularity and its explicit lifetime, not logical
range compilation, ordering, cursor authentication or settlement authority.
Native residual predicates and other profiles remain owned separately.

## Witnesses and limits

Require actual emitted Worker multi-chunk collect/take, first/unique, both orders,
exact/full/byte-limited/end pages, cursor continuation and private secret isolation.
Test dropped terminal Promises, closure between chunks, late starts, page failure,
sticky failures, deadline/revocation and unchanged finalization exclusion. Core
OCC/readset and shared-budget proofs run on PGlite and ordinary-role PostgreSQL.

This record does not establish app-DO ownership, production host capacity, reactive
pagination splitting, native migration or full goal completion. Reassess the
chunking mechanism if the runtime boundary changes; do not retain duplicate
queues, buffers or admission owners by default.
