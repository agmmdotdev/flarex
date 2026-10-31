# Native declarative uniqueness over source indexes

Status: **Required-text subset implemented for the selected fresh native consumer; general constraint and retained-data gates open.**

## Why ordinary source indexes are insufficient

At the pinned Convex source, ordinary IndexSchema has descriptor/fields, and
query.unique reads up to two results and rejects ambiguity. Neither installs
declarative uniqueness for every writer. The selected real Payload scalar
consumer declares unique required text and expects its native duplicate error.
This is a native-behavior extension, not a DO requirement or permission for a
separate SQL claim authority.

## Selected mechanism boundary

Retain exact authenticated constraint declarations and their stable table/index
identities in shared schema state. Reuse ordinary ordered indexes, exact indexed
dependencies, pending overlays, first-original/final-write coalescing and final
committed-suffix/accepted-pending conflict checks. The document checkpoint checks
committed eligibility plus the root's final pending membership, excluding self and
preserving release, movement and reacquisition. Known duplicates produce the
authenticated unique failure mapped by the Payload adapter before Local API success.

Final acceptance must protect against competing accepted/published writes. The
existing held-root witness admits late writeConflict for a racing equal key and
success for disjoint keys; it does not authorize automatic callback replay or
serializing all native bodies. Source accounting, rollback and publication order
remain owned by the same core.

The selected native create/rename ABA also accepts when a previously absent title
is claimed and released by two committed roots before settlement. Preserve exact
owner equality rather than blanket index-event conflict. Materialize published
state outside the existing acceptance mutex; relevant suffix events invalidate
that preparation and refresh only pure validation. Fold complete accepted-pending
old/new key transitions before deciding equality, since a pending rename can
restore an expected free key. The [direct native profile](./native-direct-read-visibility.md)
owns the shared validation/lifetime boundary; no separate claim authority is added.

Initially support the selected required-text equality subset on proven fresh empty
tables. Establish ownership and complete constraint/index state atomically before
admitting writes. Ordinary backfill-ready alone is not constraint-ready. Refuse
populated changes and unsupported declarations rather than treating freshness as
a caller hint or silently discarding obligations. General populated builds and
compound/null/conditional policies require their own selected native witnesses.

## Evidence and removal gates

The [slice](../slices/10-payload-native-core-cutover.md) owns visibility, scope and
activation gates. Prove existing/pending duplicates and error timing, all relevant
writers, implicit-create races, key movement and nested rollback, equal/disjoint
concurrent keys, stale definitions and uncertain outcome recovery in both drivers.
Do not retain physical unique-slot tables, row locks or adapter preflight queries
as another authority. Reuse sound membership/equality projection only after its
dependency/semantic audit; remove the selected displaced enforcement with callers.
