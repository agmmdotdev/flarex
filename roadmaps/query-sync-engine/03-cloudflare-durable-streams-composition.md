# Cloudflare And Durable Streams Composition

## Decision

For the strict Cloudflare-native Flarex path:

- do **not** adopt the full Electric Sync engine as the query-sync authority;
- evaluate the open Durable Streams protocol, Cloudflare server, and client as
  a replaceable outbound delivery-log adapter;
- retain the small runtime-neutral Flarex Query Sync Engine for query,
  dependency, ordering, generation, rerun, and publication-outbox semantics;
  and
- retain Cloudflare Durable Objects as host composition, not portable engine
  vocabulary.

Electric Sync remains a possible future opt-in row-replication profile when an
application intentionally wants Postgres rows/Shapes on the client. It does not
sit invisibly underneath the Convex-style trusted server-query path.

## Why Not Full Electric Sync

Electric Sync consumes PostgreSQL logical replication and is deployed as a
separate service with persistent storage. Cloudflare may proxy it or consume
Shapes into Workers/Durable Objects, but the sync service itself is not hosted
as a Cloudflare-native engine.

Official references:

- [Electric deployment](https://electric.ax/docs/sync/guides/deployment)
- [Electric Cloudflare integration](https://electric.ax/docs/sync/integrations/cloudflare)
- [Electric Shapes](https://electric.ax/docs/sync/guides/shapes)
- [Electric authentication](https://electric.ax/docs/sync/guides/auth)

Shapes synchronize selected table rows. Flarex synchronizes results of trusted
server functions whose identity includes application head, schema/model,
function, arguments, and effective authorization. Replacing that product with
row replication would change the security and query-execution model rather
than merely reuse transport.

## Reused Durable Streams Responsibilities

If the spike passes, upstream Durable Streams owns:

- ordered append/read behavior inside one stream;
- opaque transport offsets and resume;
- SSE and long-poll delivery;
- stream persistence inside its Cloudflare Durable Object implementation;
- producer retry deduplication for its exact producer tuple; and
- the generic client reconnect/stream-consumption implementation.

Flarex must not reimplement these features beside the upstream adapter.

Durable Streams does not own:

- namespace, tenant, application, or query authorization;
- Flarex source epoch or commit sequence;
- query identity (including its effective authorization/access evidence),
  dependencies, or generations;
- Postgres catch-up and retained-floor reset;
- query execution or result-hash suppression;
- transactionally durable query-result publication intent;
- stale-generation rejection; or
- Flarex registration, query leases, resnapshot, and stream-rotation policy.

## Evaluation Baseline

The 2026-08-27 preflight inspected the official
[`@durable-streams/server-cloudflare`](https://github.com/durable-streams/durable-streams/tree/main/packages/server-cloudflare)
and
[`@durable-streams/client`](https://github.com/durable-streams/durable-streams/tree/main/packages/client)
sources plus the
[`Durable Streams protocol`](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md).

At that snapshot, the Cloudflare server package was `0.1.1`, first published on
2026-08-11, and the client package was `0.2.6`. The server README reported 326
passing, zero failing, and six subscription-gated conformance tests skipped;
the experimental `__ds` subscription-control/webhook plane was not
implemented. That receipt was produced through the upstream local Wrangler
development harness, not a Flarex real-Cloudflare lane. It is promising
protocol evidence, not enough operational maturity to call the adapter
production-proven.

Pin exact versions in every spike. Re-evaluate package source, changelog,
protocol compatibility, license, and conformance whenever the pin changes.

## Cloudflare Placement

The preferred topology hypothesis for the spike is:

```text
Postgres commit feed
  -> per-scope Flarex Query Coordinator Durable Object
       Query Sync Engine namespace instance
       Cloudflare SQLite semantic-state adapter
       durable publication outbox
  -> internal authenticated append
  -> upstream Durable Streams StreamObject
       one shared delivery stream per source epoch and exact canonical query identity
       plus an explicit bounded stream-rotation epoch
  -> authenticated Worker gateway
  -> @durable-streams/client in the Flarex SDK adapter
```

One stream per browser connection would defeat canonical query sharing. One
scope-wide stream would expose unrelated authorized results to each consumer
and create excessive filtering/retention. The preferred hypothesis therefore
shares a stream only among consumers with the exact same namespace, source
epoch, model, and complete canonical query identity, which already includes
effective authorization/access evidence. `QSYNC-CF01` must still measure the
resulting stream cardinality—access-specific identities may approach per-user
uniqueness—and may reject this topology on cost or operational evidence.

The stream path/ID is an opaque server-issued value. It is not derived from an
untrusted scope ID, and knowledge of the path is not authorization.

## Authentication And Roles

The upstream Cloudflare package's open/no-token mode and global bearer token
are not sufficient for production multitenancy. The adapter must use a custom,
fail-closed authorization hook and conservative CORS.

Roles are separate:

- authorized clients may read/head only the exact issued stream;
- only an internal publisher capability may create/append/rotate/delete;
- browsers cannot choose producer IDs, epochs, sequences, namespace IDs, or
  stream paths; and
- the gateway binds a short-lived capability to the exact query/access identity
  and method set.

With custom/authenticated reads, the upstream server rewrites public historical
caching to `no-store`. Preserve that tenant-safety behavior. Do not weaken auth
to regain CDN cache fanout.

Immediate access revocation, authorization-fingerprint changes, and token
expiry require explicit stream/gateway behavior. The evaluated authorization
hook runs when the request begins; it does not reauthorize an already-open SSE
response. Because the evaluated server recycles SSE at roughly 60 seconds,
revocation exposure can persist until reconnect unless the host adds an
explicit termination mechanism. Changed authorization/access evidence creates
a different canonical query identity and must never attach to an old shared
stream merely because the query text is equal.

## Atomicity And Producer Semantics

Upstream producer deduplication is scoped to the stream and producer
`(producerId, epoch, sequence)` tuple. The evaluated server stores producer
epoch/last-sequence state but does not retain or compare the retry payload or
its digest. An acknowledgement for `sequence <= lastSequence` proves only that
the producer sequence was already admitted, not that remote bytes equal the
current retry bytes. It also does not make the preceding Postgres/query-state
transaction and stream append one exactly-once operation.

The Query Sync Engine publication outbox is therefore mandatory. Retries use
the identical stream ID, producer ID, producer epoch, producer sequence, and
immutable durably persisted payload/digest. Flarex owns that digest invariant;
upstream does not verify it. The initial spike permits at most one unresolved
append per stream, unless explicit stream read-back can correlate the exact
payload/digest before a later sequence proceeds. A restart may not auto-claim a
new producer epoch until the old append's uncertainty is resolved.

In the evaluated Cloudflare store, inactive producer deduplication state expires
after seven days even while stream data may remain. A retry after that expiry
can be treated as a new producer. A fresh producer ID/epoch cannot reveal
whether the old bytes were committed and may duplicate them. Long-idle
uncertainty must therefore be resolved by exact read-back, rotation of the
entire delivery stream/generation with explicit reset/resnapshot, or an
explicitly proved consumer/domain deduplication contract. The first adapter
uses read-back or whole-stream reset/rotation; retry safety is not indefinite.

The upstream client append API can buffer work. The adapter must observe
append/flush failures at the lifecycle boundary and must not mark the outbox
complete merely because an append was queued locally.

## Retention And Rotation

The evaluated Cloudflare server expires an entire stream through TTL/alarm
behavior. Active access can extend sliding TTL. It does not provide bounded
prefix truncation, checkpoint compaction, or a contractual maximum message or
byte history.

Therefore Flarex must freeze absolute limits for:

- stream age;
- appended messages;
- stored bytes;
- inactive time;
- maximum client resume age; and
- number of retained rotation epochs.

Crossing a limit creates a new opaque stream rotation and an explicit
reset/resnapshot transition. Upstream provides no implemented subscription
control plane or redirect from an expired/deleted stream to its replacement.
The Flarex registration/gateway authority must retain a bounded rotation mapping
or translate an old-stream `404`/`410` into an authenticated explicit reset and
fresh target. It cannot silently delete history while telling a client that its
old offset is still resumable.

Durable Object storage limits and pricing remain external platform facts:

- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

Fork references, stream deletion, and TTL interactions must be tested before
fork support is admitted. The first Flarex adapter does not need stream forks.

## Payload Boundary

The evaluated Cloudflare implementation limits an append to roughly 1.9 MB due
to the platform's 2 MB SQLite value ceiling and bounds read batches at roughly
4 MB. Normal Flarex publication envelopes should be capped substantially lower,
with a first spike target near 1 MB.

Large query results should use an immutable external object reference plus
content digest and authorization evidence rather than driving normal append
bodies toward the platform maximum. External-result storage, retention, and
authorization require their own owner preflight.

## Lifecycle And Cost Risk

The evaluated implementation uses short long-poll waits and recycles SSE
connections. A pending live HTTP response keeps the Durable Object active; it
does not receive the duration-cost benefit of Cloudflare's hibernatable
WebSockets. Cloudflare bills overlapping requests on the same object with
shared wall-clock duration rather than multiplying duration by concurrent
requests, but every subscriber/reconnect still contributes request traffic.

Official references:

- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

This may be acceptable for shared hot queries and poor for many sparse query
streams. It is a measured decision, not an architectural assumption.

## QSYNC-CF01 Spike Gate

The production-inert Cloudflare spike must:

1. pin exact server/client versions and run upstream conformance plus Flarex
   adapter tests on real Cloudflare infrastructure;
2. feed appends only from a durable publication outbox and inject crashes
   before append, after possible append, before receipt storage, and after
   restart;
3. persist immutable publication bytes, allow at most one unresolved append per
   stream unless exact read-back verification is proved, test duplicate
   replay, concurrent/stale producers, producer-epoch changes, ambiguous
   duplicate acknowledgements, and prove recovery beyond the exact seven-day
   producer-state inactivity retention through exact correlated read-back or
   whole-stream/generation rotation with explicit reset/resnapshot;
4. prove custom fail-closed read/write authorization, conservative CORS,
   cross-tenant isolation, cache behavior, token expiry, the roughly 60-second
   already-open-SSE revocation window or a shorter active termination
   mechanism, and canonical identity rotation when authorization evidence
   changes;
5. enforce stream age/message/byte limits and prove bounded rotation discovery
   plus explicit reset/resnapshot after an old stream expires or returns
   `404`/`410`;
6. enforce payload ceilings and immutable large-result references;
7. load-test distinct active streams, shared subscribers, SSE reconnect churn,
   requests, GB-seconds, SQLite reads/writes, alarms, and stored bytes against a
   numeric budget; and
8. prove client checkpoint advancement only after successful application,
   including duplicate delivery, suspension, backpressure, offline resume, and
   expired-offset reset.

Stop adoption if the spike requires patching/forking upstream, fails protocol
conformance, loses or reorders transitions, permits stale-generation
publication, leaks cross-tenant data, lacks bounded rotation, makes ordinary
results approach the append ceiling, cannot resolve an ambiguous append after
producer deduplication state expires without duplicating a logical publication,
or materially exceeds the approved cost budget relative to the existing
hibernatable connection lane.

If it stops, retain the portable Query Sync Engine and its `ResultPublisher`
boundary. Evaluate another adapter—potentially a hibernatable-WebSocket
delivery log—without changing engine semantics.
