# Native write round trips

Status **Implemented.** Flarex baseline `86a5dd662`. Convex
`db914cf06e2b06ee985646611b9e12ed7a770318`.

Mechanism and its difference from Convex:
[opening lease fence and inserts in one statement](../divergences/native-fenced-insert-statement.md).

## Independent challenge

Two read-only challengers inspected current Core and pinned Convex.

| Proposal | Outcome |
| --- | --- |
| One request lookup before a claim | Rejected. The first runs before live authority and serves committed replay; the second registers the read witness that separates racing claimants. Reusing the first page is at most one round trip. |
| Drop the opening lease check | Rejected. A stale owner would reach constraint failures first, and Convex keeps both checks. |
| Move `FOR SHARE` first | Rejected. It can deadlock with physical maintenance. |
| Separate statements through pipelining | Not available. `pg` 8.22 sends one query at a time. |
| Fold the opening check and inserts into one statement | Selected. It keeps the check's protection. |

## Measured outcome

Product create on ordinary-role PostgreSQL, one local host. Medians of three alternating
rounds against a clean baseline clone, 128 operations each.

| Added latency | Callers | Round trips | Median latency |
| --- | --- | --- | --- |
| 0 ms | 1 | 51 → 47 | 96 → 96 ms |
| 0 ms | 16 | 59.3 → 55.7 | 996 → 991 ms |
| 2 ms | 1 | 51 → 47 | 261 → 256 ms |
| 2 ms | 16 | 59.9 → 56.1 | 1,307 → 1,261 ms |

CPU per request and throughput did not change measurably. The benefit scales with
network distance. Merging the claim and root commits is a separate design that needs
its own challenge and an owner decision.

## Commit in one round trip

Baseline `9d2eae6ff`. A one-row native write cost 17 round trips, eight of them the two
commits (BEGIN, fenced insert, share lock, COMMIT).

One read-only challenger inspected current Core, physical maintenance and pinned Convex.

| Proposal | Outcome |
| --- | --- |
| One statement: inserts, then the lease share lock, aborting when the lease is gone | Selected. Same order as `Lease::transact`. |
| A PL/pgSQL function installed with the schema | Not built. It adds a durable object to the generated five-table baseline and needs an approved migration. |
| `BEGIN; ...; COMMIT` through the simple protocol | Rejected. It takes no parameters. |
| Share lock first | Rejected as before: it inverts the lock order of physical maintenance. |
| Reuse the ordinary query method | Rejected. It reports every failure as unavailable, which would hide a possibly committed write; the driver gained `write`. |
| Drop the re-read of the just-committed claim | Sound through the write log; built next, below. |
| Fold or skip the generated-ID check | Rejected. It is a per-transaction refusal before acceptance. |
| Merge the claim commit into the root commit | Not compatible without an owner decision: the claim is the in-progress record that stops a retry replaying effects after a crash. |

Round trips per call on ordinary-role PostgreSQL, single caller. Native Medusa in the
last column.

| Workflow | Before | After | Native |
| --- | --- | --- | --- |
| Sales channel create | 17 | 11 | 3 |
| Shipping profile create | 17 | 11 | 3 |
| Inventory item create | 17 | 11 | 5 |
| Inventory level update | 19 | 13 | 6 |
| Price list create | 20 | 14 | 5 |
| Variant update | 24 | 18 | 8 |
| Product update | 43 | 37 | 42 |
| Product create | 47 | 41 | 40 |
| Product delete | 59 | 53 | 53 |

Each write saves three round trips per commit and makes two commits. On one host the
latency change is within noise; the saving is six network flights per write when the
database is remote. CPU per request did not change measurably.

Review found and this slice fixed a fault-injection test under
`test/frameworks/crossDomainCommand` that the earlier fenced-insert statement had left
unable to inject, because it sat outside the lanes then run.

## Claim revision without a read

Baseline `f60bfe207`. A native root re-read its own request claim at the root snapshot
to prove it was still the exact revision it had just committed.

The snapshot is selected together with the write log. When that log shows no write to
the request key after the claim's revision timestamp, the row at the snapshot is that
revision, so it is not fetched. The by-key read witness is registered either way, and
commit still conflicts on it. A later write to the key, a claim that is not in the
claimed state, a snapshot older than the claim or lost log history all take the read as
before. There is no Convex counterpart: the claim record is Flarex's own.

Round trips per call fall by one more: a one-row write 11 → 10, Variant update 18 → 17,
Product delete 53 → 52.

Only native roots pass a write log; ordinary begin and abort keep the read. A stale
claim that is still active can arise only in another process, whose writes this log
never holds, and that owner's commit then fails on the lease fence as before. The
round-trip counts above are the witness for the shortcut; no unit test isolates it.

## Per-write CPU, first cut

Baseline `e6f8183d6`. An independent challenge of a Product create profile found
the cost flat: no item above about 3.5%. Two read-only reviewers found no blocking
defect. No guarantee, byte or refusal changed.

| Change | Owner |
| --- | --- |
| Root request evidence and event policy derived once per bound root | `nativeRootRequest.ts`, `coreStore.ts` ([record](../divergences/native-event-policy-commitment.md)) |
| A final document's staged encoding is taken by the commit | `CoreEncodedDocumentHandoff` ([record](../divergences/decoded-document-handoff.md)) |
| Metadata read selections kept for one transaction | `CoreNativeMetadataSelections` ([record](../divergences/native-policy-match-reuse.md)) |
| Index key text written through one scratch buffer | `flarex-protocol/src/index-key.ts` |
| Workflow values restored by a plain copy instead of `structuredClone` | `medusa-adapter/src/workflow/value.ts` |
| No generator per row or per operation | `transaction.ts`, `nativeQuery.ts`, `dependencies.ts`, `protectedNativeAuthority.ts` |

Ordinary-role PostgreSQL, one host, 200-product catalogue, three alternating rounds
of 100 operations:

| Operation | CPU per operation (median) | Minimum |
| --- | --- | --- |
| Product create | 53.6 → 48.6 ms | 50.8 → 46.5 ms |
| List by IDs | 21.1 → 19.0 ms | 18.9 → 18.2 ms |

Round trips stay at 40. Other reads are within noise.

Not done, with reasons:

- Merging the request claim into the root commit is rejected. The durable claim is
  what makes a crashed request terminal instead of rerun; pinned Convex has no claim
  only because its functions are deterministic and sandboxed.
- The string size measure in `value-runtime-core.ts` is bundled into the generated
  runtime kernels, so changing it changes their hashes; it waits for a slice that
  regenerates them.
- About 75 value captures and 40 owner fibers per create remain the larger share and
  need their own design.

