# Mechanism: request absence carried from resolution to claim

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; statement counts only, local.

## Ownership and decision

- Owning slice: [Native write round trips](../slices/native-write-round-trips.md).
  It earlier rejected "one request lookup before a claim" because the second lookup
  registers the read witness that separates racing claimants. This record keeps that
  witness and removes only the scan behind it.
- Owner: `resolveRequest`, `heldRequestAbsence` and `acquireRequest` in
  `packages/persistence-postgres/src/core/database.ts`; `CoreRequestAbsence` in
  `core/api.ts`. The ordinary atomic commerce host
  (`frameworks/atomicCommerce/nativeHost.ts`) is the one consumer.
- No durable data, schema or stored-outcome change. `CoreRequestResolution`'s `missing`
  member gains an optional `absence`; `CoreDatabase.claimRequest` gains an optional
  third argument. Both are trusted-host contracts.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/model/src/session_requests/mod.rs` `get_session_request_record` scans the
  session-request index inside the mutation's own transaction, so the range joins that
  transaction's read set. `record_session_request` inserts the outcome in the same
  transaction as the mutation's writes.
- `crates/application/src/application_function_runner/mod.rs` `check_mutation_status`
  calls it once per attempt, before the UDF runs.
- Convex therefore reads the request key once. It has no claim record and no separate
  resolution: one transaction decides replay, runs the body and records the outcome.

## Current core and proposed direction challenge

- Flarex resolves a request before it has live authority, so that a committed outcome
  replays without restoring a producer. It then commits a durable claim in a second
  transaction before the body runs; the claim is what makes a crashed request terminal
  ([slice](../slices/native-write-round-trips.md), "merging the claim" is rejected).
  That gave two scans of the same request key at two snapshots, one statement each.
- The claim's insert is not an authority by itself. Request records have no unique
  constraint: a second insert under the same key gets a fresh document identity. What
  separates claimants is the by-key interval in the claim's read set, which commit
  checks against the write log and pending writes. That check covers writes after the
  claim's snapshot only. Dropping the claim's scan and nothing else would let a claim
  made in the gap between resolution and that snapshot go unseen, and a mutation that
  does exactly this commits a second claim over a committed request.
- The accepted direction therefore needs two things besides the carried absence: the
  claim must still register the by-key read witness, and something must cover the
  interval from the resolution's snapshot to the claim's.

## Why a difference is necessary

Translating Convex's single read needs resolution, claim and body in one transaction.
Flarex cannot hold one across native hooks, and replay must not depend on live
bindings. Two transactions remain; the second need not repeat the first one's scan when
this owner can show the key unchanged in between.

## Replacement mechanism and implementation

1. `resolveRequest` finds no record at snapshot `T`. It issues a frozen, empty
   `CoreRequestAbsence` and records, in a `WeakMap` private to this open database, the
   owned request identity, the by-key index identity and `T`. The object holds nothing
   readable; a copy, a structural object or another database's absence is not a key.
2. `claimRequest(identity, binding, absence)` selects its snapshot `T2` as before, then
   asks `heldRequestAbsence`, which registers nothing and shares the write-log check
   of a root's own claim revision (`requestKeyUnwrittenSince`). It holds only if all of
   these are true:
   - the absence was issued by this database;
   - key, request hash and actor (root, native command or program) equal the claim's;
   - `T <= T2`, and the by-key index is the one the resolution scanned;
   - this owner's write log, read at or after `T2`, shows no write to the key after `T`.
3. When it holds, the claim registers the same by-key interval read its scan would have
   registered and proceeds as if the scan had returned nothing. Otherwise it scans, as
   before. Lost log history, an unencodable key and any failed check take the scan.
4. The insert, pending-write check, conflict resolution, recovery enrollment and claim
   issue are untouched.

This is the reasoning already accepted for a root's own claim revision and for
prefetched unique slots: a page read at `T` plus a write log with no write to its
interval in `(T, T2]` is the page at `T2`.

## Preserved and changed guarantees

Preserved: one live claim per request key; two claimants holding valid absences of the
same key resolve to one `claimed` and one `busy`; a claimant whose absence predates
another's claim, abort or commit reads the key and gets `busy`, `failed` or the
committed outcome exactly as without it; a changed request hash is `requestMismatch`;
committed replay never receives an absence; failed-claim reclaim, lease comparison and
application source-pin admission run only on the complete path, which is the only path
that can see an existing record.

Changed: a record written by another lease holder is not in this owner's write log. A
complete path whose scan met such a record reports `leaseLost` there; with a held
absence the stale owner always reaches its commit, where the fenced write refuses it
with `leaseLost` and stores nothing. No second claim can commit.

The absence is reusable until its key is written. Reuse is harmless: the first write to
the key, including the holder's own claim, ends it.

## Required witnesses and remaining limits

- `test/core/nativeRequestAbsenceScenarios.ts`, on PGlite and ordinary-role PostgreSQL:
  a claim with a valid absence sends one statement fewer (3 to 2) and its request then
  commits and replays; two claimants with valid absences get one claim; a stale absence
  after a claim, an abort and a commit returns the complete path's outcome and
  statement count; another request's, a changed-hash, copied, plain, primitive, null
  and other-database absence all take the complete path; a rolled-back claim leaves a
  failed record and no rows.
- Each check was removed in turn and the scenarios failed: never holding, ignoring the
  identity, ignoring the write log (a committed request was claimed again), omitting
  the read witness (both claimants claimed), and accepting unissued objects.
- `packages/medusa-adapter/test/logical-product-creation-workflow.test.ts` measures one
  Product create at 32 statements, from 33.
- Only the ordinary atomic commerce host passes an absence. Application, CMS,
  cross-domain and legacy commerce claims are unchanged.
- Same file, both lanes: a stale owner that resolved the request absent and then lost
  its lease, to a successor that only took the lease or that also claimed the same
  request, claims with the held absence and is refused by the fenced commit with
  `CorePersistenceError` `leaseLost`. No claim is issued, no record of the stale claim
  is stored and the successor's own record is unchanged. The claim without the absence
  ends the same way one statement later: the stale owner's snapshot does not show the
  successor's record either. On both paths the request stays in the stale generation's
  recovery census, because a lost lease is not a proven noncommit; the successor's
  recovery then finds the stored state above.
