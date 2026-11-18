# Recorded framework row replay

## Status And Scope

Status: implemented for explicitly selected atomic logical participants, with
bounded neutral and connected consumer coverage on both database lanes.
The first consumer is native Medusa
Price List Price compensation. Ordinary Application and framework writes retain
their existing contracts.

## Current Sources Of Truth

The [accepted design](../../design-notes/flarex-db-accepted-design.md) owns
Application identity and commit authority. The logical document working set,
atomic participant admission and bounded row/index history readers own this
operation. Native business authorization remains with the closed framework
callback; see [Medusa preflight 156](../flarexdb-framework-integration/preflight/156-native-price-list-price-update.md).

## Current Architecture

A trusted participant may select literal `allowRecordedRowReplay: true`, with
mandatory per-call receipt validation. The selection enters the existing
identity-bound atomic profile. Its logical store exposes `replay` for complete
rows of the admitted source and schema. Each row must exactly match an actual
current, pending, deleted or retained historical preimage, including every
business and managed column. A structurally valid timestamp is insufficient.

Retained lookup uses the admitted primary ordered index and canonical row
history, under the current scope clock and existing bounded read limits. Index
membership, canonical bytes, schema and current dependencies remain checked by
their storage owners. There is no adapter SQL, new transaction lifetime or new
history table.

## Invariants And Trust Boundaries

The private framework callback authorizes which native business preimages to
restore. Plain SDK compensation JSON is not an independently signed issuance
proof; the storage operation proves recorded content, not that an arbitrary
business inverse was issued by a particular workflow.

Live rows preserve internal identity. A pending deletion within the same root
may reuse its authenticated internal identity. A committed physical tombstone
never grants reuse of an Application ID: native IDs and complete managed values
restore through a fresh internal insertion, leaving the old tombstone and
history intact. Its protected insertion generation is newly issued by the
existing owner. Application `_id` and `_creationTime` are not caller input.

The historical row proving complete content and the current write destination
may have different internal identities. After a fresh-identity restoration,
an earlier complete native preimage can remain on the retired generation.
Replay authenticates that preimage through the same bounded source/key history
and writes the unique current destination, preserving its internal identity and
the retired tombstone. A live proving row with a changed native key still
refuses replay. Identical complete content on multiple committed retired
generations proves the recorded values without selecting any retired identity
as a destination. With no live destination or authenticated same-root pending
deletion to reuse, replay creates a fresh internal identity. Conflicting
reusable destinations remain refused.

Unique constraints, final foreign keys, read dependencies, resource accounting,
rollback-only failures, cancellation, replay and the single outer settlement
remain authoritative. Physical profiles and profiles without per-call
validation refuse this selection. Other profiles do not receive `replay`.

## Convex Compatibility And Flarex Divergences

Convex-style server-owned document identity and historical collision refusal
remain intact. This is a private framework compensation capability, not a
public Application historical-write API.

## Known Gaps And Next Correctness Gates

The neutral owner and graph consumer cover exact business/managed restoration,
immutable committed tombstones, repeated retired generations, pending replay,
unrecorded-content refusal, profile identity separation and no publication from
failed or caught failures. Bounded retained history exhaustion fails closed;
this does not promise indefinite compensation after history retirement,
arbitrary concurrent-write rewind, hosted activation or general schema upgrades.
