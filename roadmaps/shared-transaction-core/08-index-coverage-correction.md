# Candidate Index Coverage Correction

Status: approved prerequisite to the authorized membership/unique storage rewrite.
The owner approved the coverage contract; implementation and validation are in progress.

## Problem And Evidence

The current writer prepares developer indexes only for its pinned schema. A
candidate-only index can become enabled while the previous Application revision
remains active. A valid mutation through that active revision then commits a row
without adding the candidate's membership. Normal managed-plan replanning after
its stale-frontier rejection can activate the same candidate. At one snapshot,
a point read finds the row while its candidate index returns no documents.
The new managed-schema cooking proof reproduces this on PGlite and PostgreSQL.

The analogous unique-set risk is source-derived: the active writer selects its
pinned unique constraints, validation reset touches only validating sets, and
an enabled candidate set returns replay without validating later writes. It
still needs its own failing witness before correction.

Owners: Application index/unique build state and bounded reconciliation,
materialization, index snapshot admission, and readiness evidence consumed by
activation. Native/CMS writers and their existing scope clock remain authoritative.
Application installation, manifest/schema validation, framework business rules,
new public features, and a universal transaction API are non-goals.

## Recommended Contract

Keep writes governed by the active Application schema. Candidate-only unique
conflicts, oversized keys, or extra fanout must not reject valid active writes.
Use an explicit build-owned coverage frontier to prove which committed changes
a candidate index/set includes. Keep the original build scan frontier and the
readable lower bound semantically distinct from completed coverage; do not use
updatedAt or reinterpret startCommitSeq as proof of current completeness.

Refresh stale candidate coverage through bounded index/unique-owner catch-up.
Existing app-row commit facts can select relevant changes, including key movement
and deletion. Missing retained history fails closed; snapshot-preserving rebuild
needs a separate explicit reset contract and is not part of the first catch-up
slice. An enabled flag alone never proves coverage. Publish completed coverage under
the scope clock, and require it at candidate index reads and activation readiness.
Never backdate a membership event into already-served snapshots. Catch-up must preserve every already-served snapshot; it cannot reset an enabled
definition or move its existing readable prefix.

Native Application publication checks the active schema after taking the scope
clock. CMS and cross-domain composition validate their captured active binding
under that same clock before participant entry. Thus an old revision either
commits before activation and must be included in candidate coverage, or is
rejected as stale after activation. Replays can return old results without writes.
Legacy compatibility writers require a separate fence proof before claiming this
contract covers them; do not infer it from the native Application generation.

Keep coverage and reconciliation in the existing build owners. No candidate
maintenance registry, adapter bypass, second transaction, or unbounded union of
historical definitions is proposed. The existing row writer continues to enforce
mandatory active definitions. Physically shared active/candidate definitions,
draining cancellation, retired definitions, and partial builds need explicit
owner tests before the exact coverage representation is finalized.

## Challenged Alternative

Blindly maintaining every catalog-bound candidate index would impose candidate
constraints and resource limits on active writes. It also misses target-local
retirement, declared-build frontiers, and admission racing with preparation.
The existing 256-entry write limit is not a bound on all historical/candidate
bindings. Raising it or weakening active validation is not an acceptable repair.
Freshness checks without key-move/delete reconciliation are also insufficient;
current backfill only enumerates rows at/before its initial frontier.

## Replacement And Completion Gates

- Retain scope-clock serialization, active-writer fences, canonical definition
  authority, physical retirement ownership, and exact snapshot/OCC dependencies.
- Extend existing index/unique build state with explicit coverage evidence and
  bounded refresh/rebuild behavior; remove permanent enabled replay as an
  unconditional current-completeness claim.
- Preserve the reproduced index failure and add the analogous unique witness,
  including a duplicate accepted by A that prevents B readiness without rejecting A.
- Prove writes before/during/after population, cursor-passed changes, deletion,
  key movement, unchanged keys, concurrent admission/activation, retained-floor
  gaps, candidate-only oversized keys/fanout, shared definitions, draining and
  retirement, rollback, uncertain COMMIT, and no backdated observable history.
- Run fast PGlite and ordinary-role PostgreSQL owner/consumer tests plus native,
  Payload/CMS and Medusa composition regressions. Keep production/Cloudflare
  performance claims separate. Update the index roadmap and both required reviews.
- Complete one owner correction before changing index history to membership-only
  transitions and unique claims to stable ownership. Framework operation APIs
  remain unchanged; internal build schemas and readiness contracts do change.

