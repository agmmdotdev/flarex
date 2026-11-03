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
