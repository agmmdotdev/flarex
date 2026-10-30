# Canonical app DO routing and database lifetime

Design status: **Accepted DO adaptation of the existing single-app owner and
latest-ready-read decisions**. Implementation status: **Implemented for one
configured fresh app in local workerd; managed-host gates remain open**.
Measurement status: **Unmeasured**.

## Responsibility and source

[Slice 06c](../slices/06c-shared-application-owner.md) connects queries and
mutations through one portable CoreDatabase hosted by the canonical app DO.
The accepted [owner](../01-commit-coordination.md) and
[read-after-write](../02-read-after-write.md) decisions require new ordinary
reads to include previously acknowledged mutations.

At Convex db914cf06e2b06ee985646611b9e12ed7a770318, Database::load acquires its
persistence lease before bootstrap. Database::now_ts_for_reads and begin use
the resident snapshot manager. Query cache token refresh uses the resident
write log. PostgreSQL Lease::transact fences writes and signals process shutdown
on loss; it is not a read-admission fence. The source explicitly permits
additional processes serving stale reads (postgres/src/lib.rs:1730-1742).
Periodic repeatable-timestamp writes and retention failure can detect loss, but
their delay cannot prove immediate fresh admission. Source identities belong
in [REFERENCES](../../REFERENCES.md).

## Necessity and mechanism

The initial Cloudflare target has one app DO rather than a process coordinator
plus stale readers. Opening a separate query CoreDatabase would either acquire
another lease or keep an independent obsolete published view. Both queries and
mutations must therefore borrow the same retained owner. No per-query timestamp
request, lease poll or old SQL-command serving wrapper supplies that ownership.

Bind app/instance/physical target and expected canonical DO identity at trusted
composition. Route every admitted fresh call to that same stub. Refuse another
DO identity before acquisition. The owner opens once, finishes fenced bootstrap
before readiness and publishes through the existing committer before mutation
success. The host supplies transport and lifecycle; PostgreSQL remains durable
authority. No SQLite document, commit, outcome or readiness prefix is authoritative.

All supported fresh writers, including metadata/schema/index/program/epoch and
request-outcome writers, participate through the owner. Bootstrap or maintenance
outside it requires an explicit close/drain/fence/reconstruct barrier. Arbitrary
external lease acquisition while a live owner serves is unsupported, rather
than being hidden behind an ineffective periodic guard.

Cloudflare documents that replacement routes new requests to the new instance;
old HTTP/RPC requests can finish when they avoid DO storage. It supplies no
guaranteed shutdown hook. See the official
[lifecycle contract](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/),
inspected 2026-10-31. Thus already admitted S-queries may finish coherently, but
new requests must not reach obsolete admission. Old writes remain PostgreSQL
fenced; new bootstrap reconstructs only after that fence excludes old saves.
Do not infer managed replacement guarantees from a local sequential reset.

## Consequences, validation and limits

The difference is host routing/readiness and lifetime control. Core snapshot,
read-only completion, mutation settlement, cursor, fencing and recovery owners
remain translated mechanisms. Existing mutation grants retain their separate
revocation/deadline contract; anonymous standalone queries do not become durable
mutation attempts.

Require an executable caller/writer closure, canonical/wrong-ID checks before
database open, shared mutation-to-query visibility, old/new S coherence,
bootstrap failure gating, cancellation/late callback refusal, actual DO restart,
fenced old writes and lost-ack reconciliation. Prove database behavior on PGlite
and ordinary PostgreSQL separately, and distinguish actual local workerd from
managed Cloudflare routing/eviction evidence.

This record does not enable replication, arbitrary external maintenance,
cross-app atomicity, shared query-cache reuse, production deployment or a
throughput/latency claim. Broader native migration and lifecycle gates remain
with the goal. Revisit this adaptation if routing or the writer graph changes.