## Ordered Coverage Implementation

The ordered-index build owner now separates the initial scan frontier,
completed coverage, and immutable first-readable frontier. Initial validation
reconciles current rows and index positions, restarting its cursor after a
relevant table write. First enablement establishes the readable lower bound at
the locked scope head. Enabled catch-up consumes one whole authenticated commit
per transaction (up to the existing feed limit of 16,000 app-row facts), retaining
original transition sequences and advancing only a complete prefix. This is a
separate work bound from the initial 16-row population/validation page.

The current-row table's scope/table/commit index supports the unchanged-table
proof, including tombstone identities and old epochs. A table head no later than
coverage permits empty or other-table suffixes without scanning expired facts.
Otherwise missing retained facts fail closed. An oversized candidate-only key also
blocks catch-up even if a later A write repairs it: skipping the original
unrepresentable indexed snapshot would falsely certify historical coverage.
Recovery requires an explicit reset or new-definition contract; neither is
automatically introduced here. Active A writes remain valid. Selected active definitions advance
coverage with their ordinary row/index publication, after current completeness
and clock bounds are checked. Candidate-only definitions never join that writer
selection.

Readiness, current activation, query snapshots and native journal index admission
use the coverage owner. Stable readiness binds first-readable together with the
existing scan/fence identity; mutable coverage is excluded from its digest.
Physical draining/retired state pauses builder work through the existing lifecycle
owner. Current reads and active-writer authority retain their existing independent
lifecycle checks.

Migration 0096 adds nullable evidence without changing old entries, pointers,
lifecycle or scan frontiers. An old enabled definition with null evidence is not
ready and cannot be automatically rebuilt. Already-readable definitions cannot be
redeclared by generic stale-authority reconciliation. An explicit reset/rebuild
contract remains outside this slice. The replaced static-verifier generation in
`applicationRevisionReadinessV1` remains historical; this correction does not
modernize its activation/schema contract.

Unique coverage now belongs to one physical constraint workspace per scope,
shared by all closed revision sets that reference that definition. Migration
0097 replaces the schema-keyed workspace and removes unique-claim schema, epoch,
and commit provenance. It preserves claims and row data while new workspaces
start unserved. Initial population drains inherited ownership in independent
16-claim transactions, then populates and validates bounded current-row/claim
pages. Interrupted or uncertain pages resume through the same owner.

A ready physical constraint has authenticated current ownership through its
covered scope sequence, or an unchanged-table proof. Catch-up authenticates a
complete gap bounded by 100 commits and 16,000 facts before mutating claims. It
releases all changed owners before claiming final current keys. Thus a transient
A-only duplicate repaired by a later A commit does not trap candidate B at the
earlier duplicate. Missing retained facts and oversized gaps fail closed; no
partial gap grants readiness. Regular reconciliation advances coverage across
unchanged table suffixes so unrelated commits do not accumulate stale work.

Active writers authenticate the selected physical workspaces and stored claim
bytes before row publication, omit unchanged ownership writes, and advance only
those workspaces atomically with the scope clock. Candidate-only constraints do
not impose candidate uniqueness on active writes. Build directory limits apply
to new declarations, not a global scan or reset on every commit. Stable readiness
binds the exact per-definition start/fence vector, excluding mutable coverage.

Workspace reclamation authenticates active/candidate heads and protects their
physical memberships. Shared or enabled work remains; unknown protected closure
membership prevents deletion. Candidate supersession and eligible deletion stay
in one transaction. Physical draining/retired state prevents builder work.
Medusa and Payload operation APIs and framework lifecycle ownership are unchanged.
Membership-only ordered history remains the next storage replacement.

## Standard Mutation Composition

The standard `ApplicationMutationSystem` now constructs the existing exact
unique-definition and eligibility pair from its trusted control database and
admission authority and supplies both to its existing committer. The lower
proof profile may still omit those ports; the standard Application runtime
always composes them. No operation-facing API, schema installation, transaction
owner, or framework lifecycle changes are introduced.

The cooking witness reproduces candidate B becoming stale after valid A-only
duplicates, rejects B catch-up until A repairs them, activates B, and then
executes a B mutation that maintains unique coverage. A conflicting B write
fails without changing rows, claims, coverage, commit facts, outcomes, or wakes.
This closes the former composition gap where B activated but its standard
runtime omitted unique maintenance. Empty closed sets retain their zero-workspace
behavior through the same definition and eligibility owners.
