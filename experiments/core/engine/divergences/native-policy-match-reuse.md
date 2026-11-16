# Retain authenticated native policy matches

Design status **Accepted for the selected slice**. See the
[owning slice](../slices/core-hot-path-reuse.md) for correctness and timing.

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` reads table and index
definitions through transaction-owned snapshot state and tracks consumed
dependencies. `crates/database/src/committer.rs` checks published and pending
conflicts at acceptance. Flarex's protected native profile also authenticates
a translated module policy and a live source selection, which Convex lacks.

The Core registry already detaches and recursively freezes decoded stored
policies. Recognize that capture privately and retain only successful pure
structural matches with an issued native definition and the exact table name.
The same captured policy can satisfy its own ordinary or protected structural
comparison. Preserve existing encoded comparison semantics when those objects
differ and for arbitrary callers. The owner retains no authorization verdict,
and all live and historical checks continue using their own registry and
dependency frontier.

Test a structurally equal detached copy, rejection after a policy change or
authority withdrawal, and reevaluation of unissued mutable policy data.
Validate the connected native scope and Product root on both database drivers.

## Metadata read selections inside one transaction

Owner: `CoreNativeMetadataSelections` in
`packages/persistence-postgres/src/core/transaction.ts`, one per transaction.
Convex resolves a table or index through transaction-owned snapshot state once
and records the dependency it consumed. Every Flarex native operation derived
the same metadata reads again for the same registry, authority, table and
index.

A transaction now keeps a successful selection for one immutable registry
object and

- a frozen selective authority and table name, and
- one of that registry's own enabled index definitions.

Only the derived read set is kept. The selective authority check runs on every
call, because the registry's schema proof is recorded beside the registry and
is not proven write-once; a kept selection is returned only after that check
succeeds. The caller's index definition is compared with the registry's on
every call. A mutable authority is selected again every time. A registry
advance is a new registry object and selects again. The reads are united into
the same timestamp's dependency group as before; a kept selection already
united at that timestamp is not united again, which leaves the group unchanged.
Non-selective selections stay with `coreNativeMetadataReads`. Nothing is shared
between transactions.

Test that the dependencies equal those of a mutable authority, which keeps
nothing; that the same registry and frozen authority are refused once the check
refuses; that a stale caller index is refused after a kept selection; and that
a registry advance in the middle of a request is observed and refused.
