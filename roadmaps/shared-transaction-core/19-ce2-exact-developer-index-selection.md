# CE2 Exact Developer Index Selection

Status: implemented for the control-catalog developer-index factory. Complete
native/CMS writer composition remains open under preflight 18.

## Outcome And Ownership

The control-catalog developer-index port must return the exact physical
definitions required by the requested published schema for the touched tables.
A missing binding must not silently turn an indexed write into an unindexed
write. Native publication and CMS materialization already use this port; the
same guarantee also applies to its journal-read consumers.

Reuse `loadPublishedPhysicalRequirementSnapshotV1` and its canonical manifest,
binding and physical-definition verification. Retain the verified access
identity, including the developer logical index ID, in that immutable snapshot
so selection does not reconstruct requirements, confuse intrinsic indexes
with developer indexes or accept swapped descriptor owners. Keep one successful
snapshot per port, keyed by deployment and schema version. A different schema
replaces it; absent or failed loads are not cached. Scope ownership and actual
touched definitions are still read on every lookup. This retained metadata
does not authorize execution, activation, build readiness or settlement.

The fresh selected set must match the verified touched developer requirements
by count, physical and logical identity, table and canonical specification.
Missing, extra or substituted definitions fail before shared materialization. Keep existing
lookup bounds and the published-requirement verifier's 256-definition bound;
do not raise limits locally or scan the entire catalog on every warm request.

## Alternatives And Breaks

Checking only whether a port exists cannot establish completeness. Trusting
the binding query alone repeats the defect. Recompiling and authenticating
the entire schema on every request would add avoidable work. A second
manifest compiler or independent verification algorithm would duplicate the
existing owner.

The factory's lookup now requires an authentic published schema and refuses
incomplete projection instead of returning a partial set. Its typed failures
include the existing published-requirement loader failures. No database
migration, durable-data deletion or framework API expansion is part of this
slice. Primitive definition readers retain their existing lower-level role;
they are not evidence of complete serving composition.

## Validation And Remaining Gates

The shared catalog-selection scenario covers exact touched subsets, empty
legitimate subsets, scope/deployment mismatch, bounded selection, missing
bindings before and after a warm lookup, extra and substituted bindings,
swapped logical owners that retain physical IDs and canonical specifications,
schema replacement and replacement of the retained snapshot. Both PGlite and
ordinary-role PostgreSQL run that scenario. The PostgreSQL observation checks
that the warm path does not reread the full published artifact. The private
point publisher additionally proves refusal without durable changes, successful
retry after catalog restoration, and replay of an already committed request
despite the missing binding. Retain connected native/CMS and journal regressions,
typechecks, lint and both required reviews as the change gate.

This closes the factory lookup defect, not the entire writer-composition gate.
Requiring correctly issued composition at every native/CMS publication boundary
and excluding legacy writers against active obligations remain necessary.
Coverage updates, locks, activation and reader behavior remain unchanged until
the continuous-maintenance cutover in preflight 18 is complete.
