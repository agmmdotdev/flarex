# CE2 Split-Catalog Activation

Status: split-catalog transaction reuse implemented under standing core-redesign
approval. Broader concurrent-lifecycle and measurement gates remain open.

## Outcome And Evidence

Schema activation resolves outgoing physical requirements through the catalog
transaction it already owns. Previously, the private Payload relation scenario
stalled on separate PGlite control/target stores: activation held a control
deployment lease, then `indexMaintenance` asked the original control database
for the outgoing schema. The colocated-target branch could not borrow a separate
control transaction. PostgreSQL's pool could conceal this extra-connection
dependency.

Keep catalog-before-scope lock order and target-only settlement. The activation
owner selects a transaction-bound related-requirement reader; maintenance uses
that reader instead of deciding which database connection to acquire. The
relation readiness owner validates its issued readiness and live catalog lease
before borrowing the transaction. The existing requirement loader checks that
any explicit borrowed catalog belongs to the original snapshot issuer. Legacy
activation retains target-transaction reuse for colocated catalogs.

## Alternatives, Breaks And Cleanup

Do not raise timeouts, add a second pool, bypass the catalog lease, prefetch
outgoing requirements outside the scope-clock decision, or modify Payload to
avoid the core path. Do not cache live transaction authority in immutable schema
snapshots. Do not introduce a second catalog registry or transaction owner.

Replace the private maintenance call's target parameter with its precise related
requirement reader; migrate both activation profiles together. The catalog lease
remains opaque and bounded by its existing owner. Preserve wrong-issuer, stale
lease, missing/altered catalog and activation rollback refusal. No stored-format
change, data reset, Medusa integration or unique-build optimization is included.

## Validation And Completion

Retain the complete PGlite and ordinary-role PostgreSQL Payload relation scenario
as the connected regression. Add a focused separate-catalog activation witness
that refuses any original-handle catalog read while the lease is held, validates
successor maintenance, rollback/retry and historical replay, and checks lease
authority refusal. Keep colocated and legacy activation coverage. Run affected
typechecks, lint and both project reviews, remove tracing/scaffolding, reconcile
the lifecycle gap and commit only the coherent correction.
