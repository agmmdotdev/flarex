# Installation acceptance performance

## Shared Logical Storage Authority

Storage target correction: [shared logical storage](../../design-notes/flarexdb-shared-logical-storage.md)
and its [replacement gates](../shared-logical-storage/README.md)
supersede this record's physical Medusa/module-table destination and any
per-deployment schema recommendation. Retain applicable source provenance,
framework semantics and completed implementation evidence. Generated-table DDL,
physical index/FK mappings and their tests describe the displaced baseline;
they are not a compatibility obligation or permission to extend it as the
platform destination. Inventory retained system/lifecycle consumers separately.
Target migration remains unimplemented.

## Approved correction and evidence

The owner approved improving installation verification after the Medusa-to-core
benchmark and requested implementation on the main checkout. The completed
cross-domain checkpoint is `e334261d`. This correction owns installation
acceptance and its read-only evidence restoration; it does not change commit,
OCC, publication, recovery, scope fencing, or cross-domain command composition.

Reproduction: install the private Product profile, warm the existing pure byte
verification scope, then execute simple/nested create, title update and delete
through the commerce host on ordinary-role PostgreSQL 18.3. Full profiling of
24 commands observed three installation graph reconstructions per command,
40 installation-stage SQL calls and 252 ms mean verification time (246 ms
median under profiling; 232 ms median with lighter instrumentation). The calls
read 211 name mappings and 85 receipts three times. Query round trips accounted
for approximately 42 ms of the stage. All profiled commands passed. Raw evidence
is retained in the external `medusa-core-benchmark-side/deep-*` artifacts.

Expected behavior: check the current accepting authority and fully validate the
selected installation evidence without repeatedly reconstructing the same
immutable graph inside one accepting operation. Actual behavior: identity read,
availability corroboration, and readiness restoration each rebuild that graph.
Affected owner: `frameworkSchema/installation` and its binding-evidence caller.
Disposition: bounded correction implemented and locally validated on main.
The owner explicitly waived the two-reviewer checkpoint for this correction
because the side conversation prohibits subagents. Self-review and the recorded
validation remain the evidence for this commit; no independent review is claimed.

## Design and challenged alternative

Replace the sole binding caller's installation-read-then-availability-lock path
with one installation acceptance operation. Resolve and lock the availability
head by the supplied installation digest using a target-local join; the digest
only selects a candidate and grants no authority. Then restore the immutable
installation and the locked head's history/readiness in one read-only graph
pass. Full natural identity, canonical bytes, projections, sidecars, ancestry,
availability status/sequence, and binding commitments must still be checked.

Reuse an installation occupant only when its freshly read root projections and
bytes exactly match a successfully restored occupant in that same read-only
pass, with the same collision dependency and transaction. The existing graph
pass owns release, capacity and interruption. Do not widen it to encompass the
mutable head read/lock, arbitrary callbacks, or another transaction. No
cross-request restored capability or global cache is introduced.

The head share lock moves before the expensive installation graph restoration.
The caller still acquires its scope/application protection first, and the head
lock lasts until transaction settlement. Missing head or lock timeout may now
be observed before corruption in an unselected installation ancestor; all such
outcomes fail closed and perform no application mutation. No authority is
issued until the complete restored graph and binding checks succeed. The
ordinary installation/readiness/history repository APIs retain their existing
fresh-read behavior; only the unused displaced accepting function is removed.

The tempting alternative of wrapping the complete transaction in the graph
cache is rejected: mutable reads and arbitrary callbacks violate that cache's
contract. A prepared immutable installation description with bounded current
checks is a later design decision; this correction does not waive stored
corruption checks or claim a constant-cost production request path.

## Validation gates

- Pin a single installation restoration and fewer SQL queries in acceptance.
- Reject wrong natural identity, changed canonical bytes, corrupt projections,
  changed ancestor evidence and stale/withdrawn availability, including after a
  previous successful accepting transaction.
- Prove the share lock survives until accepting transaction settlement and a
  blocked reader observes the committed head version on real PostgreSQL.
- Run existing installation/head, binding, commerce/CMS and cross-domain tests,
  typecheck and the scoped lint gates. Benchmark the same Product operations
  through actual PostgreSQL settlement, with setup excluded, recording failures
  and query counts rather than asserting a timing threshold in tests.
- This side conversation cannot spawn reviewer agents. The owner waived that
  checkpoint for this correction; do not claim independent reviewers ran.

## Implementation and validation receipt

The binding caller now uses `lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect`.
The displaced accepting function had no other consumers and was removed. A
freshly read installation root is compared through the existing exact driver-row
reference helper before reusing its occupant within the read-only graph pass.
Standalone installation/head repository contracts are retained.

Ordinary-role PostgreSQL measured the same six Product operations before and
after the source change, with setup excluded. The baseline pre-transform loaded
the exact committed text of the three changed modules from `e334261d`; other
modules and dependencies were shared and no source reversion was performed.
Each implementation ran 120 commands, including 24 warmups, with no failures.
Publication/outcome/outbox/fact inventories and connection cleanup passed.

| Measurement | Before | After |
| --- | ---: | ---: |
| Verification queries per command | 40 | 18 |
| Normal verification median | 531.6 ms | 354.6 ms |
| Normal full-command median | 685.6 ms | 512.9 ms |
| Experimental warm-byte-cache verification median | 242.2 ms | 89.1 ms |
| Experimental warm-byte-cache full-command median | 392.4 ms | 237.7 ms |

The longer-lived pure byte cache remains benchmark-only. This source change
removes duplicate graph reconstruction but still performs one full traversal;
it does not complete a prepared-installation request path. There were 48 timed
samples per cache mode per implementation on a shared developer machine, so
these are local median measurements, not production tail-latency guarantees.

Validation passed: 12 existing PGlite installation/head tests, the new PGlite
acceptance test, and seven PostgreSQL tests across acceptance, binding/races,
CMS, commerce and the Currency/Payload/Application command. The focused test
counts actual plan-sidecar loads because the outer memoized occupant span also
appears on cache hits. Wrong natural identity, changed ancestor projections,
corrupt installation bytes, independent transaction restoration, and share-lock
retention through settlement are covered. Persistence typecheck, `lint:core`,
`lint:diff`, and diff whitespace validation passed. Full evidence and the report
are retained in the external benchmark directory under `acceptance-*` names.
