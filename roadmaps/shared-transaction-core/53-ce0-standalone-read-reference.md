# Standalone Read Request Reference

Status: bounded standalone point-read reference implemented; complete-request
CE0 equivalence and timing acceptance remain open.

## Outcome And Owners

Add an independent test-only reference for the measured standalone readback
operation: zero through thirty-two point reads, including repeated identities,
qualified absence and tombstones. Every call executes anew. No read creates a
commit, outcome, wake, revision, membership or claim, including an empty read.
This is the remaining read profile from the complete-request comparison contract,
not a bare SELECT benchmark or mutation replay with an empty result.

Reuse trusted target/preparation/admission, the snapshotRead physical profile,
scope-clock key-share protection, bounded canonical current-row reader and
request lifetime. Independently assemble request evidence, invoke the fixed
operation, cache only loaded identities, account for captured values, canonicalize
and hash the result, seal and release. Preserve absent reads being fetched again,
live/tombstone identity caching, first-failure classification and original scope.
Common owners remain inside future timing and are not independently compared.

## Design Challenge And Cutover

Using the real host with a substituted document reader would leave request
orchestration shared. Reusing the mutation reference would obscure the distinct
isolation, lock and publication contracts. Keep operation-specific read and
mutation factories without a production selector, fallback or universal engine.
Reuse only the reference's existing request-error projection where identical.
Unused write working sets, relation and preference mutation capabilities do not
belong in this restricted read profile; unsupported schema/configuration profiles
fail closed. Admission still authenticates the actual schema and binding.

The physical transaction is repeatable-read, not SQL READ ONLY: admission needs
row locks. No database transaction spans untrusted execution or remote effects.
Test hooks borrow the existing host hook types and remain inside owned test
lifetimes. Reads have no request key and cannot automatically re-execute after
ambiguous settlement. A fresh explicit caller read is a separate operation.

No production contracts, schema or durable data change. Keep existing mutation
reference and production snapshot regressions; no displaced runtime exists.
Only identical test-reference failure mapping may move to its existing helper.

## Validation And Completion

PGlite and ordinary-role PostgreSQL must agree on empty/live/repeated/missing/
deleted reads, scope confinement, malformed identities, stored corruption and
unchanged full scoped inventories. Repeated calls increment execution counts;
ordinary mutation replay remains distinct. Test cancellation and current-authority
refusal. PostgreSQL must show a concurrent writer committing before the held
reader releases, old values throughout that snapshot and new values on a fresh
read. Assert the actual snapshot isolation and drain owned fibers/connections.

Run affected types/lint, both read-only reviews, reconcile status and common
components, stop owned resources and commit. Numerical targets, calibration and
bounded point-read timing now belong to the
[paired scalar measurement](./57-ce0-paired-request-measurement.md); broader
operations remain open. The
[cumulative request witnesses](./54-ce0-cumulative-request-budget.md) cover
adjacent distinct/cached read sizes under the actual command byte budget;
exact byte thresholds across configurations remain open. This reference does
not close full CE0 or establish scale.
