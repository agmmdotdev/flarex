# Direct native command read visibility

Status: **Existing native behavior characterized and minimum mechanism selected; translated runtime not implemented.**

## Why the ordinary source transaction is insufficient

Pinned Convex Application transactions select one timestamp. A document committed
after that timestamp is not visible to that transaction. The existing direct
Payload command profile has a different admitted observation contract, demonstrated
through genuine Local API calls in both full-proof and source-backed bindings:

- Touched rows and observed absence remain stable after another root publishes.
- An untouched row/query can observe a later committed record.
- Root pending inserts/updates are visible to its native operations.
- A competitor changing an observed row causes final writeConflict without body
  replay; a disjoint competitor publishing an untouched record can be observed
  and the root can still commit its own pending row successfully.
- Repeated indexed membership retains the existing phantom/move/range evidence
  contract; it must not be replaced with assumptions about all possible queries.

The [shared visibility vectors](../../../../packages/persistence-postgres/test/integration/payload/payloadVisibilityScenario.ts)
and [actual source-backed profile](../../../../packages/medusa-adapter/test/logical-payload-visibility.postgres.test.ts)
own these observable cases. A READ COMMITTED session label alone did not establish
them. Setting maximumAttempts to one prevents replay but changes no visibility.

This is a necessary native execution-profile distinction, not a reason to change
ordinary Application snapshot semantics or preserve the old SQL engine.

## Selected replacement boundary

Keep Application transactions at their source snapshot. Keep standalone native
reads and borrowed Application participation under their separately selected
lifetimes/snapshots; the direct command result cannot silently redefine either.

The direct native owner must represent remembered rows/absence/membership and
later observations explicitly, with pending writes and exact final dependencies.
Reuse source snapshot/index/overlay/coalescing/final-acceptance mechanisms and sound
native observation policy at responsible core owners. The design must explain
observation timestamps, query/coverage identity, metadata authority and validation
against both committed and accepted unsaved writes. Do not infer a global range
rule from a few queries or put observed-but-unwritten rows into persisted writes.

The three-way mechanism challenge selects one trusted native-command observation
packet inside the existing transaction/finalization/committer owners. Initially
activate only the selected ID row/absence, exact required-title owner, and complete
table capture/frontier obligations. Unfiltered find/count uses the captured table;
page-number output slices those candidates. General ranges/keyset pages remain
named unsupported capability gates. Prior captures survive a later table scan;
captured rows never become pending writes or mutation charges.

Native ID revision/absence and monotone table-frontier obligations can reuse
timestamp-qualified source event dependencies where equivalent. Point absence
must retain insert/delete tombstone history; checking only live absence is weaker.
Application remains one dependency group at its original snapshot.

Title ownership needs exact state equality. A held root that saw title K absent
still commits after independent native roots commit create(K) and rename(K,L).
Both real profiles preserve that acceptance with each body running once. An index
event invalidates an unchanged-state shortcut; it is not itself a native conflict.

Materialize authenticated published slot state at S outside the acceptance mutex.
Under the existing mutex, relevant published suffix changes invalidate this proof;
refresh only pure validation at a newer S under the original lifetime/deadline.
Do not rerun callbacks, move earlier observations or invent conflicts from a private
refresh count. Once the suffix is stable, fold complete accepted-unpublished
document/index transitions, including removals/tombstones, before deciding owner
equality. A published mismatch is tentative: an accepted rename can restore the
expected free key. Use authoritative accepted batches, not request-discovery
`pendingDocuments`, which is intentionally incomplete for this purpose.

Then apply the candidate's actual pending overlay, enforce constraints and enter
the same pending queue/save/publication/outcome path. Preserve decisions with no
final row write; outcome injection and empty-change shortcuts must retain the
observation packet. No final SQL/I/O belongs under the ordering mutex.

Before every fresh capture, verify the exact selected table/index generation,
schema/source policy and authority remain usable at that data frontier. A disabled
old index can otherwise disclose incomplete membership before final validation.
Do not refresh earlier data or invalidate unrelated metadata automatically.

Exact private API/record shapes follow coordinated implementation. Keep genuine
native command identity distinct from Application functions, with confined facade
operations and no caller-issued timestamps/snapshots/finalizers. Do not retain the
old relational session/working-set/publisher, introduce another engine, serialize
all callbacks or hold SQL transactions over hooks. PostgreSQL remains sole
committed authority; native bodies are not replayed after conflicts or uncertainty.

## Acceptance and remaining gates

The [native slice](../slices/10-payload-native-core-cutover.md) owns producer,
installation, uniqueness, lifetime, outcome and removal requirements. Rerun the
observed conflict and disjoint-success vectors through the replacement, existing
indexed membership cases, binding/metadata changes, rollback-only, cancellation,
closed handles, borrowed snapshots and committed-outcome recovery. Separate
PGlite pending/replay evidence from ordinary PostgreSQL concurrency. Characterizing
the old profile supplies no replacement, hosting or capacity proof.
