# Call-Local Row Observations

## Status And Scope

Status: implemented authorized shared correction. The native Inventory Level
deletion proof exposed cumulative observed rows in a cursor-scoped call receipt.
This owns activity provenance, not relational selection, transaction
profiles, application dependencies, durable publication or framework semantics.

## Failure And Correct Owner

A native graph read selects explicit Level IDs A and B, then applies an Item
residual so only A is returned. Both bounded candidate bodies are correctly
authenticated. The following native soft-delete command receives only A, but its
call activity also reports B from the earlier read. The unchanged scalar
lifecycle receipt correctly refuses that nonrequested identity.

The working-set cursor slices mutations, lifecycle, set-null and reference
replacement observations. Its observed-row projection instead includes every
live row retained in the working set. Cached hydration is therefore mistaken
for row use by each subsequent command. Filtering only newly loaded rows would
also be wrong: a later genuine cached reread must appear in that call's receipt.

Correct this in shared working-set activity. The adapter must not discard
authenticated rows, weaken lifecycle correlation, rewrite native queries or
start another working set or transaction to hide the cumulative evidence.

## Contract And Invariants

An authentic cursor scopes observed bodies to actual row use after that cursor,
including cached rereads, pending rows, mutations and unchanged restores. Track
bounded per-identity use provenance through existing read and mutation owners;
do not copy a query planner into activity accounting or accumulate an unbounded
observation log. Preserve cursor/contribution issuer, source and lifetime checks.

An access supplied by an earlier complete scan retains the requested key or
index membership before residual filtering. Include original storage members
and current pending members within that selected anchor, even when a residual
rejects their bodies; exclude unrelated pending overlays. Unindexed scans use
all current table candidates. Reuse existing unique/index lowering and bounds
for this accounting. A cached unchanged restore still uses its selected row.
Text-search and JSON-containment candidate paths retain the same rule: current
pending members of the actual search anchor remain observable when a later
residual rejects them. Reuse the existing text and JSON predicate owners;
unrelated pending overlays do not acquire call provenance.

This replaces the former internal cursor contract that kept cumulative observed
rows while slicing other activity. Migrate its explicit cursor expectations and
callers in the same scope. Consumers needing preceding-read or whole-root
evidence continue to use the existing no-cursor aggregate contribution; no dual
cursor mode or compatibility wrapper is introduced.

Aggregate working-set activity, committed dependency evidence, absence/index
coverage, OCC, rollback, final pending bodies, publication and resource limits
retain their existing owners and complete root scope. A call-local receipt is
not a smaller settlement proof or a new authority to ignore prior dependencies.

## Correctness Gates

Neutral PGlite and ordinary-role PostgreSQL proofs must distinguish an earlier
read of A and B from a later operation using only A; prove a subsequent cached
reread of B remains visible. Cover pending writes and lifecycle activity, genuine
unchanged restoration, cursor/source refusal and retained aggregate evidence.
Use an ordinary PostgreSQL competing commit to retain stale dependency refusal.

The native Level root must keep strict lifecycle receipts and pass its combined
selectors, full deletion/restore behavior and quantity races. Regress other
cursor-scoped Medusa policies and shared activity consumers. No schema migration,
persisted format, installation reset or hosted activation is implied.
